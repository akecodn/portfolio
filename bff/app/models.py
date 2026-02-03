from decimal import Decimal
from typing import Optional
from pydantic import BaseModel

class PositionOut(BaseModel):
    symbol: str
    account: str
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
