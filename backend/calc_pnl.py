from datetime import date as date_type
from datetime import datetime, time as time_type, timezone
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
        calc_time = position.last_trade_time
        price_calc_date = calc_time.date() if calc_time else calc_date
        mark_price = get_price_at(pos_id.symbol, price_calc_date)
        if mark_price:
            position.update_mark_price(mark_price)
        if calc_time is None:
            if isinstance(calc_date, datetime):
                calc_time = calc_date
            elif isinstance(calc_date, date_type):
                calc_time = datetime.combine(calc_date, time_type.min, tzinfo=timezone.utc)
            else:
                calc_time = datetime.now(timezone.utc)
        save_snapshot(calc_date, calc_time, position)
