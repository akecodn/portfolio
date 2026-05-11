import asyncio
import os
import random
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel, Field

API_GATEWAY_URL = os.getenv("API_GATEWAY_URL", "http://api-gateway:8000")
FORWARD_TIMEOUT_SEC = float(os.getenv("FORWARD_TIMEOUT_SEC", "8"))

GENERATOR_AUTOSTART = os.getenv("GENERATOR_AUTOSTART", "false").lower() == "true"
GENERATOR_DEFAULT_INTERVAL_MS = int(os.getenv("GENERATOR_INTERVAL_MS", "1500"))
GENERATOR_DEFAULT_BATCH_SIZE = int(os.getenv("GENERATOR_BATCH_SIZE", "3"))

app = FastAPI(title="FX Rates Service")


class RatePayload(BaseModel):
    currency: str = Field(min_length=1)
    rate: Decimal
    time: datetime


class RateGeneratorStartPayload(BaseModel):
    interval_ms: int = Field(default=GENERATOR_DEFAULT_INTERVAL_MS, ge=100, le=60000)
    batch_size: int = Field(default=GENERATOR_DEFAULT_BATCH_SIZE, ge=1, le=200)
    currencies: list[str] | None = None


RATE_MARKETS = [
    {"currency": "USD", "base_rate": 1.0, "volatility": 0.00005, "min_rate": 0.999, "max_rate": 1.001, "dp": 6, "weight": 12},
    {"currency": "USDT", "base_rate": 1.0, "volatility": 0.00018, "min_rate": 0.995, "max_rate": 1.005, "dp": 6, "weight": 11},
    {"currency": "USDC", "base_rate": 1.0, "volatility": 0.00014, "min_rate": 0.996, "max_rate": 1.004, "dp": 6, "weight": 10},
    {"currency": "EUR", "base_rate": 1.085, "volatility": 0.00055, "min_rate": 1.01, "max_rate": 1.18, "dp": 6, "weight": 8},
    {"currency": "BTC", "base_rate": 65000.0, "volatility": 0.0018, "min_rate": 12000, "max_rate": 200000, "dp": 2, "weight": 7},
    {"currency": "ETH", "base_rate": 3150.0, "volatility": 0.0020, "min_rate": 300, "max_rate": 20000, "dp": 2, "weight": 7},
    {"currency": "BNB", "base_rate": 590.0, "volatility": 0.0017, "min_rate": 80, "max_rate": 2500, "dp": 3, "weight": 5},
]
RATE_BY_CCY = {item["currency"]: item for item in RATE_MARKETS}
ALL_CURRENCIES = [item["currency"] for item in RATE_MARKETS]

rate_generator_lock = asyncio.Lock()
rate_generator_task: asyncio.Task | None = None
rate_generator_config = {
    "interval_ms": GENERATOR_DEFAULT_INTERVAL_MS,
    "batch_size": GENERATOR_DEFAULT_BATCH_SIZE,
    "currencies": ALL_CURRENCIES,
}
rate_generator_stats = {
    "started_at": None,
    "last_sent_at": None,
    "sent": 0,
    "failed": 0,
    "last_error": None,
}
rate_state = {item["currency"]: item["base_rate"] for item in RATE_MARKETS}
rate_rng = random.Random()


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _to_str(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}"


def _generator_running() -> bool:
    return rate_generator_task is not None and not rate_generator_task.done()


