from fastapi import FastAPI
from services.db import insert_trade, insert_price, insert_rate, insert_reference

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
