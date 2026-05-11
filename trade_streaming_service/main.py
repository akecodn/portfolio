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
BYBIT_DEFAULT_ACCOUNT = os.getenv("BYBIT_DEFAULT_ACCOUNT", "acc_bybit_testnet")
BYBIT_FEE_RATE = Decimal(os.getenv("BYBIT_FEE_RATE", "0.0006"))

GENERATOR_AUTOSTART = os.getenv("GENERATOR_AUTOSTART", "false").lower() == "true"
GENERATOR_DEFAULT_INTERVAL_MS = int(os.getenv("GENERATOR_INTERVAL_MS", "1000"))
GENERATOR_DEFAULT_BATCH_SIZE = int(os.getenv("GENERATOR_BATCH_SIZE", "2"))

app = FastAPI(title="Trade Streaming Service")


class TradePayload(BaseModel):
    symbol: str = Field(min_length=1)
    account: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    fee_currency: str = Field(min_length=1)
    time: datetime
    price: Decimal
    qty: Decimal
    fee: Decimal


class TradeGeneratorStartPayload(BaseModel):
    interval_ms: int = Field(default=GENERATOR_DEFAULT_INTERVAL_MS, ge=100, le=60000)
    batch_size: int = Field(default=GENERATOR_DEFAULT_BATCH_SIZE, ge=1, le=200)
    symbols: list[str] | None = None


class BybitIngestTradesPayload(BaseModel):
    symbol: str = Field(default="BTCUSDT", min_length=1)
    limit: int = Field(default=50, ge=1, le=1000)
    category: str | None = None


MARKETS = [
    {
        "symbol": "BTCUSDT",
        "quote": "USDT",
        "base_price": 65000.0,
        "volatility": 0.0016,
        "spread": 0.00035,
        "qty_min": 0.001,
        "qty_max": 0.09,
        "price_dp": 2,
        "qty_dp": 5,
        "weight": 20,
    },
    {
        "symbol": "ETHUSDT",
        "quote": "USDT",
        "base_price": 3150.0,
        "volatility": 0.0018,
        "spread": 0.00045,
        "qty_min": 0.01,
        "qty_max": 2.8,
        "price_dp": 2,
        "qty_dp": 4,
        "weight": 18,
    },
    {
        "symbol": "SOLUSDT",
        "quote": "USDT",
        "base_price": 150.0,
        "volatility": 0.0024,
        "spread": 0.0007,
        "qty_min": 0.2,
        "qty_max": 180.0,
        "price_dp": 3,
        "qty_dp": 3,
        "weight": 14,
    },
    {
        "symbol": "XRPUSDT",
        "quote": "USDT",
        "base_price": 0.64,
        "volatility": 0.0021,
        "spread": 0.0009,
        "qty_min": 40.0,
        "qty_max": 6500.0,
        "price_dp": 5,
        "qty_dp": 2,
        "weight": 12,
    },
    {
        "symbol": "ADAUSDT",
        "quote": "USDT",
        "base_price": 0.59,
        "volatility": 0.0020,
        "spread": 0.0008,
        "qty_min": 80.0,
        "qty_max": 9000.0,
        "price_dp": 5,
        "qty_dp": 2,
        "weight": 11,
    },
    {
        "symbol": "BNBUSDT",
        "quote": "USDT",
        "base_price": 590.0,
        "volatility": 0.0015,
        "spread": 0.0005,
        "qty_min": 0.05,
        "qty_max": 40.0,
        "price_dp": 2,
        "qty_dp": 3,
        "weight": 9,
    },
    {
        "symbol": "DOGEUSDT",
        "quote": "USDT",
        "base_price": 0.21,
        "volatility": 0.0028,
        "spread": 0.0012,
        "qty_min": 400.0,
        "qty_max": 25000.0,
        "price_dp": 6,
        "qty_dp": 1,
        "weight": 8,
    },
    {
        "symbol": "AVAXUSDT",
        "quote": "USDT",
        "base_price": 34.0,
        "volatility": 0.0023,
        "spread": 0.0008,
        "qty_min": 1.0,
        "qty_max": 320.0,
        "price_dp": 3,
        "qty_dp": 3,
        "weight": 8,
    },
]
MARKET_BY_SYMBOL = {item["symbol"]: item for item in MARKETS}
ALL_SYMBOLS = [item["symbol"] for item in MARKETS]
ACCOUNTS = [
    "acc_alpha",
    "acc_beta",
    "acc_gamma",
    "acc_delta",
    "acc_epsilon",
    "acc_zeta",
    "acc_eta",
    "acc_theta",
]

