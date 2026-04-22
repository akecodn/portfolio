from datetime import date
from typing import Optional

from fastapi import APIRouter

from ..db import get_positions as db_get_positions
from ..models import PositionOut

router = APIRouter()


@router.get("/positions", response_model=list[PositionOut])
def get_positions(
    calc_date: Optional[date] = None,
    calc_date_from: Optional[date] = None,
    calc_date_to: Optional[date] = None,
    symbol: Optional[str] = None,
    account: Optional[str] = None,
    book: Optional[str] = None,
    quote: Optional[str] = None,
    fee_currency: Optional[str] = None,
):
    if symbol:
        symbol = symbol.strip().upper()
    if account:
        account = account.strip()
    if book:
        book = book.strip()
    if quote:
        quote = quote.strip().upper()
    if fee_currency:
        fee_currency = fee_currency.strip().upper()

    return db_get_positions(
        calc_date=calc_date,
        calc_date_from=calc_date_from,
        calc_date_to=calc_date_to,
        symbol=symbol,
        account=account,
        book=book,
        quote=quote,
        fee_currency=fee_currency,
    )
