from fastapi import FastAPI
from services.db import (
    insert_trade, insert_price, insert_rate, insert_reference,
    get_trades as db_get_trades, get_positions as db_get_positions,
    get_reference as db_get_reference, get_prices as db_get_prices, get_rates as db_get_rates
)

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/trades")
def add_trade(trade: dict):
    insert_trade(trade)
    return {"status": "ok"}

@app.post("/prices")
def add_price(price: dict):
    insert_price(price)
    return {"status": "ok"}

@app.post("/rates")
def add_rate(rate: dict):
    insert_rate(rate)
    return {"status": "ok"}

@app.post("/reference")
def add_reference(reference: dict):
    insert_reference(reference)
    return {"status": "ok"}

@app.get("/trades")
def get_trades(limit: int = 100, offset: int = 0):
    return db_get_trades(limit, offset)

@app.get("/positions")
def get_positions():
    return db_get_positions()

@app.get("/reference")
def get_reference(symbol: str):
    return db_get_reference(symbol)

@app.get("/prices")
def get_prices(symbol: str):
    return db_get_prices(symbol)

@app.get("/rates")
def get_rates(currency: str):
    return db_get_rates(currency)