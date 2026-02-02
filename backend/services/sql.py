GET_TRADES = "SELECT symbol, account, quote, fee_currency, time, price, qty, fee FROM trades ORDER BY time"

GET_TRADES_PAGINATED = "SELECT symbol, account, quote, fee_currency, time, price, qty, fee FROM trades ORDER BY time LIMIT %s OFFSET %s"

GET_TRADES_UNTIL = "SELECT symbol, account, quote, fee_currency, time, price, qty, fee FROM trades WHERE time::date <= %s ORDER BY time"

GET_PRICE = "SELECT price FROM prices WHERE symbol = %s ORDER BY time DESC LIMIT 1"

GET_PRICE_AT = "SELECT price FROM prices WHERE symbol = %s AND time::date <= %s ORDER BY time DESC LIMIT 1"

GET_RATE = "SELECT rate FROM rates WHERE currency = %s ORDER BY time DESC LIMIT 1"

GET_POSITIONS = "SELECT symbol, account, qty, avg_open_price, mark_price, realized_pnl, unrealized_pnl, net_pl_usd FROM snapshots WHERE calc_date = (SELECT MAX(calc_date) FROM snapshots) ORDER BY symbol"

GET_REFERENCE = "SELECT base_currency, quote_currency, exchange, type FROM reference WHERE symbol = %s"

GET_PRICES = "SELECT price, time FROM prices WHERE symbol = %s ORDER BY time DESC"

GET_RATES = "SELECT rate, time FROM rates WHERE currency = %s ORDER BY time DESC"

INSERT_TRADE = """INSERT INTO trades (symbol, account, quote, fee_currency, time, price, qty, fee) 
VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING"""

INSERT_PRICE = """INSERT INTO prices (symbol, price, time) 
VALUES (%s, %s, %s) ON CONFLICT DO NOTHING"""

INSERT_RATE = """INSERT INTO rates (currency, rate, time) 
VALUES (%s, %s, %s) ON CONFLICT DO NOTHING"""

INSERT_REFERENCE = "INSERT INTO reference (symbol, base_currency, quote_currency, exchange, type) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (symbol) DO NOTHING"

SAVE_SNAPSHOT = """\
INSERT INTO snapshots (calc_date, symbol, account, quote, fee_currency, qty, avg_open_price, mark_price, fee, fee_usd, realized_pnl, unrealized_pnl, net_pl_usd)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (calc_date, symbol, account, quote, fee_currency)
DO UPDATE SET
    qty = EXCLUDED.qty,
    avg_open_price = EXCLUDED.avg_open_price,
    mark_price = EXCLUDED.mark_price,
    fee = EXCLUDED.fee,
    fee_usd = EXCLUDED.fee_usd,
    realized_pnl = EXCLUDED.realized_pnl,
    unrealized_pnl = EXCLUDED.unrealized_pnl,
    net_pl_usd = EXCLUDED.net_pl_usd"""
