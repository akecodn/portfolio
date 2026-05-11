from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends

from ..auth import require_positions_access
from ..db import get_positions as db_get_positions
from ..db import get_symbol_account_pnl_trends as db_get_symbol_account_pnl_trends
from ..db import get_symbol_pnl_trends as db_get_symbol_pnl_trends
from ..db import get_symbol_trade_history as db_get_symbol_trade_history
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
    books: Optional[str] = None,
    quote: Optional[str] = None,
    fee_currency: Optional[str] = None,
    include_history: bool = False,
    history_days: Optional[int] = None,
    user: dict = Depends(require_positions_access),
):
    if symbol:
        symbol = symbol.strip().upper()
    if account:
        account = account.strip()
    if book:
        book = book.strip()
    books_list = None
    if books:
        parsed_books = [item.strip() for item in books.split(",") if item.strip()]
        books_list = parsed_books if parsed_books else None
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
        books=books_list,
        quote=quote,
        fee_currency=fee_currency,
        include_history=include_history,
        history_days=history_days,
        user=user,
    )


@router.get("/positions/pnl-trends")
def get_positions_pnl_trends(
    calc_date_from: Optional[date] = None,
    calc_date_to: Optional[date] = None,
    book: Optional[str] = None,
    books: Optional[str] = None,
    symbols: Optional[str] = None,
    user: dict = Depends(require_positions_access),
):
    symbol_list = None
    if symbols:
        parsed = [item.strip().upper() for item in symbols.split(",") if item.strip()]
        symbol_list = parsed if parsed else None
    if book:
        book = book.strip()
    books_list = None
    if books:
        parsed_books = [item.strip() for item in books.split(",") if item.strip()]
        books_list = parsed_books if parsed_books else None

    return db_get_symbol_pnl_trends(
        calc_date_from=calc_date_from,
        calc_date_to=calc_date_to,
        book=book,
        books=books_list,
        symbols=symbol_list,
        user=user,
    )


@router.get("/positions/pnl-trends/accounts")
def get_positions_pnl_trends_by_accounts(
    calc_date_from: Optional[date] = None,
    calc_date_to: Optional[date] = None,
    book: Optional[str] = None,
    books: Optional[str] = None,
    symbols: Optional[str] = None,
    user: dict = Depends(require_positions_access),
):
    symbol_list = None
    if symbols:
        parsed = [item.strip().upper() for item in symbols.split(",") if item.strip()]
        symbol_list = parsed if parsed else None
    if book:
        book = book.strip()
    books_list = None
    if books:
        parsed_books = [item.strip() for item in books.split(",") if item.strip()]
        books_list = parsed_books if parsed_books else None

    return db_get_symbol_account_pnl_trends(
        calc_date_from=calc_date_from,
        calc_date_to=calc_date_to,
        book=book,
        books=books_list,
        symbols=symbol_list,
        user=user,
    )


@router.get("/positions/trade-history")
def get_positions_trade_history(
    symbol: str,
    calc_date_from: Optional[date] = None,
    calc_date_to: Optional[date] = None,
    account: Optional[str] = None,
    book: Optional[str] = None,
    books: Optional[str] = None,
    limit: int = 800,
    user: dict = Depends(require_positions_access),
):
    normalized_symbol = symbol.strip().upper()
    books_list = None
    if books:
        parsed_books = [item.strip() for item in books.split(",") if item.strip()]
        books_list = parsed_books if parsed_books else None
    if account:
        account = account.strip()
    if book:
        book = book.strip()

    return db_get_symbol_trade_history(
        symbol=normalized_symbol,
        calc_date_from=calc_date_from,
        calc_date_to=calc_date_to,
        account=account,
        book=book,
        books=books_list,
        limit=limit,
        user=user,
    )
