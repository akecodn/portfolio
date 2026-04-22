import psycopg2
from .config import DB_CONFIG

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def get_positions(calc_date=None, symbol=None, account=None, quote=None, fee_currency=None, book=None):
    connect = get_connection()
    cur = connect.cursor()
    query = (
        "SELECT symbol, account, book, quote, fee_currency, qty, avg_open_price, mark_price, fee, fee_usd, "
        "realized_pnl, unrealized_pnl, net_pl_usd "
        "FROM positions"
    )
    where_clauses = []
    params = []
    if calc_date is not None:
        where_clauses.append("calc_date = %s")
        params.append(calc_date)
    else:
        where_clauses.append("calc_date = (SELECT MAX(calc_date) FROM positions)")
    if symbol:
        where_clauses.append("symbol = %s")
        params.append(symbol)
    if account:
        where_clauses.append("account = %s")
        params.append(account)
    if quote:
        where_clauses.append("quote = %s")
        params.append(quote)
    if fee_currency:
        where_clauses.append("fee_currency = %s")
        params.append(fee_currency)
    if book:
        where_clauses.append("book = %s")
        params.append(book)
    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " ORDER BY symbol, account"

    cur.execute(query, params)
    rows = cur.fetchall()
    cols = [desc[0] for desc in cur.description]
    cur.close()
    connect.close()
    return [dict(zip(cols, row)) for row in rows]


def get_accounts():
    connect = get_connection()
    cur = connect.cursor()
    query = (
        "SELECT account FROM snapshots "
        "UNION "
        "SELECT account FROM trades "
        "ORDER BY account"
    )
    cur.execute(query)
    rows = cur.fetchall()
    cur.close()
    connect.close()
    return [row[0] for row in rows if row[0] is not None]


def get_books():
    connect = get_connection()
    cur = connect.cursor()
    query = (
        "SELECT b.id, b.name, ba.account "
        "FROM books b "
        "LEFT JOIN book_accounts ba ON ba.book_id = b.id "
        "ORDER BY b.name, ba.account"
    )
    cur.execute(query)
    rows = cur.fetchall()
    cur.close()
    connect.close()

    books = []
    current = None
    current_id = None
    for book_id, name, account in rows:
        if book_id != current_id:
            current = {"id": book_id, "name": name, "accounts": []}
            books.append(current)
            current_id = book_id
        if account is not None:
            current["accounts"].append(account)
    return books


def create_book(name):
    connect = get_connection()
    cur = connect.cursor()
    try:
        cur.execute(
            "INSERT INTO books (name) VALUES (%s) RETURNING id, name",
            [name]
        )
        row = cur.fetchone()
        connect.commit()
        return {"id": row[0], "name": row[1], "accounts": []}
    except Exception:
        connect.rollback()
        raise
    finally:
        cur.close()
        connect.close()


def set_book_accounts(book_id, accounts):
    connect = get_connection()
    cur = connect.cursor()
    try:
        cur.execute("SELECT name FROM books WHERE id = %s", [book_id])
        row = cur.fetchone()
        if row is None:
            raise LookupError("book_not_found")

        book_name = row[0]
        cur.execute("DELETE FROM book_accounts WHERE book_id = %s", [book_id])
        if accounts:
            cur.executemany(
                "INSERT INTO book_accounts (book_id, account) VALUES (%s, %s)",
                [(book_id, account) for account in accounts],
            )
        connect.commit()
        return {"id": book_id, "name": book_name, "accounts": accounts}
    except Exception:
        connect.rollback()
        raise
    finally:
        cur.close()
        connect.close()


def delete_book(book_id):
    connect = get_connection()
    cur = connect.cursor()
    try:
        cur.execute("DELETE FROM books WHERE id = %s", [book_id])
        deleted = cur.rowcount > 0
        connect.commit()
        return deleted
    except Exception:
        connect.rollback()
        raise
    finally:
        cur.close()
        connect.close()
