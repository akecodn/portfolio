from decimal import Decimal

EPS = Decimal("1e-18")

class PositionId:
    def __init__(self, symbol, account, quote, fee_currency):
        self.symbol = symbol
        self.account = account
        self.quote = quote
        self.fee_currency = fee_currency

    def __hash__(self):
        return hash((self.symbol, self.account, self.quote, self.fee_currency))

    def __eq__(self, other):
        if not isinstance(other, PositionId):
            return False
        return (self.symbol, self.account, self.quote, self.fee_currency) == \
               (other.symbol, other.account, other.quote, other.fee_currency)

class Trade:
    def __init__(self, time, position_id, qty, price, fee):
        self.time = time
        self.position_id = position_id
        self.qty = qty
        self.price = price
        self.fee = fee

        if self.qty == 0:
            raise ValueError("qty не может быть 0")
        if any(v != v for v in [self.qty, self.price, self.fee]):
            raise ValueError("NaN не допускается в полях Trade")

class FifoPosition:
    def __init__(self, id):
        self.id = id
        self.long_lots = []
        self.short_lots = []
        self.realized = Decimal(0)
        self.fee_total = Decimal(0)
        self.mark_price = None

    def qty(self):
        long_sum = sum(lot[0] for lot in self.long_lots)
        short_sum = sum(lot[0] for lot in self.short_lots)
        return long_sum - short_sum

    def avg_open_price(self):
        if self.long_lots:
            total_qty = sum(lot[0] for lot in self.long_lots)
            total_value = sum(lot[0] * lot[1] for lot in self.long_lots)
            if total_qty > 0:
                return total_value / total_qty
            else:
                return None
        elif self.short_lots:
            total_qty = sum(lot[0] for lot in self.short_lots)
            total_value = sum(lot[0] * lot[1] for lot in self.short_lots)
            if total_qty > 0:
                return total_value / total_qty
            else:
                return None
        else:
            return None

    def unrealized_pnl(self):
        if not self.long_lots and not self.short_lots:
            return Decimal(0)
        if self.mark_price is None:
            return None
        avg = self.avg_open_price()
        if avg is None:
            return Decimal(0)
        if self.long_lots:
            total_qty = sum(lot[0] for lot in self.long_lots)
            return (self.mark_price - avg) * total_qty
        elif self.short_lots:
            total_qty = sum(lot[0] for lot in self.short_lots)
            return (avg - self.mark_price) * total_qty
        else:
            return Decimal(0)

    def realized_pnl(self):
        return self.realized

    def pnl_quote(self):
        unrealized = self.unrealized_pnl()
        if unrealized is None:
            return None
        return self.realized + unrealized

    def fee_usd(self, rate):
        return self.fee_total * rate

    def net_pl_usd(self, quote_rate):
        total = self.pnl_quote()
        if total is None:
            return None
        return total * quote_rate

    def update_mark_price(self, price):
        self.mark_price = price
