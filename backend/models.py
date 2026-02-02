from pydantic import BaseModel, Field
from datetime import datetime
from decimal import Decimal


class TradeInput(BaseModel):
    symbol: str = Field(min_length=1)
    account: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    fee_currency: str = Field(min_length=1)
    time: datetime
    price: Decimal
    qty: Decimal
    fee: Decimal


class PriceInput(BaseModel):
    symbol: str = Field(min_length=1)
    price: Decimal
    time: datetime


class RateInput(BaseModel):
    currency: str = Field(min_length=1)
    rate: Decimal
    time: datetime


class ReferenceInput(BaseModel):
    symbol: str = Field(min_length=1)
    base_currency: str = Field(min_length=1)
    quote_currency: str = Field(min_length=1)
    exchange: str = Field(min_length=1)
    type: str = Field(min_length=1)
