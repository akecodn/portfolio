import psycopg2

from .config import DB_CONFIG


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def ensure_books_schema():
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS books (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS book_accounts (
            book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            account TEXT NOT NULL,
            PRIMARY KEY (book_id, account),
            UNIQUE (account)
        );
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS book_accounts_account_idx ON book_accounts (account);")
    connect.commit()
    cur.close()
    connect.close()


def get_positions(
    calc_date=None,
    calc_date_from=None,
    calc_date_to=None,
    symbol=None,
    account=None,
    book=None,
    quote=None,
    fee_currency=None,
):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    query = (
        "SELECT p.symbol, p.account, b.name AS book, p.quote, p.fee_currency, p.qty, p.avg_open_price, "
        "p.mark_price, p.fee, p.fee_usd, p.realized_pnl, p.unrealized_pnl, p.net_pl_usd "
        "FROM positions p "
        "LEFT JOIN book_accounts ba ON ba.account = p.account "
        "LEFT JOIN books b ON b.id = ba.book_id"
    )

    where_clauses = ["b.id IS NOT NULL"]
    params = []

    if calc_date is not None:
        where_clauses.append("p.calc_date = %s")
        params.append(calc_date)
    else:
        if calc_date_from is not None and calc_date_to is not None:
            where_clauses.append(
                "p.calc_date = (SELECT MAX(calc_date) FROM positions WHERE calc_date BETWEEN %s AND %s)"
            )
            params.extend([calc_date_from, calc_date_to])
        elif calc_date_from is not None:
            where_clauses.append(
                "p.calc_date = (SELECT MAX(calc_date) FROM positions WHERE calc_date >= %s)"
            )
            params.append(calc_date_from)
        elif calc_date_to is not None:
            where_clauses.append(
                "p.calc_date = (SELECT MAX(calc_date) FROM positions WHERE calc_date <= %s)"
            )
            params.append(calc_date_to)
        else:
            where_clauses.append("p.calc_date = (SELECT MAX(calc_date) FROM positions)")

    if symbol:
        where_clauses.append("p.symbol = %s")
        params.append(symbol)
    if account:
        where_clauses.append("p.account = %s")
        params.append(account)
    if book:
        where_clauses.append("b.name = %s")
        params.append(book)
    if quote:
        where_clauses.append("p.quote = %s")
        params.append(quote)
    if fee_currency:
        where_clauses.append("p.fee_currency = %s")
        params.append(fee_currency)

    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " ORDER BY p.symbol, p.account"

    cur.execute(query, params)
    rows = cur.fetchall()
    cols = [desc[0] for desc in cur.description]
    cur.close()
    connect.close()
    return [dict(zip(cols, row)) for row in rows]


def get_accounts():
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(
        """
        SELECT account
        FROM (
            SELECT DISTINCT account FROM snapshots
            UNION
            SELECT DISTINCT account FROM trades
            UNION
            SELECT DISTINCT account FROM book_accounts
        ) all_accounts
        WHERE account IS NOT NULL
        ORDER BY account;
        """
    )
    rows = cur.fetchall()
    cur.close()
    connect.close()
    return [row[0] for row in rows]


def _fetch_book_by_id(cur, book_id):
    cur.execute(
        """
        SELECT b.id, b.name,
               COALESCE(
                   ARRAY_AGG(ba.account ORDER BY ba.account)
                   FILTER (WHERE ba.account IS NOT NULL),
                   ARRAY[]::TEXT[]
               ) AS accounts
        FROM books b
        LEFT JOIN book_accounts ba ON ba.book_id = b.id
        WHERE b.id = %s
        GROUP BY b.id, b.name;
        """,
        [book_id],
    )
    row = cur.fetchone()
    if row is None:
        return None
    return {"id": row[0], "name": row[1], "accounts": list(row[2] or [])}


def get_books():
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(
        """
        SELECT b.id, b.name,
               COALESCE(
                   ARRAY_AGG(ba.account ORDER BY ba.account)
                   FILTER (WHERE ba.account IS NOT NULL),
                   ARRAY[]::TEXT[]
               ) AS accounts
        FROM books b
        LEFT JOIN book_accounts ba ON ba.book_id = b.id
        GROUP BY b.id, b.name
        ORDER BY b.name;
        """
    )
    rows = cur.fetchall()
    cur.close()
    connect.close()
    return [{"id": row[0], "name": row[1], "accounts": list(row[2] or [])} for row in rows]


def create_book(name):
    ensure_books_schema()
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Book name is required.")

    connect = get_connection()
    cur = connect.cursor()
    cur.execute("INSERT INTO books (name) VALUES (%s) RETURNING id", [clean_name])
    book_id = cur.fetchone()[0]
    connect.commit()
    book = _fetch_book_by_id(cur, book_id)
    cur.close()
    connect.close()
    return book


def update_book_accounts(book_id, accounts):
    ensure_books_schema()
    unique_accounts = []
    seen = set()
    for account in accounts:
        clean_account = account.strip()
        if clean_account and clean_account not in seen:
            seen.add(clean_account)
            unique_accounts.append(clean_account)

    connect = get_connection()
    cur = connect.cursor()
    cur.execute("SELECT 1 FROM books WHERE id = %s", [book_id])
    if cur.fetchone() is None:
        cur.close()
        connect.close()
        raise KeyError("Book not found")

    cur.execute("DELETE FROM book_accounts WHERE book_id = %s", [book_id])
    if unique_accounts:
        cur.execute("DELETE FROM book_accounts WHERE account = ANY(%s)", [unique_accounts])
        cur.executemany(
            "INSERT INTO book_accounts (book_id, account) VALUES (%s, %s)",
            [(book_id, account) for account in unique_accounts],
        )

    connect.commit()
    book = _fetch_book_by_id(cur, book_id)
    cur.close()
    connect.close()
    return book


def delete_book(book_id):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    cur.execute("DELETE FROM books WHERE id = %s RETURNING id", [book_id])
    deleted = cur.fetchone() is not None
    connect.commit()
    cur.close()
    connect.close()
    return deleted
