from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class PositionOut(BaseModel):
    calc_date: Optional[date] = None
    calc_time: Optional[datetime] = None
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


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)


class PermissionsOut(BaseModel):
    can_view_positions: bool
    can_view_books: bool
    can_manage_access: bool


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool
    is_active: bool
    permissions: PermissionsOut
    position_book_ids: list[int] = Field(default_factory=list)


class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)
    is_admin: bool = False


class UserPermissionsIn(BaseModel):
    can_view_positions: bool = True
    can_view_books: bool = True
    can_manage_access: bool = False


class UserPositionBooksIn(BaseModel):
    book_ids: list[int] = Field(default_factory=list)


UserOut.model_rebuild()