trade_generator_lock = asyncio.Lock()
trade_generator_task: asyncio.Task | None = None
trade_generator_config = {
    "interval_ms": GENERATOR_DEFAULT_INTERVAL_MS,
    "batch_size": GENERATOR_DEFAULT_BATCH_SIZE,
    "symbols": ALL_SYMBOLS,
}
trade_generator_stats = {
    "started_at": None,
    "last_sent_at": None,
    "sent": 0,
    "failed": 0,
    "last_error": None,
}
trade_mid_prices = {item["symbol"]: item["base_price"] for item in MARKETS}
trade_rng = random.Random()


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _to_str(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}"


def _generator_running() -> bool:
    return trade_generator_task is not None and not trade_generator_task.done()


def _normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper().replace("-", "").replace("/", "")


def _quote_from_symbol(symbol: str) -> str:
    known_quotes = ("USDT", "USDC", "USD", "BTC", "ETH")
    for quote in known_quotes:
        if symbol.endswith(quote):
            return quote
    return "USDT"


async def _forward_trade(payload: dict[str, Any], client: httpx.AsyncClient | None = None) -> dict[str, Any]:
    async def _send(active_client: httpx.AsyncClient) -> httpx.Response:
        return await active_client.post(f"{API_GATEWAY_URL}/trades", json=payload)

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


def _from_millis_to_iso(millis_raw: Any) -> str:
    try:
        millis = int(str(millis_raw))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail={"message": "Invalid trade time from Bybit", "value": millis_raw}) from exc
    dt = datetime.fromtimestamp(millis / 1000, tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _to_decimal(value: Any, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail={"message": f"Invalid {field_name} from Bybit", "value": value},
        ) from exc


def _pick_first_non_empty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        return value
    return None


def _parse_bybit_trade_item(item: dict[str, Any], symbol: str) -> dict[str, Any]:
    raw_price = _pick_first_non_empty(item.get("p"), item.get("price"))
    raw_qty = _pick_first_non_empty(item.get("v"), item.get("size"), item.get("qty"))
    raw_side = _pick_first_non_empty(item.get("S"), item.get("side"), "Buy")
    raw_time = _pick_first_non_empty(item.get("T"), item.get("time"))

    price = _to_decimal(raw_price, "price")
    qty_abs = _to_decimal(raw_qty, "qty")
    side_raw = str(raw_side).lower()
    qty_signed = qty_abs if side_raw == "buy" else -qty_abs
    quote = _quote_from_symbol(symbol)
    fee = (qty_abs * price * BYBIT_FEE_RATE).quantize(Decimal("0.00000001"))
    return {
        "symbol": symbol,
        "account": BYBIT_DEFAULT_ACCOUNT,
        "quote": quote,
        "fee_currency": quote,
        "time": _from_millis_to_iso(raw_time),
        "price": str(price),
        "qty": str(qty_signed),
        "fee": str(fee),
    }


async def _fetch_bybit_recent_trades(symbol: str, limit: int, category: str) -> list[dict[str, Any]]:
    url = f"{BYBIT_TESTNET_BASE_URL}/v5/market/recent-trade"
    params = {"category": category, "symbol": symbol, "limit": limit}
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
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="Unexpected Bybit trade payload format")

    parsed: list[dict[str, Any]] = []
    skipped = 0
    for item in rows:
        if not isinstance(item, dict):
            skipped += 1
            continue
        try:
            parsed.append(_parse_bybit_trade_item(item, symbol))
        except HTTPException:
            skipped += 1

    if not parsed:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Bybit returned no parseable trades",
                "symbol": symbol,
                "category": category,
                "skipped": skipped,
            },
        )
    parsed.sort(key=lambda row: row["time"])
    return parsed


def _build_trade_payload(symbols: list[str]) -> dict[str, Any]:
    weighted_markets = [MARKET_BY_SYMBOL[symbol] for symbol in symbols]
    weights = [item["weight"] for item in weighted_markets]
    market = trade_rng.choices(weighted_markets, weights=weights, k=1)[0]

    symbol = market["symbol"]
    current_price = trade_mid_prices.get(symbol, market["base_price"])
    shock = trade_rng.gauss(0.0, market["volatility"])
    next_price = max(current_price * (1 + shock), market["base_price"] * 0.35)
    trade_mid_prices[symbol] = next_price

    execution_noise = trade_rng.gauss(0.0, market["spread"])
    execution_price = max(next_price * (1 + execution_noise), market["base_price"] * 0.35)

    qty_abs = trade_rng.uniform(market["qty_min"], market["qty_max"])
    qty = qty_abs if trade_rng.random() < 0.58 else -qty_abs

    fee_rate = trade_rng.uniform(0.0002, 0.00075)
    fee = max(abs(qty) * execution_price * fee_rate, 0.00000001)

    return {
        "symbol": symbol,
        "account": trade_rng.choice(ACCOUNTS),
        "quote": market["quote"],
        "fee_currency": market["quote"],
        "time": _utc_iso_now(),
        "price": _to_str(execution_price, market["price_dp"]),
        "qty": _to_str(qty, market["qty_dp"]),
        "fee": _to_str(fee, 8),
    }


