GET_TRADES = "SELECT symbol, account, quote, fee_currency, time, price, qty, fee FROM trades ORDER BY time"

GET_PRICE = "SELECT price FROM prices WHERE symbol = %s ORDER BY time DESC LIMIT 1"

GET_RATE = "SELECT rate FROM rates WHERE currency = %s ORDER BY time DESC LIMIT 1"

SAVE_POSITION = """\
INSERT INTO positions (symbol, account, quote, fee_currency, qty, avg_open_price, mark_price, fee, fee_usd, realized_pnl, unrealized_pnl, net_pl_usd)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (symbol, account, quote, fee_currency)
DO UPDATE SET
    qty = EXCLUDED.qty,
    avg_open_price = EXCLUDED.avg_open_price,
    mark_price = EXCLUDED.mark_price,
    fee = EXCLUDED.fee,
    fee_usd = EXCLUDED.fee_usd,
    realized_pnl = EXCLUDED.realized_pnl,
    unrealized_pnl = EXCLUDED.unrealized_pnl,
    net_pl_usd = EXCLUDED.net_pl_usd"""
