import psycopg2
from decimal import Decimal
from . import sql

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "pnl_calculation",
    "user": "postgres",
    "password": ""
}

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def get_trades():
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.GET_TRADES)
    rows = cur.fetchall()
    cur.close()
    connect.close()
    return rows

def get_trades_until(calc_date):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.GET_TRADES_UNTIL, [calc_date])
    rows = cur.fetchall()
    cur.close()
    connect.close()
    return rows

def get_price(symbol):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.GET_PRICE, [symbol])
    row = cur.fetchone()
    cur.close()
    connect.close()
    if row:
        return Decimal(str(row[0]))
    else:
        return None

def get_price_at(symbol, calc_date):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.GET_PRICE_AT, [symbol, calc_date])
    row = cur.fetchone()
    cur.close()
    connect.close()
    if row:
        return Decimal(str(row[0]))
    else:
        return None

def get_rate(currency):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.GET_RATE, [currency])
    row = cur.fetchone()
    cur.close()
    connect.close()
    if row:
        return Decimal(str(row[0]))
    else:
        return Decimal(1)

def save_snapshot(calc_date, position):
    connect = get_connection()
    cur = connect.cursor()
    quote_rate = get_rate(position.id.quote)
    fee_rate = get_rate(position.id.fee_currency)
    cur.execute(sql.SAVE_SNAPSHOT, [calc_date, position.id.symbol, position.id.account, position.id.quote, position.id.fee_currency,
        position.qty(), position.avg_open_price(), position.mark_price, position.fee_total, position.fee_usd(fee_rate),
        position.realized_pnl(), position.unrealized_pnl(), position.net_pl_usd(quote_rate)])
    connect.commit()
    cur.close()
    connect.close()

def get_positions():
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.GET_POSITIONS)
    rows = cur.fetchall()
    cur.close()
    connect.close()
    return rows

def insert_trade(trade):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.INSERT_TRADE,
    [trade["symbol"], trade["account"], trade["quote"], trade["fee_currency"],
        trade["time"], trade["price"], trade["qty"], trade["fee"]])
    connect.commit()
    cur.close()
    connect.close()

def insert_price(price):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.INSERT_PRICE, [price["symbol"], price["price"], price["time"]])
    connect.commit()
    cur.close()
    connect.close()

def insert_rate(rate):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.INSERT_RATE, [rate["currency"], rate["rate"], rate["time"]])
    connect.commit()
    cur.close()
    connect.close()

def insert_reference(refer):
    connect = get_connection()
    cur = connect.cursor()
    cur.execute(sql.INSERT_REFERENCE, 
        [refer["symbol"], refer["base_currency"], refer["quote_currency"], refer["exchange"], refer["type"]])
    connect.commit()
    cur.close()
    connect.close()
