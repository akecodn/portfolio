from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, Field

class PositionOut(BaseModel):
    symbol: str
    account: str
    book: Optional[str] = None
    quote: str
    fee_currency: str
    qty: Decimal
    avg_open_price: Optional[Decimal] = None
    mark_price: Optional[Decimal] = None
    fee: Decimal
    fee_usd: Optional[Decimal] = None
    realized_pnl: Decimal
    unrealized_pnl: Optional[Decimal] = None
    net_pl_usd: Optional[Decimal] = None


class BookCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class BookAccountsIn(BaseModel):
    accounts: list[str] = Field(default_factory=list)


class BookOut(BaseModel):
    id: int
    name: str
    accounts: list[str]
