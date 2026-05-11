import asyncio
import os
import random
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel, Field

API_GATEWAY_URL = os.getenv("API_GATEWAY_URL", "http://api-gateway:8000")
FORWARD_TIMEOUT_SEC = float(os.getenv("FORWARD_TIMEOUT_SEC", "8"))

GENERATOR_AUTOSTART = os.getenv("GENERATOR_AUTOSTART", "false").lower() == "true"
GENERATOR_DEFAULT_INTERVAL_MS = int(os.getenv("GENERATOR_INTERVAL_MS", "4000"))
GENERATOR_DEFAULT_BATCH_SIZE = int(os.getenv("GENERATOR_BATCH_SIZE", "2"))

app = FastAPI(title="Reference Data Service")


class ReferencePayload(BaseModel):
    symbol: str = Field(min_length=1)
    base_currency: str = Field(min_length=1)
    quote_currency: str = Field(min_length=1)
    exchange: str = Field(min_length=1)
    type: str = Field(min_length=1)


class ReferenceGeneratorStartPayload(BaseModel):
    interval_ms: int = Field(default=GENERATOR_DEFAULT_INTERVAL_MS, ge=250, le=60000)
    batch_size: int = Field(default=GENERATOR_DEFAULT_BATCH_SIZE, ge=1, le=200)
    symbols: list[str] | None = None
    seed_snapshot: bool = True


REFERENCE_UNIVERSE = [
    {"symbol": "BTCUSDT", "base_currency": "BTC", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 18},
    {"symbol": "ETHUSDT", "base_currency": "ETH", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 16},
    {"symbol": "SOLUSDT", "base_currency": "SOL", "quote_currency": "USDT", "exchange": "bybit", "type": "spot", "weight": 12},
    {"symbol": "XRPUSDT", "base_currency": "XRP", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 11},
    {"symbol": "ADAUSDT", "base_currency": "ADA", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 11},
    {"symbol": "BNBUSDT", "base_currency": "BNB", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 9},
    {"symbol": "DOGEUSDT", "base_currency": "DOGE", "quote_currency": "USDT", "exchange": "bybit", "type": "spot", "weight": 8},
    {"symbol": "AVAXUSDT", "base_currency": "AVAX", "quote_currency": "USDT", "exchange": "okx", "type": "spot", "weight": 8},
    {"symbol": "LTCUSDT", "base_currency": "LTC", "quote_currency": "USDT", "exchange": "kraken", "type": "spot", "weight": 6},
    {"symbol": "DOTUSDT", "base_currency": "DOT", "quote_currency": "USDT", "exchange": "okx", "type": "spot", "weight": 6},
    {"symbol": "LINKUSDT", "base_currency": "LINK", "quote_currency": "USDT", "exchange": "coinbase", "type": "spot", "weight": 6},
    {"symbol": "TRXUSDT", "base_currency": "TRX", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 5},
    {"symbol": "ATOMUSDT", "base_currency": "ATOM", "quote_currency": "USDT", "exchange": "okx", "type": "spot", "weight": 5},
    {"symbol": "MATICUSDT", "base_currency": "MATIC", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 5},
    {"symbol": "NEARUSDT", "base_currency": "NEAR", "quote_currency": "USDT", "exchange": "bybit", "type": "spot", "weight": 4},
    {"symbol": "OPUSDT", "base_currency": "OP", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 4},
    {"symbol": "ARBUSDT", "base_currency": "ARB", "quote_currency": "USDT", "exchange": "bybit", "type": "spot", "weight": 4},
    {"symbol": "APTUSDT", "base_currency": "APT", "quote_currency": "USDT", "exchange": "okx", "type": "spot", "weight": 4},
    {"symbol": "SUIUSDT", "base_currency": "SUI", "quote_currency": "USDT", "exchange": "binance", "type": "spot", "weight": 4},
]
REFERENCE_BY_SYMBOL = {item["symbol"]: item for item in REFERENCE_UNIVERSE}
ALL_SYMBOLS = [item["symbol"] for item in REFERENCE_UNIVERSE]

reference_generator_lock = asyncio.Lock()
reference_generator_task: asyncio.Task | None = None
reference_generator_config = {
    "interval_ms": GENERATOR_DEFAULT_INTERVAL_MS,
    "batch_size": GENERATOR_DEFAULT_BATCH_SIZE,
    "symbols": ALL_SYMBOLS,
    "seed_snapshot": True,
}
reference_generator_stats = {
    "started_at": None,
    "last_sent_at": None,
    "sent": 0,
    "failed": 0,
    "last_error": None,
}
reference_rng = random.Random()