async def _forward_rate(payload: dict[str, Any], client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    async def _send(active_client: httpx.AsyncClient) -> httpx.Response:
        return await active_client.post(f"{API_GATEWAY_URL}/rates", json=payload)

    try:
        if client is None:
            async with httpx.AsyncClient(timeout=FORWARD_TIMEOUT_SEC) as own_client:
                response = await _send(own_client)
        else:
            response = await _send(client)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"API gateway unavailable: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text
        try:
            detail = response.json()
        except ValueError:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response.json()


def _build_rate_payload(currencies: list[str]) -> dict[str, Any]:
    weighted_markets = [RATE_BY_CCY[currency] for currency in currencies]
    weights = [item["weight"] for item in weighted_markets]
    market = rate_rng.choices(weighted_markets, weights=weights, k=1)[0]

    currency = market["currency"]
    current_rate = rate_state.get(currency, market["base_rate"])
    mean_reversion = (market["base_rate"] - current_rate) * 0.03
    shock = current_rate * rate_rng.gauss(0.0, market["volatility"])
    next_rate = current_rate + mean_reversion + shock
    next_rate = max(market["min_rate"], min(next_rate, market["max_rate"]))
    rate_state[currency] = next_rate

    return {
        "currency": currency,
        "rate": _to_str(next_rate, market["dp"]),
        "time": _utc_iso_now(),
    }


async def _rate_generator_loop():
    async with httpx.AsyncClient(timeout=FORWARD_TIMEOUT_SEC) as client:
        while True:
            interval_ms = int(rate_generator_config["interval_ms"])
            batch_size = int(rate_generator_config["batch_size"])
            currencies = list(rate_generator_config["currencies"])
            try:
                for _ in range(batch_size):
                    payload = _build_rate_payload(currencies)
                    await _forward_rate(payload, client=client)
                    rate_generator_stats["sent"] += 1
                    rate_generator_stats["last_sent_at"] = _utc_iso_now()
                rate_generator_stats["last_error"] = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                rate_generator_stats["failed"] += 1
                rate_generator_stats["last_error"] = str(exc)
            await asyncio.sleep(interval_ms / 1000)


async def _start_rate_generator(config: RateGeneratorStartPayload):
    global rate_generator_task

    requested_currencies = [currency.strip().upper() for currency in (config.currencies or ALL_CURRENCIES) if currency.strip()]
    if not requested_currencies:
        raise HTTPException(status_code=400, detail="currencies list cannot be empty")

    invalid_currencies = [currency for currency in requested_currencies if currency not in RATE_BY_CCY]
    if invalid_currencies:
        raise HTTPException(
            status_code=400,
            detail={"invalid_currencies": invalid_currencies, "available": ALL_CURRENCIES},
        )

    rate_generator_config["interval_ms"] = config.interval_ms
    rate_generator_config["batch_size"] = config.batch_size
    rate_generator_config["currencies"] = requested_currencies

    rate_generator_stats["started_at"] = _utc_iso_now()
    rate_generator_stats["last_sent_at"] = None
    rate_generator_stats["sent"] = 0
    rate_generator_stats["failed"] = 0
    rate_generator_stats["last_error"] = None

    rate_generator_task = asyncio.create_task(_rate_generator_loop())


async def _stop_rate_generator():
    global rate_generator_task
    if rate_generator_task is None:
        return
    rate_generator_task.cancel()
    try:
        await rate_generator_task
    except asyncio.CancelledError:
        pass
    rate_generator_task = None


@app.get("/health")
def health():
    return {"status": "ok", "generator_running": _generator_running()}


@app.post("/events/rates")
async def ingest_rate(payload: RatePayload):
    upstream = await _forward_rate(payload.model_dump(mode="json"))
    return {"status": "accepted", "upstream": upstream}


@app.get("/generator/status")
def generator_status():
    return {
        "running": _generator_running(),
        "config": rate_generator_config,
        "stats": rate_generator_stats,
    }


@app.post("/generator/start")
async def generator_start(config: RateGeneratorStartPayload | None = None):
    config = config or RateGeneratorStartPayload()
    async with rate_generator_lock:
        if _generator_running():
            return {"status": "already_running", "config": rate_generator_config, "stats": rate_generator_stats}
        await _start_rate_generator(config)
        return {"status": "started", "config": rate_generator_config, "stats": rate_generator_stats}


@app.post("/generator/stop")
async def generator_stop():
    async with rate_generator_lock:
        if not _generator_running():
            return {"status": "already_stopped", "stats": rate_generator_stats}
        await _stop_rate_generator()
        return {"status": "stopped", "stats": rate_generator_stats}


@app.on_event("startup")
async def on_startup():
    if GENERATOR_AUTOSTART:
        async with rate_generator_lock:
            if not _generator_running():
                await _start_rate_generator(RateGeneratorStartPayload())


@app.on_event("shutdown")
async def on_shutdown():
    async with rate_generator_lock:
        await _stop_rate_generator()
