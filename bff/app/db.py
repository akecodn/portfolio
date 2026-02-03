import psycopg2
from .config import DB_CONFIG

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def get_positions(calc_date=None, symbol=None, account=None, quote=None, fee_currency=None):
    connect = get_connection()
    cur = connect.cursor()
    query = ("SELECT symbol, account, quote, fee_currency, qty, avg_open_price, mark_price, fee, fee_usd, "
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
    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " ORDER BY symbol, account"

    cur.execute(query, params)
    rows = cur.fetchall()
    cols = [desc[0] for desc in cur.description]
    cur.close()
    connect.close()
    return [dict(zip(cols, row)) for row in rows]
