import asyncio
import os
import random
from datetime import datetime, timezone
from decimal import Decimal
from decimal import InvalidOperation
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel, Field

API_GATEWAY_URL = os.getenv("API_GATEWAY_URL", "http://api-gateway:8000")
FORWARD_TIMEOUT_SEC = float(os.getenv("FORWARD_TIMEOUT_SEC", "8"))
BYBIT_TESTNET_BASE_URL = os.getenv("BYBIT_TESTNET_BASE_URL", "https://api-testnet.bybit.com")
BYBIT_CATEGORY = os.getenv("BYBIT_CATEGORY", "linear")
BYBIT_TIMEOUT_SEC = float(os.getenv("BYBIT_TIMEOUT_SEC", "8"))

GENERATOR_AUTOSTART = os.getenv("GENERATOR_AUTOSTART", "false").lower() == "true"
GENERATOR_DEFAULT_INTERVAL_MS = int(os.getenv("GENERATOR_INTERVAL_MS", "1000"))
GENERATOR_DEFAULT_BATCH_SIZE = int(os.getenv("GENERATOR_BATCH_SIZE", "4"))

app = FastAPI(title="Price Streaming Service")


class PricePayload(BaseModel):
    symbol: str = Field(min_length=1)
    price: Decimal
    time: datetime


class PriceGeneratorStartPayload(BaseModel):
    interval_ms: int = Field(default=GENERATOR_DEFAULT_INTERVAL_MS, ge=100, le=60000)
    batch_size: int = Field(default=GENERATOR_DEFAULT_BATCH_SIZE, ge=1, le=200)
    symbols: list[str] | None = None


class BybitIngestPricePayload(BaseModel):
    symbol: str = Field(default="BTCUSDT", min_length=1)
    category: str | None = None


MARKETS = [
    {"symbol": "BTCUSDT", "base_price": 65000.0, "volatility": 0.0014, "price_dp": 2, "weight": 20},
    {"symbol": "ETHUSDT", "base_price": 3150.0, "volatility": 0.0017, "price_dp": 2, "weight": 18},
    {"symbol": "SOLUSDT", "base_price": 150.0, "volatility": 0.0021, "price_dp": 3, "weight": 14},
    {"symbol": "XRPUSDT", "base_price": 0.64, "volatility": 0.0019, "price_dp": 5, "weight": 12},
    {"symbol": "ADAUSDT", "base_price": 0.59, "volatility": 0.0018, "price_dp": 5, "weight": 11},
    {"symbol": "BNBUSDT", "base_price": 590.0, "volatility": 0.0013, "price_dp": 2, "weight": 9},
    {"symbol": "DOGEUSDT", "base_price": 0.21, "volatility": 0.0024, "price_dp": 6, "weight": 8},
    {"symbol": "AVAXUSDT", "base_price": 34.0, "volatility": 0.0020, "price_dp": 3, "weight": 8},
]
MARKET_BY_SYMBOL = {item["symbol"]: item for item in MARKETS}
ALL_SYMBOLS = [item["symbol"] for item in MARKETS]

price_generator_lock = asyncio.Lock()
price_generator_task: asyncio.Task | None = None
price_generator_config = {
    "interval_ms": GENERATOR_DEFAULT_INTERVAL_MS,
    "batch_size": GENERATOR_DEFAULT_BATCH_SIZE,
    "symbols": ALL_SYMBOLS,
}
price_generator_stats = {
    "started_at": None,
    "last_sent_at": None,
    "sent": 0,
    "failed": 0,
    "last_error": None,
}
price_mid_state = {item["symbol"]: item["base_price"] for item in MARKETS}
price_rng = random.Random()


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _to_str(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}"


def _generator_running() -> bool:
    return price_generator_task is not None and not price_generator_task.done()


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper().replace("-", "").replace("/", "")


async def _forward_price(payload: dict[str, Any], client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    async def _send(active_client: httpx.AsyncClient) -> httpx.Response:
        return await active_client.post(f"{API_GATEWAY_URL}/prices", json=payload)

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


def _pick_first_non_empty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        return value
    return None


def _to_decimal(value: Any, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail={"message": f"Invalid {field_name} from Bybit", "value": value},
        ) from exc


def _from_millis_to_iso(millis_raw: Any) -> str:
    try:
        millis = int(str(millis_raw))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail={"message": "Invalid ticker time from Bybit", "value": millis_raw}) from exc
    dt = datetime.fromtimestamp(millis / 1000, tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


async def _fetch_bybit_ticker(symbol: str, category: str) -> dict[str, Any]:
    url = f"{BYBIT_TESTNET_BASE_URL}/v5/market/tickers"
    params = {"category": category, "symbol": symbol}
    try:
        async with httpx.AsyncClient(timeout=BYBIT_TIMEOUT_SEC) as client:
            response = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Bybit unavailable: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail={"message": "Bybit request failed", "body": response.text})

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Bybit returned invalid JSON") from exc

    if payload.get("retCode") != 0:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Bybit returned application error",
                "retCode": payload.get("retCode"),
                "retMsg": payload.get("retMsg"),
            },
        )

    rows = payload.get("result", {}).get("list") or []
    if not rows:
        raise HTTPException(status_code=404, detail={"message": "Ticker not found in Bybit", "symbol": symbol})
    row = rows[0]
    if not isinstance(row, dict):
        raise HTTPException(status_code=502, detail="Unexpected Bybit ticker payload format")

    raw_price = _pick_first_non_empty(row.get("lastPrice"), row.get("markPrice"), row.get("indexPrice"))
    price = _to_decimal(raw_price, "lastPrice")
    ticker_time = row.get("time") or payload.get("time")
    if ticker_time is None:
        ticker_time = int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    return {
        "symbol": symbol,
        "price": str(price),
        "time": _from_millis_to_iso(ticker_time),
    }


