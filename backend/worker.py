import json
import os
import time
from datetime import datetime, timezone

import redis

from calc_pnl import run

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
RECALC_QUEUE_NAME = os.getenv("RECALC_QUEUE_NAME", "recalc_queue")
RECALC_PENDING_PREFIX = os.getenv("RECALC_PENDING_PREFIX", "recalc_pending")
RECALC_DLQ_NAME = os.getenv("RECALC_DLQ_NAME", "recalc_dlq")
RECALC_MAX_RETRIES = int(os.getenv("RECALC_MAX_RETRIES", "3"))
RECALC_RETRY_BACKOFF_SEC = float(os.getenv("RECALC_RETRY_BACKOFF_SEC", "0.5"))
POLL_TIMEOUT_SEC = int(os.getenv("POLL_TIMEOUT_SEC", "5"))


client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_retry(value) -> int:
    try:
        parsed = int(value)
    except Exception:
        return 0
    return parsed if parsed >= 0 else 0


def _send_to_dlq(payload: dict, reason: str, error: str | None = None) -> None:
    dlq_item = {
        "reason": reason,
        "failed_at": _now_iso(),
        "payload": payload,
    }
    if error:
        dlq_item["error"] = str(error)[:2000]
    client.lpush(RECALC_DLQ_NAME, json.dumps(dlq_item))


def _delete_pending(calc_date: str | None) -> None:
    if not calc_date:
        return
    client.delete(f"{RECALC_PENDING_PREFIX}:{calc_date}")


def process_once() -> None:
    item = client.brpop(RECALC_QUEUE_NAME, timeout=POLL_TIMEOUT_SEC)
    if item is None:
        return

    _, raw_payload = item
    try:
        payload = json.loads(raw_payload)
        if not isinstance(payload, dict):
            raise ValueError("payload must be object")
        calc_date = str(payload["calc_date"]).strip()
        if not calc_date:
            raise ValueError("calc_date is empty")
    except Exception as exc:
        _send_to_dlq({"raw_payload": raw_payload}, "invalid_payload", str(exc))
        return

    retry = _as_retry(payload.get("retry", 0))
    try:
        run(calc_date)
        _delete_pending(calc_date)
    except Exception as exc:
        if retry < RECALC_MAX_RETRIES:
            payload["retry"] = retry + 1
            payload["last_error"] = str(exc)[:1000]
            payload["last_failed_at"] = _now_iso()
            time.sleep(RECALC_RETRY_BACKOFF_SEC)
            client.lpush(RECALC_QUEUE_NAME, json.dumps(payload))
            return
        _send_to_dlq(payload, "max_retries_exceeded", str(exc))
        _delete_pending(calc_date)


def main() -> None:
    while True:
        try:
            process_once()
        except Exception:
            time.sleep(1)


if __name__ == "__main__":
    main()
