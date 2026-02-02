BEGIN;

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS reference (
    symbol          TEXT PRIMARY KEY,
    base_currency   TEXT NOT NULL,
    quote_currency  TEXT NOT NULL,
    exchange        TEXT NOT NULL,
    type            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
    symbol        TEXT NOT NULL REFERENCES reference (symbol),
    account       TEXT NOT NULL,
    quote         TEXT NOT NULL,
    fee_currency  TEXT NOT NULL,
    time          TIMESTAMPTZ NOT NULL,
    price         NUMERIC(18, 8) NOT NULL,
    qty           NUMERIC(18, 8) NOT NULL,
    fee           NUMERIC(18, 8) NOT NULL
) ;
SELECT create_hypertable('trades', 'time', if_not_exists => TRUE, chunk_time_interval => interval '1 month');
CREATE INDEX IF NOT EXISTS trades_symbol_time_idx ON trades (symbol, time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS trades_uniq ON trades (symbol, account, time, price, qty);

CREATE TABLE IF NOT EXISTS prices (
    symbol   TEXT NOT NULL REFERENCES reference (symbol),
    price    NUMERIC(18, 8) NOT NULL,
    time     TIMESTAMPTZ NOT NULL
) ;
SELECT create_hypertable('prices', 'time', if_not_exists => TRUE, chunk_time_interval => interval '1 month');
CREATE INDEX IF NOT EXISTS prices_symbol_time_idx ON prices (symbol, time);
CREATE UNIQUE INDEX IF NOT EXISTS prices_uniq ON prices (symbol, time);

CREATE TABLE IF NOT EXISTS rates (
    currency  TEXT NOT NULL,
    rate      NUMERIC(18, 8) NOT NULL,
    time      TIMESTAMPTZ NOT NULL
) ;
SELECT create_hypertable('rates', 'time', if_not_exists => TRUE, chunk_time_interval => interval '1 month');
CREATE INDEX IF NOT EXISTS rates_currency_time_idx ON rates (currency, time);
CREATE UNIQUE INDEX IF NOT EXISTS rates_uniq ON rates (currency, time);

CREATE TABLE IF NOT EXISTS snapshots (
    calc_date       DATE NOT NULL,
    symbol          TEXT NOT NULL,
    account         TEXT NOT NULL,
    quote           TEXT NOT NULL,
    fee_currency    TEXT NOT NULL,
    qty             NUMERIC(18, 8) NOT NULL,
    avg_open_price  NUMERIC(18, 8),
    mark_price      NUMERIC(18, 8),
    fee             NUMERIC(18, 8) NOT NULL,
    fee_usd         NUMERIC(18, 8),
    realized_pnl    NUMERIC(18, 8) NOT NULL,
    unrealized_pnl  NUMERIC(18, 8),
    net_pl_usd      NUMERIC(18, 8),
    PRIMARY KEY (calc_date, symbol, account, quote, fee_currency)
);

COMMIT;
