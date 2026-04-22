from fastapi import APIRouter, HTTPException, Response, status
from psycopg2 import IntegrityError

from ..db import (
    create_book as db_create_book,
    delete_book as db_delete_book,
    get_accounts as db_get_accounts,
    get_books as db_get_books,
    set_book_accounts as db_set_book_accounts,
)
from ..models import BookAccountsIn, BookCreateIn, BookOut

router = APIRouter()


def normalize_accounts(accounts):
    normalized = []
    seen = set()
    for raw_account in accounts:
        account = raw_account.strip()
        if not account or account in seen:
            continue
        normalized.append(account)
        seen.add(account)
    return normalized


@router.get("/accounts", response_model=list[str])
def get_accounts():
    return db_get_accounts()


@router.get("/books", response_model=list[BookOut])
def get_books():
    return db_get_books()


@router.post("/books", response_model=BookOut, status_code=status.HTTP_201_CREATED)
def create_book(payload: BookCreateIn):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Book name is required.")

    try:
        return db_create_book(name)
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Book with this name already exists.")


@router.put("/books/{book_id}/accounts", response_model=BookOut)
def set_book_accounts(book_id: int, payload: BookAccountsIn):
    accounts = normalize_accounts(payload.accounts)
    try:
        return db_set_book_accounts(book_id, accounts)
    except LookupError:
        raise HTTPException(status_code=404, detail="Book not found.")
    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="One or more accounts are already assigned to another book."
        )


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: int):
    deleted = db_delete_book(book_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Book not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