async def _trade_generator_loop():
    async with httpx.AsyncClient(timeout=FORWARD_TIMEOUT_SEC) as client:
        while True:
            interval_ms = int(trade_generator_config["interval_ms"])
            batch_size = int(trade_generator_config["batch_size"])
            symbols = list(trade_generator_config["symbols"])
            try:
                for _ in range(batch_size):
                    payload = _build_trade_payload(symbols)
                    await _forward_trade(payload, client=client)
                    trade_generator_stats["sent"] += 1
                    trade_generator_stats["last_sent_at"] = _utc_iso_now()
                trade_generator_stats["last_error"] = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                trade_generator_stats["failed"] += 1
                trade_generator_stats["last_error"] = str(exc)
            await asyncio.sleep(interval_ms / 1000)


async def _start_trade_generator(config: TradeGeneratorStartPayload):
    global trade_generator_task

    requested_symbols = [symbol.strip().upper() for symbol in (config.symbols or ALL_SYMBOLS) if symbol.strip()]
    if not requested_symbols:
        raise HTTPException(status_code=400, detail="symbols list cannot be empty")

    invalid_symbols = [symbol for symbol in requested_symbols if symbol not in MARKET_BY_SYMBOL]
    if invalid_symbols:
        raise HTTPException(status_code=400, detail={"invalid_symbols": invalid_symbols, "available": ALL_SYMBOLS})

    trade_generator_config["interval_ms"] = config.interval_ms
    trade_generator_config["batch_size"] = config.batch_size
    trade_generator_config["symbols"] = requested_symbols

    trade_generator_stats["started_at"] = _utc_iso_now()
    trade_generator_stats["last_sent_at"] = None
    trade_generator_stats["sent"] = 0
    trade_generator_stats["failed"] = 0
    trade_generator_stats["last_error"] = None

    trade_generator_task = asyncio.create_task(_trade_generator_loop())


async def _stop_trade_generator():
    global trade_generator_task
    if trade_generator_task is None:
        return
    trade_generator_task.cancel()
    try:
        await trade_generator_task
    except asyncio.CancelledError:
        pass
    trade_generator_task = None


@app.get("/health")
def health():
    return {"status": "ok", "generator_running": _generator_running()}


@app.post("/events/trades")
async def ingest_trade(payload: TradePayload):
    upstream = await _forward_trade(payload.model_dump(mode="json"))
    return {"status": "accepted", "upstream": upstream}


@app.post("/ingest/bybit/trades")
async def ingest_bybit_trades(payload: BybitIngestTradesPayload):
    symbol = _normalize_symbol(payload.symbol)
    category = (payload.category or BYBIT_CATEGORY).strip().lower()
    rows = await _fetch_bybit_recent_trades(symbol, payload.limit, category)
    if not rows:
        return {"status": "ok", "source": "bybit-testnet", "symbol": symbol, "ingested": 0}

    accepted = 0
    async with httpx.AsyncClient(timeout=FORWARD_TIMEOUT_SEC) as client:
        for row in rows:
            await _forward_trade(row, client=client)
            accepted += 1

    return {
        "status": "ok",
        "source": "bybit-testnet",
        "symbol": symbol,
        "category": category,
        "ingested": accepted,
        "first_time": rows[0]["time"],
        "last_time": rows[-1]["time"],
    }


@app.get("/ingest/bybit/trades")
async def ingest_bybit_trades_get(symbol: str = "BTCUSDT", limit: int = 50, category: str | None = None):
    payload = BybitIngestTradesPayload(symbol=symbol, limit=limit, category=category)
    return await ingest_bybit_trades(payload)


@app.get("/generator/status")
def generator_status():
    return {
        "running": _generator_running(),
        "config": trade_generator_config,
        "stats": trade_generator_stats,
    }


@app.post("/generator/start")
async def generator_start(config: TradeGeneratorStartPayload | None = None):
    config = config or TradeGeneratorStartPayload()
    async with trade_generator_lock:
        if _generator_running():
            return {"status": "already_running", "config": trade_generator_config, "stats": trade_generator_stats}
        await _start_trade_generator(config)
        return {"status": "started", "config": trade_generator_config, "stats": trade_generator_stats}


@app.post("/generator/stop")
async def generator_stop():
    async with trade_generator_lock:
        if not _generator_running():
            return {"status": "already_stopped", "stats": trade_generator_stats}
        await _stop_trade_generator()
        return {"status": "stopped", "stats": trade_generator_stats}


@app.on_event("startup")
async def on_startup():
    if GENERATOR_AUTOSTART:
        async with trade_generator_lock:
            if not _generator_running():
                await _start_trade_generator(TradeGeneratorStartPayload())


@app.on_event("shutdown")
async def on_shutdown():
    async with trade_generator_lock:
        await _stop_trade_generator()