def _generator_running() -> bool:
    return reference_generator_task is not None and not reference_generator_task.done()


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def _forward_reference(payload: dict[str, Any], client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    async def _send(active_client: httpx.AsyncClient) -> httpx.Response:
        return await active_client.post(f"{API_GATEWAY_URL}/reference", json=payload)

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


def _pick_reference(symbols: list[str]) -> dict[str, Any]:
    available = [REFERENCE_BY_SYMBOL[symbol] for symbol in symbols]
    weights = [item["weight"] for item in available]
    picked = reference_rng.choices(available, weights=weights, k=1)[0]
    return {
        "symbol": picked["symbol"],
        "base_currency": picked["base_currency"],
        "quote_currency": picked["quote_currency"],
        "exchange": picked["exchange"],
        "type": picked["type"],
    }


async def _seed_references(symbols: list[str], client: httpx.AsyncClient):
    for symbol in symbols:
        payload = REFERENCE_BY_SYMBOL[symbol].copy()
        payload.pop("weight", None)
        await _forward_reference(payload, client=client)
        reference_generator_stats["sent"] += 1
        reference_generator_stats["last_sent_at"] = _utc_iso_now()


async def _reference_generator_loop():
    async with httpx.AsyncClient(timeout=FORWARD_TIMEOUT_SEC) as client:
        if reference_generator_config["seed_snapshot"]:
            await _seed_references(reference_generator_config["symbols"], client)

        while True:
            interval_ms = int(reference_generator_config["interval_ms"])
            batch_size = int(reference_generator_config["batch_size"])
            symbols = list(reference_generator_config["symbols"])
            try:
                for _ in range(batch_size):
                    payload = _pick_reference(symbols)
                    await _forward_reference(payload, client=client)
                    reference_generator_stats["sent"] += 1
                    reference_generator_stats["last_sent_at"] = _utc_iso_now()
                reference_generator_stats["last_error"] = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                reference_generator_stats["failed"] += 1
                reference_generator_stats["last_error"] = str(exc)
            await asyncio.sleep(interval_ms / 1000)


async def _start_reference_generator(config: ReferenceGeneratorStartPayload):
    global reference_generator_task

    requested_symbols = [symbol.strip().upper() for symbol in (config.symbols or ALL_SYMBOLS) if symbol.strip()]
    if not requested_symbols:
        raise HTTPException(status_code=400, detail="symbols list cannot be empty")

    invalid_symbols = [symbol for symbol in requested_symbols if symbol not in REFERENCE_BY_SYMBOL]
    if invalid_symbols:
        raise HTTPException(status_code=400, detail={"invalid_symbols": invalid_symbols, "available": ALL_SYMBOLS})

    reference_generator_config["interval_ms"] = config.interval_ms
    reference_generator_config["batch_size"] = config.batch_size
    reference_generator_config["symbols"] = requested_symbols
    reference_generator_config["seed_snapshot"] = config.seed_snapshot

    reference_generator_stats["started_at"] = _utc_iso_now()
    reference_generator_stats["last_sent_at"] = None
    reference_generator_stats["sent"] = 0
    reference_generator_stats["failed"] = 0
    reference_generator_stats["last_error"] = None

    reference_generator_task = asyncio.create_task(_reference_generator_loop())


async def _stop_reference_generator():
    global reference_generator_task
    if reference_generator_task is None:
        return
    reference_generator_task.cancel()
    try:
        await reference_generator_task
    except asyncio.CancelledError:
        pass
    reference_generator_task = None


@app.get("/health")
def health():
    return {"status": "ok", "generator_running": _generator_running()}


@app.post("/events/reference")
async def ingest_reference(payload: ReferencePayload):
    upstream = await _forward_reference(payload.model_dump(mode="json"))
    return {"status": "accepted", "upstream": upstream}


@app.get("/generator/status")
def generator_status():
    return {
        "running": _generator_running(),
        "config": reference_generator_config,
        "stats": reference_generator_stats,
    }


@app.post("/generator/start")
async def generator_start(config: ReferenceGeneratorStartPayload | None = None):
    config = config or ReferenceGeneratorStartPayload()
    async with reference_generator_lock:
        if _generator_running():
            return {
                "status": "already_running",
                "config": reference_generator_config,
                "stats": reference_generator_stats,
            }
        await _start_reference_generator(config)
        return {"status": "started", "config": reference_generator_config, "stats": reference_generator_stats}


@app.post("/generator/stop")
async def generator_stop():
    async with reference_generator_lock:
        if not _generator_running():
            return {"status": "already_stopped", "stats": reference_generator_stats}
        await _stop_reference_generator()
        return {"status": "stopped", "stats": reference_generator_stats}


@app.on_event("startup")
async def on_startup():
    if GENERATOR_AUTOSTART:
        async with reference_generator_lock:
            if not _generator_running():
                await _start_reference_generator(ReferenceGeneratorStartPayload())


@app.on_event("shutdown")
async def on_shutdown():
    async with reference_generator_lock:
        await _stop_reference_generator()
