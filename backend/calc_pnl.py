from decimal import Decimal
from services.pnl import PnlState, Trade, PositionId
from services.db import get_trades_until, get_price_at, save_snapshot

def run(calc_date):
    state = PnlState()
    rows = get_trades_until(calc_date)
    for row in rows:
        pos_id = PositionId(row[0], row[1], row[2], row[3])
        trade = Trade(row[4], pos_id, Decimal(str(row[6])), Decimal(str(row[5])), Decimal(str(row[7])))
        state.apply_trade(trade)
    
    for pos_id, position in state._positions.items():
        mark_price = get_price_at(pos_id.symbol, calc_date)
        if mark_price:
            position.update_mark_price(mark_price)
        save_snapshot(calc_date, position)
