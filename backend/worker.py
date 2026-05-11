import json
import os
import time

import redis

from calc_pnl import run

REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
RECALC_QUEUE_NAME = os.getenv("RECALC_QUEUE_NAME", "recalc_queue")
RECALC_PENDING_PREFIX = os.getenv("RECALC_PENDING_PREFIX", "recalc_pending")
POLL_TIMEOUT_SEC = int(os.getenv("POLL_TIMEOUT_SEC", "5"))


client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)


def process_once() -> None:
    item = client.brpop(RECALC_QUEUE_NAME, timeout=POLL_TIMEOUT_SEC)
    if item is None:
        return

    _, raw_payload = item
    try:
        payload = json.loads(raw_payload)
        calc_date = payload["calc_date"]
    except Exception:
        return

    pending_key = f"{RECALC_PENDING_PREFIX}:{calc_date}"
    try:
        run(calc_date)
    finally:
        client.delete(pending_key)


def main() -> None:
    while True:
        try:
            process_once()
        except Exception:
            time.sleep(1)


if __name__ == "__main__":
    main()
