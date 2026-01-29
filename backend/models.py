from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field

class TradeValid(BaseModel):
    symbol:str = Field(min_length=1)
    account:str = Field(min_length=1)
    quote:str = Field(min_length=1)
    fee_currency:str = Field(min_length=1)
    time:datetime
    price:Decimal
    qty:Decimal
    fee: Decimal

class PriceValid(BaseModel):
    symbol: str = Field(min_length=1)
    price: Decimal
    time: datetime

class RateValid(BaseModel):
    currency: str = Field(min_length=1)
    rate: Decimal
    time: datetime

class RefValid(BaseModel):
    symbol: str = Field(min_length=1)
    base_currency: str = Field(min_length=1)
    quote_currency: str = Field(min_length=1)
    exchange: str = Field(min_length=1)
    type: str = Field(min_length=1)

def normalize_trade(trade):
    trade["symbol"] = trade["symbol"].strip().upper()
    trade["account"] = trade["account"].strip()
    trade["quote"] = trade["quote"].strip().upper()
    trade["fee_currency"] = trade["fee_currency"].strip().upper()
    
    if (trade["price"] <= 0):
        raise ValueError("price must be positive")
    if (trade["qty"] == 0):
        raise ValueError("qty cannot be zero")
    if (trade["fee"] < 0):
        raise ValueError("fee cannot be negative")
    
    return trade

def normalize_price(price):
    price["symbol"] = price["symbol"].strip().upper()
    
    if (price["price"] <= 0):
        raise ValueError("price must be positive")
    
    return price

def normalize_rate(rate):
    rate["currency"] = rate["currency"].strip().upper()
    
    if (rate["rate"] <= 0):
        raise ValueError("rate must be positive")
    
    return rate

def normalize_reference(ref):
    ref["symbol"] = ref["symbol"].strip().upper()
    ref["base_currency"] = ref["base_currency"].strip().upper()
    ref["quote_currency"] = ref["quote_currency"].strip().upper()
    ref["exchange"] = ref["exchange"].strip().lower()
    ref["type"] = ref["type"].strip().lower()
    
    return ref
