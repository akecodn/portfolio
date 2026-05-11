import json
import os
from datetime import datetime, timezone
from typing import Any

import httpx
import redis
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

PAYOUT_TIMEOUT_SEC = float(os.getenv("UPSTREAM_TIMEOUT_SEC", "8"))
PNL_SERVICE_URL = os.getenv("PNL_SERVICE_URL", "http://pnl-service:8000")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
RECALC_QUEUE_NAME = os.getenv("RECALC_QUEUE_NAME", "recalc_queue")
RECALC_PENDING_PREFIX = os.getenv("RECALC_PENDING_PREFIX", "recalc_pending")
RECALC_DLQ_NAME = os.getenv("RECALC_DLQ_NAME", "recalc_dlq")
RECALC_PENDING_TTL_SEC = int(os.getenv("RECALC_PENDING_TTL_SEC", "1800"))

app = FastAPI(title="API Gateway")


class TradePayload(BaseModel):
    symbol: str = Field(min_length=1)
    account: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    fee_currency: str = Field(min_length=1)
    time: datetime
    price: float
    qty: float
    fee: float


class PricePayload(BaseModel):
    symbol: str = Field(min_length=1)
    price: float
    time: datetime


class RatePayload(BaseModel):
    currency: str = Field(min_length=1)
    rate: float
    time: datetime


class ReferencePayload(BaseModel):
    symbol: str = Field(min_length=1)
    base_currency: str = Field(min_length=1)
    quote_currency: str = Field(min_length=1)
    exchange: str = Field(min_length=1)
    type: str = Field(min_length=1)


redis_client: redis.Redis | None = None


def _get_redis() -> redis.Redis:
    global redis_client
    if redis_client is None:
        redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)
    return redis_client


async def _forward(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{PNL_SERVICE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=PAYOUT_TIMEOUT_SEC) as client:
            response = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"PnL service unavailable: {exc}") from exc

    if response.status_code >= 400:
        detail: Any = response.text
        try:
            detail = response.json()
        except ValueError:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)

    try:
        return response.json()
    except ValueError:
        return {"raw": response.text}


def _calc_date_iso(event_time: datetime | None = None) -> str:
    base = event_time or datetime.now(timezone.utc)
    return base.date().isoformat()


def _queue_recalc(calc_date_iso: str) -> bool:
    client = _get_redis()
    pending_key = f"{RECALC_PENDING_PREFIX}:{calc_date_iso}"

    if client.set(pending_key, "1", nx=True, ex=RECALC_PENDING_TTL_SEC):
        payload = json.dumps(
            {
                "calc_date": calc_date_iso,
                "queued_at": datetime.now(timezone.utc).isoformat(),
                "retry": 0,
                "source": "api_gateway",
            }
        )
        client.lpush(RECALC_QUEUE_NAME, payload)
        return True
    return False


@app.get("/health")
def health():
    redis_ok = False
    recalc_queue_len = None
    recalc_dlq_len = None
    try:
        client = _get_redis()
        redis_ok = bool(client.ping())
        recalc_queue_len = int(client.llen(RECALC_QUEUE_NAME))
        recalc_dlq_len = int(client.llen(RECALC_DLQ_NAME))
    except Exception:
        redis_ok = False
    return {
        "status": "ok",
        "redis": redis_ok,
        "recalc_queue_len": recalc_queue_len,
        "recalc_dlq_len": recalc_dlq_len,
    }


@app.post("/trades")
async def ingest_trades(payload: TradePayload):
    upstream = await _forward("/trades", payload.model_dump(mode="json"))
    calc_date = _calc_date_iso(payload.time)
    queued = _queue_recalc(calc_date)
    return {
        "status": "accepted",
        "upstream": {
            "status": "ok",
            "source": upstream,
            "recalc": {"mode": "async", "queued": queued, "calc_date": calc_date},
        },
    }


@app.post("/prices")
async def ingest_prices(payload: PricePayload):
    upstream = await _forward("/prices", payload.model_dump(mode="json"))
    return {"status": "accepted", "upstream": {"status": "ok", "source": upstream}}


@app.post("/rates")
async def ingest_rates(payload: RatePayload):
    upstream = await _forward("/rates", payload.model_dump(mode="json"))
    calc_date = _calc_date_iso(payload.time)
    queued = _queue_recalc(calc_date)
    return {
        "status": "accepted",
        "upstream": {
            "status": "ok",
            "source": upstream,
            "recalc": {"mode": "async", "queued": queued, "calc_date": calc_date},
        },
    }


@app.post("/reference")
async def ingest_reference(payload: ReferencePayload):
    upstream = await _forward("/reference", payload.model_dump(mode="json"))
    return {"status": "accepted", "upstream": {"status": "ok", "source": upstream}}
