from decimal import Decimal

import psycopg2

from .config import DB_CONFIG
from .config import AUTH_ADMIN_PASSWORD, AUTH_ADMIN_USERNAME
from .security import hash_password

_positions_snapshot_schema_ready = False


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
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS app_users (
            id BIGSERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            is_admin BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_permissions (
            user_id BIGINT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
            can_view_positions BOOLEAN NOT NULL DEFAULT TRUE,
            can_view_books BOOLEAN NOT NULL DEFAULT TRUE,
            can_manage_access BOOLEAN NOT NULL DEFAULT FALSE
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_book_access (
            user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
            book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, book_id)
        );
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS user_book_access_user_idx ON user_book_access (user_id);")
    if AUTH_ADMIN_USERNAME and AUTH_ADMIN_PASSWORD:
        cur.execute("SELECT id FROM app_users WHERE username = %s", [AUTH_ADMIN_USERNAME])
        existing_admin = cur.fetchone()
        if existing_admin is None:
            cur.execute(
                """
                INSERT INTO app_users (username, password_hash, is_active, is_admin)
                VALUES (%s, %s, TRUE, TRUE)
                RETURNING id
                """,
                [AUTH_ADMIN_USERNAME, hash_password(AUTH_ADMIN_PASSWORD)],
            )
            admin_id = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO user_permissions (user_id, can_view_positions, can_view_books, can_manage_access)
                VALUES (%s, TRUE, TRUE, TRUE)
                """,
                [admin_id],
            )
    cur.execute(
        """
        INSERT INTO user_permissions (user_id)
        SELECT u.id
        FROM app_users u
        LEFT JOIN user_permissions up ON up.user_id = u.id
        WHERE up.user_id IS NULL
        """
    )
    connect.commit()
    cur.close()
    connect.close()


def ensure_positions_snapshot_schema():
    global _positions_snapshot_schema_ready
    if _positions_snapshot_schema_ready:
        return
    connect = get_connection()
    cur = connect.cursor()
    cur.execute("ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS calc_time TIMESTAMPTZ;")
    cur.execute(
        """
        UPDATE snapshots
        SET calc_time = COALESCE(calc_time, calc_date::timestamptz)
        WHERE calc_time IS NULL
        """
    )
    cur.execute("ALTER TABLE snapshots ALTER COLUMN calc_time SET NOT NULL;")
    cur.execute("CREATE INDEX IF NOT EXISTS snapshots_calc_time_idx ON snapshots (calc_time DESC);")
    cur.execute("DROP VIEW IF EXISTS positions;")
    cur.execute(
        """
        CREATE VIEW positions AS
        SELECT
            s.calc_date,
            s.calc_time,
            s.symbol,
            s.account,
            s.quote,
            s.fee_currency,
            s.qty,
            s.avg_open_price,
            s.mark_price,
            s.fee,
            s.fee_usd,
            s.realized_pnl,
            s.unrealized_pnl,
            s.net_pl_usd,
            b.name AS book
        FROM snapshots AS s
        LEFT JOIN book_accounts AS ba ON ba.account = s.account
        LEFT JOIN books AS b ON b.id = ba.book_id
        """
    )
    connect.commit()
    cur.close()
    connect.close()
    _positions_snapshot_schema_ready = True


def _map_user_row(row, position_book_ids=None):
    return {
        "id": row[0],
        "username": row[1],
        "is_active": bool(row[2]),
        "is_admin": bool(row[3]),
        "permissions": {
            "can_view_positions": bool(row[4]),
            "can_view_books": bool(row[5]),
            "can_manage_access": bool(row[6]),
        },
        "position_book_ids": list(position_book_ids or []),
    }


def _get_position_book_ids(cur, user_id):
    cur.execute(
        """
        SELECT book_id
        FROM user_book_access
        WHERE user_id = %s
        ORDER BY book_id
        """,
        [user_id],
    )
    return [row[0] for row in cur.fetchall()]


def _get_position_book_map(cur, user_ids):
    if not user_ids:
        return {}
    cur.execute(
        """
        SELECT user_id,
               COALESCE(ARRAY_AGG(book_id ORDER BY book_id), ARRAY[]::BIGINT[]) AS book_ids
        FROM user_book_access
        WHERE user_id = ANY(%s)
        GROUP BY user_id
        """,
        [user_ids],
    )
    return {row[0]: list(row[1] or []) for row in cur.fetchall()}


def get_user_by_username(username):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(
        """
        SELECT u.id, u.username, u.is_active, u.is_admin, u.password_hash,
               up.can_view_positions, up.can_view_books, up.can_manage_access
        FROM app_users u
        JOIN user_permissions up ON up.user_id = u.id
        WHERE u.username = %s
        """,
        [username],
    )
    row = cur.fetchone()
    if row is None:
        cur.close()
        connect.close()
        return None
    position_book_ids = _get_position_book_ids(cur, row[0])
    user = _map_user_row((row[0], row[1], row[2], row[3], row[5], row[6], row[7]), position_book_ids)
    user["password_hash"] = row[4]
    cur.close()
    connect.close()
    return user


def get_user_by_id(user_id):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(
        """
        SELECT u.id, u.username, u.is_active, u.is_admin,
               up.can_view_positions, up.can_view_books, up.can_manage_access
        FROM app_users u
        JOIN user_permissions up ON up.user_id = u.id
        WHERE u.id = %s
        """,
        [user_id],
    )
    row = cur.fetchone()
    if row is None:
        cur.close()
        connect.close()
        return None
    position_book_ids = _get_position_book_ids(cur, row[0])
    user = _map_user_row(row, position_book_ids)
    cur.close()
    connect.close()
    return user


def get_users():
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(
        """
        SELECT u.id, u.username, u.is_active, u.is_admin,
               up.can_view_positions, up.can_view_books, up.can_manage_access
        FROM app_users u
        JOIN user_permissions up ON up.user_id = u.id
        ORDER BY u.username
        """
    )
    rows = cur.fetchall()
    user_ids = [row[0] for row in rows]
    position_book_map = _get_position_book_map(cur, user_ids)
    users = [_map_user_row(row, position_book_map.get(row[0], [])) for row in rows]
    cur.close()
    connect.close()
    return users


def create_user(username, password, is_admin):
    ensure_books_schema()
    clean_username = username.strip()
    if not clean_username:
        raise ValueError("Username is required.")
    if not password:
        raise ValueError("Password is required.")

    connect = get_connection()
    cur = connect.cursor()
    cur.execute(
        """
        INSERT INTO app_users (username, password_hash, is_active, is_admin)
        VALUES (%s, %s, TRUE, %s)
        RETURNING id
        """,
        [clean_username, hash_password(password), bool(is_admin)],
    )
    user_id = cur.fetchone()[0]
    cur.execute(
        """
        INSERT INTO user_permissions (user_id, can_view_positions, can_view_books, can_manage_access)
        VALUES (%s, TRUE, TRUE, %s)
        """,
        [user_id, bool(is_admin)],
    )
    connect.commit()
    cur.close()
    connect.close()
    return get_user_by_id(user_id)


def update_user_permissions(user_id, can_view_positions, can_view_books, can_manage_access):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    cur.execute("SELECT id, is_admin FROM app_users WHERE id = %s", [user_id])
    row = cur.fetchone()
    if row is None:
        cur.close()
        connect.close()
        raise KeyError("User not found")
    if row[1]:
        can_manage_access = True
        can_view_positions = True
        can_view_books = True
    cur.execute(
        """
        UPDATE user_permissions
        SET can_view_positions = %s,
            can_view_books = %s,
            can_manage_access = %s
        WHERE user_id = %s
        """,
        [bool(can_view_positions), bool(can_view_books), bool(can_manage_access), user_id],
    )
    connect.commit()
    cur.close()
    connect.close()
    return get_user_by_id(user_id)


def update_user_position_books(user_id, book_ids):
    ensure_books_schema()
    normalized_book_ids = sorted({int(book_id) for book_id in book_ids if int(book_id) > 0})

    connect = get_connection()
    cur = connect.cursor()
    cur.execute("SELECT id, is_admin FROM app_users WHERE id = %s", [user_id])
    row = cur.fetchone()
    if row is None:
        cur.close()
        connect.close()
        raise KeyError("User not found")

    if row[1]:
        cur.execute("DELETE FROM user_book_access WHERE user_id = %s", [user_id])
        connect.commit()
        cur.close()
        connect.close()
        return get_user_by_id(user_id)

    if normalized_book_ids:
        cur.execute("SELECT id FROM books WHERE id = ANY(%s)", [normalized_book_ids])
        existing_book_ids = {book_row[0] for book_row in cur.fetchall()}
        missing_book_ids = [book_id for book_id in normalized_book_ids if book_id not in existing_book_ids]
        if missing_book_ids:
            cur.close()
            connect.close()
            raise ValueError("One or more books do not exist.")

    cur.execute("DELETE FROM user_book_access WHERE user_id = %s", [user_id])
    if normalized_book_ids:
        cur.executemany(
            "INSERT INTO user_book_access (user_id, book_id) VALUES (%s, %s)",
            [(user_id, book_id) for book_id in normalized_book_ids],
        )
    connect.commit()
    cur.close()
    connect.close()
    return get_user_by_id(user_id)


def get_positions(
    calc_date=None,
    calc_date_from=None,
    calc_date_to=None,
    symbol=None,
    account=None,
    book=None,
    books=None,
    quote=None,
    fee_currency=None,
    include_history=False,
    history_days=None,
    user=None,
):
    ensure_books_schema()
    ensure_positions_snapshot_schema()
    connect = get_connection()
    cur = connect.cursor()
    query = (
        "SELECT p.calc_date, p.calc_time, p.symbol, p.account, b.name AS book, p.quote, p.fee_currency, p.qty, p.avg_open_price, "
        "p.mark_price, p.fee, p.fee_usd, p.realized_pnl, p.unrealized_pnl, p.net_pl_usd "
        "FROM positions p "
        "LEFT JOIN book_accounts ba ON ba.account = p.account "
        "LEFT JOIN books b ON b.id = ba.book_id"
    )

    where_clauses = ["b.id IS NOT NULL"]
    params = []

    if user and not user.get("is_admin", False):
        allowed_book_ids = _get_position_book_ids(cur, user["id"])
        if allowed_book_ids:
            where_clauses.append("b.id = ANY(%s)")
            params.append(allowed_book_ids)

    if calc_date is not None:
        where_clauses.append("p.calc_time::date = %s")
        params.append(calc_date)
    elif include_history:
        if calc_date_from is not None and calc_date_to is not None:
            where_clauses.append("p.calc_time::date BETWEEN %s AND %s")
            params.extend([calc_date_from, calc_date_to])
        elif calc_date_from is not None:
            where_clauses.append("p.calc_time::date >= %s")
            params.append(calc_date_from)
        elif calc_date_to is not None:
            where_clauses.append("p.calc_time::date <= %s")
            params.append(calc_date_to)
        else:
            safe_days = 30
            if history_days is not None:
                try:
                    safe_days = max(1, min(int(history_days), 3650))
                except Exception:
                    safe_days = 30
            where_clauses.append(
                "p.calc_time >= (SELECT MAX(calc_time) FROM positions) - (%s * INTERVAL '1 day')"
            )
            params.append(safe_days)
    else:
        if calc_date_from is not None and calc_date_to is not None:
            where_clauses.append("p.calc_time::date BETWEEN %s AND %s")
            params.extend([calc_date_from, calc_date_to])
        elif calc_date_from is not None:
            where_clauses.append("p.calc_time::date >= %s")
            params.append(calc_date_from)
        elif calc_date_to is not None:
            where_clauses.append("p.calc_time::date <= %s")
            params.append(calc_date_to)
        else:
            where_clauses.append("p.calc_time::date = (SELECT MAX(calc_time::date) FROM positions)")

    if symbol:
        where_clauses.append("p.symbol = %s")
        params.append(symbol)
    if account:
        where_clauses.append("p.account = %s")
        params.append(account)
    book_filters = []
    if book:
        book_filters.append(str(book).strip())
    if books:
        book_filters.extend([str(item).strip() for item in books if str(item).strip()])
    if book_filters:
        unique_book_filters = list(dict.fromkeys(book_filters))
        where_clauses.append("b.name = ANY(%s)")
        params.append(unique_book_filters)
    if quote:
        where_clauses.append("p.quote = %s")
        params.append(quote)
    if fee_currency:
        where_clauses.append("p.fee_currency = %s")
        params.append(fee_currency)

    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " ORDER BY p.calc_time DESC, p.symbol, p.account"

    cur.execute(query, params)
    rows = cur.fetchall()
    cols = [desc[0] for desc in cur.description]
    cur.close()
    connect.close()
    return [dict(zip(cols, row)) for row in rows]


def _apply_trade_to_symbol_state(state, qty, price, fee):
    remaining = qty
    if qty > 0:
        while remaining > 0 and state["short_lots"]:
            lot_qty, lot_price = state["short_lots"][0]
            matched = min(remaining, lot_qty)
            state["realized"] += (lot_price - price) * matched
            next_qty = lot_qty - matched
            if next_qty <= 0:
                state["short_lots"].pop(0)
            else:
                state["short_lots"][0] = (next_qty, lot_price)
            remaining -= matched
        if remaining > 0:
            state["long_lots"].append((remaining, price))
    else:
        remaining = -qty
        while remaining > 0 and state["long_lots"]:
            lot_qty, lot_price = state["long_lots"][0]
            matched = min(remaining, lot_qty)
            state["realized"] += (price - lot_price) * matched
            next_qty = lot_qty - matched
            if next_qty <= 0:
                state["long_lots"].pop(0)
            else:
                state["long_lots"][0] = (next_qty, lot_price)
            remaining -= matched
        if remaining > 0:
            state["short_lots"].append((remaining, price))

    state["realized"] -= fee


def _get_trade_rows_for_trends(
    cur,
    calc_date_from=None,
    calc_date_to=None,
    book=None,
    books=None,
    symbols=None,
    user=None,
):
    query = (
        "SELECT t.symbol, t.account, t.time, t.qty, t.price, t.fee "
        "FROM trades t "
        "LEFT JOIN book_accounts ba ON ba.account = t.account "
        "LEFT JOIN books b ON b.id = ba.book_id"
    )

    where_clauses = ["b.id IS NOT NULL"]
    params = []

    if user and not user.get("is_admin", False):
        allowed_book_ids = _get_position_book_ids(cur, user["id"])
        if allowed_book_ids:
            where_clauses.append("b.id = ANY(%s)")
            params.append(allowed_book_ids)

    if calc_date_from is not None:
        where_clauses.append("t.time::date >= %s")
        params.append(calc_date_from)
    if calc_date_to is not None:
        where_clauses.append("t.time::date <= %s")
        params.append(calc_date_to)
    book_filters = []
    if book:
        book_filters.append(str(book).strip())
    if books:
        book_filters.extend([str(item).strip() for item in books if str(item).strip()])
    if book_filters:
        unique_book_filters = list(dict.fromkeys(book_filters))
        where_clauses.append("b.name = ANY(%s)")
        params.append(unique_book_filters)
    if symbols:
        where_clauses.append("t.symbol = ANY(%s)")
        params.append(symbols)

    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " ORDER BY t.symbol, t.account, t.time"

    cur.execute(query, params)
    return cur.fetchall()


def get_symbol_trade_history(
    symbol,
    calc_date_from=None,
    calc_date_to=None,
    account=None,
    book=None,
    books=None,
    user=None,
    limit=800,
):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    query = (
        "SELECT t.time, t.symbol, t.account, b.name AS book, t.quote, t.fee_currency, t.qty, t.price, t.fee "
        "FROM trades t "
        "LEFT JOIN book_accounts ba ON ba.account = t.account "
        "LEFT JOIN books b ON b.id = ba.book_id"
    )

    where_clauses = ["b.id IS NOT NULL"]
    params = []

    if user and not user.get("is_admin", False):
        allowed_book_ids = _get_position_book_ids(cur, user["id"])
        if allowed_book_ids:
            where_clauses.append("b.id = ANY(%s)")
            params.append(allowed_book_ids)

    normalized_symbol = str(symbol or "").strip().upper()
    if normalized_symbol:
        where_clauses.append("t.symbol = %s")
        params.append(normalized_symbol)

    if calc_date_from is not None:
        where_clauses.append("t.time::date >= %s")
        params.append(calc_date_from)
    if calc_date_to is not None:
        where_clauses.append("t.time::date <= %s")
        params.append(calc_date_to)
    if account:
        where_clauses.append("t.account = %s")
        params.append(str(account).strip())

    book_filters = []
    if book:
        book_filters.append(str(book).strip())
    if books:
        book_filters.extend([str(item).strip() for item in books if str(item).strip()])
    if book_filters:
        unique_book_filters = list(dict.fromkeys(book_filters))
        where_clauses.append("b.name = ANY(%s)")
        params.append(unique_book_filters)

    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)

    safe_limit = 800
    try:
        safe_limit = max(1, min(int(limit), 5000))
    except Exception:
        safe_limit = 800

    query += " ORDER BY t.time DESC LIMIT %s"
    params.append(safe_limit)

    cur.execute(query, params)
    rows = cur.fetchall()
    cur.close()
    connect.close()

    result = []
    for trade_time, trade_symbol, trade_account, trade_book, trade_quote, trade_fee_currency, qty, price, fee in rows:
        qty_dec = Decimal(str(qty))
        result.append(
            {
                "time": trade_time.isoformat() if hasattr(trade_time, "isoformat") else str(trade_time),
                "symbol": str(trade_symbol or "").strip().upper(),
                "account": trade_account,
                "book": trade_book,
                "quote": str(trade_quote or "").strip().upper() if trade_quote is not None else None,
                "fee_currency": str(trade_fee_currency or "").strip().upper() if trade_fee_currency is not None else None,
                "side": "Buy" if qty_dec >= 0 else "Sell",
                "qty": qty,
                "price": price,
                "fee": fee,
            }
        )
    return result


def get_symbol_pnl_trends(
    calc_date_from=None,
    calc_date_to=None,
    book=None,
    books=None,
    symbols=None,
    user=None,
):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    rows = _get_trade_rows_for_trends(
        cur,
        calc_date_from=calc_date_from,
        calc_date_to=calc_date_to,
        book=book,
        books=books,
        symbols=symbols,
        user=user,
    )
    cur.close()
    connect.close()

    trend_by_symbol = {}
    state_by_symbol = {}
    for symbol, _account, _time, qty, price, fee in rows:
        if not symbol:
            continue
        key = str(symbol).strip().upper()
        if not key:
            continue

        state = state_by_symbol.get(key)
        if state is None:
            state = {
                "long_lots": [],
                "short_lots": [],
                "realized": Decimal("0"),
            }
            state_by_symbol[key] = state

        qty_dec = Decimal(str(qty))
        price_dec = Decimal(str(price))
        fee_dec = Decimal(str(fee or 0))
        _apply_trade_to_symbol_state(state, qty_dec, price_dec, fee_dec)

        if key not in trend_by_symbol:
            trend_by_symbol[key] = []
        trend_by_symbol[key].append(float(state["realized"]))

    return trend_by_symbol


def get_symbol_account_pnl_trends(
    calc_date_from=None,
    calc_date_to=None,
    book=None,
    books=None,
    symbols=None,
    user=None,
):
    ensure_books_schema()
    connect = get_connection()
    cur = connect.cursor()
    rows = _get_trade_rows_for_trends(
        cur,
        calc_date_from=calc_date_from,
        calc_date_to=calc_date_to,
        book=book,
        books=books,
        symbols=symbols,
        user=user,
    )
    cur.close()
    connect.close()

    state_by_key = {}
    trend_by_symbol = {}

    for symbol, account, _time, qty, price, fee in rows:
        if not symbol or not account:
            continue
        symbol_key = str(symbol).strip().upper()
        account_key = str(account).strip()
        if not symbol_key or not account_key:
            continue

        composite_key = (symbol_key, account_key)
        state = state_by_key.get(composite_key)
        if state is None:
            state = {
                "long_lots": [],
                "short_lots": [],
                "realized": Decimal("0"),
            }
            state_by_key[composite_key] = state

        qty_dec = Decimal(str(qty))
        price_dec = Decimal(str(price))
        fee_dec = Decimal(str(fee or 0))
        _apply_trade_to_symbol_state(state, qty_dec, price_dec, fee_dec)

        if symbol_key not in trend_by_symbol:
            trend_by_symbol[symbol_key] = {}
        if account_key not in trend_by_symbol[symbol_key]:
            trend_by_symbol[symbol_key][account_key] = []
        trend_by_symbol[symbol_key][account_key].append(
            {
                "time": _time.isoformat() if hasattr(_time, "isoformat") else str(_time),
                "value": float(state["realized"]),
            }
        )

    return trend_by_symbol


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

    if unique_accounts:
        cur.execute(
            """
            SELECT account
            FROM book_accounts
            WHERE account = ANY(%s) AND book_id <> %s
            LIMIT 1
            """,
            [unique_accounts, book_id],
        )
        if cur.fetchone() is not None:
            cur.close()
            connect.close()
            raise ValueError("One or more accounts are already assigned to another book.")

    cur.execute("DELETE FROM book_accounts WHERE book_id = %s", [book_id])
    if unique_accounts:
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