def _build_price_payload(symbols: list[str]) -> dict[str, Any]:
    weighted_markets = [MARKET_BY_SYMBOL[symbol] for symbol in symbols]
    weights = [item["weight"] for item in weighted_markets]
    market = price_rng.choices(weighted_markets, weights=weights, k=1)[0]

    symbol = market["symbol"]
    current_price = price_mid_state.get(symbol, market["base_price"])
    shock = price_rng.gauss(0.0, market["volatility"])
    next_price = max(current_price * (1 + shock), market["base_price"] * 0.35)
    price_mid_state[symbol] = next_price

    return {
        "symbol": symbol,
        "price": _to_str(next_price, market["price_dp"]),
        "time": _utc_iso_now(),
    }


async def _price_generator_loop():
    async with httpx.AsyncClient(timeout=FORWARD_TIMEOUT_SEC) as client:
        while True:
            interval_ms = int(price_generator_config["interval_ms"])
            batch_size = int(price_generator_config["batch_size"])
            symbols = list(price_generator_config["symbols"])
            try:
                for _ in range(batch_size):
                    payload = _build_price_payload(symbols)
                    await _forward_price(payload, client=client)
                    price_generator_stats["sent"] += 1
                    price_generator_stats["last_sent_at"] = _utc_iso_now()
                price_generator_stats["last_error"] = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                price_generator_stats["failed"] += 1
                price_generator_stats["last_error"] = str(exc)
            await asyncio.sleep(interval_ms / 1000)


async def _start_price_generator(config: PriceGeneratorStartPayload):
    global price_generator_task

    requested_symbols = [symbol.strip().upper() for symbol in (config.symbols or ALL_SYMBOLS) if symbol.strip()]
    if not requested_symbols:
        raise HTTPException(status_code=400, detail="symbols list cannot be empty")

    invalid_symbols = [symbol for symbol in requested_symbols if symbol not in MARKET_BY_SYMBOL]
    if invalid_symbols:
        raise HTTPException(status_code=400, detail={"invalid_symbols": invalid_symbols, "available": ALL_SYMBOLS})

    price_generator_config["interval_ms"] = config.interval_ms
    price_generator_config["batch_size"] = config.batch_size
    price_generator_config["symbols"] = requested_symbols

    price_generator_stats["started_at"] = _utc_iso_now()
    price_generator_stats["last_sent_at"] = None
    price_generator_stats["sent"] = 0
    price_generator_stats["failed"] = 0
    price_generator_stats["last_error"] = None

    price_generator_task = asyncio.create_task(_price_generator_loop())


async def _stop_price_generator():
    global price_generator_task
    if price_generator_task is None:
        return
    price_generator_task.cancel()
    try:
        await price_generator_task
    except asyncio.CancelledError:
        pass
    price_generator_task = None


@app.get("/health")
def health():
    return {"status": "ok", "generator_running": _generator_running()}


@app.post("/events/prices")
async def ingest_price(payload: PricePayload):
    upstream = await _forward_price(payload.model_dump(mode="json"))
    return {"status": "accepted", "upstream": upstream}


@app.post("/ingest/bybit/price")
async def ingest_bybit_price(payload: BybitIngestPricePayload):
    symbol = _normalize_symbol(payload.symbol)
    category = (payload.category or BYBIT_CATEGORY).strip().lower()
    row = await _fetch_bybit_ticker(symbol, category)
    upstream = await _forward_price(row)
    return {
        "status": "ok",
        "source": "bybit-testnet",
        "symbol": symbol,
        "category": category,
        "upstream": upstream,
        "payload": row,
    }


@app.get("/ingest/bybit/price")
async def ingest_bybit_price_get(symbol: str = "BTCUSDT", category: str | None = None):
    payload = BybitIngestPricePayload(symbol=symbol, category=category)
    return await ingest_bybit_price(payload)


@app.get("/generator/status")
def generator_status():
    return {
        "running": _generator_running(),
        "config": price_generator_config,
        "stats": price_generator_stats,
    }


@app.post("/generator/start")
async def generator_start(config: PriceGeneratorStartPayload | None = None):
    config = config or PriceGeneratorStartPayload()
    async with price_generator_lock:
        if _generator_running():
            return {"status": "already_running", "config": price_generator_config, "stats": price_generator_stats}
        await _start_price_generator(config)
        return {"status": "started", "config": price_generator_config, "stats": price_generator_stats}


@app.post("/generator/stop")
async def generator_stop():
    async with price_generator_lock:
        if not _generator_running():
            return {"status": "already_stopped", "stats": price_generator_stats}
        await _stop_price_generator()
        return {"status": "stopped", "stats": price_generator_stats}


@app.on_event("startup")
async def on_startup():
    if GENERATOR_AUTOSTART:
        async with price_generator_lock:
            if not _generator_running():
                await _start_price_generator(PriceGeneratorStartPayload())


@app.on_event("shutdown")
async def on_shutdown():
    async with price_generator_lock:
        await _stop_price_generator()
