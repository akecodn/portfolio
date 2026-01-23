from decimal import Decimal
from .models import PositionId, Trade, FifoPosition, EPS

def apply_trade(position, trade):
    position.fee_total += trade.fee
    qty = trade.qty
    price = trade.price
    if qty > Decimal(0):
        remaining = qty
        while remaining > Decimal(0) and position.short_lots:
            lot_qty, lot_price = position.short_lots[0]
            count = min(remaining, lot_qty)
            realized_from_close = (lot_price - price)*count
            position.realized += realized_from_close
            new_lot_qty = lot_qty - count
            if new_lot_qty <= EPS:
                position.short_lots.pop(0)
            else:
                position.short_lots[0] = (new_lot_qty, lot_price)
            remaining -= count
        if remaining > Decimal(0):
            position.long_lots.append((remaining, price))
    else:
        remaining = -qty
        while remaining > Decimal(0) and position.long_lots:
            lot_qty, lot_price = position.long_lots[0]
            count = min(remaining, lot_qty)
            realized_from_close = (price - lot_price) * count
            position.realized += realized_from_close
            new_lot_qty = lot_qty - count
            if new_lot_qty <= EPS:
                position.long_lots.pop(0)
            else:
                position.long_lots[0] = (new_lot_qty, lot_price)
            remaining -= count
        if remaining > Decimal(0):
            position.short_lots.append((remaining, price))
    return position

class PnlState:
    def __init__(self):
        self._positions = {}
    def get_position(self, position_id):
        return self._positions.get(position_id)
    def get_or_create_position(self, position_id):
        if position_id not in self._positions:
            self._positions[position_id] = FifoPosition(id=position_id)
        return self._positions[position_id]
    def apply_trade(self, trade):
        position = self.get_or_create_position(trade.position_id)
        apply_trade(position, trade)
        return position
    def update_mark_price(self, symbol, account, quote, fee_currency, price):
        position_id = PositionId(symbol, account, quote, fee_currency)
        position = self.get_position(position_id)
        if position:
            position.update_mark_price(price)
        return position

def parse_trade(row):
    position_id = PositionId(row["symbol"], row["account"], row["quote"], row["fee_currency"])
    return Trade(
        time=row["time"],
        position_id=position_id,
        qty=Decimal(str(row["qty"])),
        price=Decimal(str(row["price"])),
        fee=Decimal(str(row["fee"]))
    )

def pos_to_dict(position, quote_rate=Decimal(1), fee_rate=Decimal(1)):
    return {
        "symbol": position.id.symbol,
        "account": position.id.account,
        "quote": position.id.quote,
        "fee_currency": position.id.fee_currency,
        "qty": str(position.qty()),
        "avg_open_price": str(position.avg_open_price()) if position.avg_open_price() else None,
        "mark_price": str(position.mark_price) if position.mark_price else None,
        "fee": str(position.fee_total),
        "fee_usd": str(position.fee_usd(fee_rate)),
        "realized_pnl": str(position.realized_pnl()),
        "unrealized_pnl": str(position.unrealized_pnl()) if position.unrealized_pnl() is not None else None,
        "net_pl_usd": str(position.net_pl_usd(quote_rate)) if position.net_pl_usd(quote_rate) is not None else None,
    }