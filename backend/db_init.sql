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
    symbol        TEXT NOT NULL,
    account       TEXT NOT NULL,
    quote         TEXT NOT NULL,
    fee_currency  TEXT NOT NULL,
    time          TIMESTAMPTZ NOT NULL,
    price         NUMERIC(18, 8) NOT NULL,
    qty           NUMERIC(18, 8) NOT NULL,
    fee           NUMERIC(18, 8) NOT NULL
<<<<<<< HEAD
) ;
SELECT create_hypertable('trades', 'time', if_not_exists => TRUE, chunk_time_interval => interval '1 month');
=======
);
SELECT create_hypertable('trades', 'time', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);
>>>>>>> 70b515e242298404ac81144933ec1f36cd7ad7e0
CREATE INDEX IF NOT EXISTS trades_symbol_time_idx ON trades (symbol, time DESC);

CREATE TABLE IF NOT EXISTS prices (
    symbol   TEXT NOT NULL,
    price    NUMERIC(18, 8) NOT NULL,
    time     TIMESTAMPTZ NOT NULL
<<<<<<< HEAD
) ;
SELECT create_hypertable('prices', 'time', if_not_exists => TRUE, chunk_time_interval => interval '1 month');
=======
);
SELECT create_hypertable('prices', 'time', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);
>>>>>>> 70b515e242298404ac81144933ec1f36cd7ad7e0
CREATE INDEX IF NOT EXISTS prices_symbol_time_idx ON prices (symbol, time);

CREATE TABLE IF NOT EXISTS rates (
    currency  TEXT NOT NULL,
    rate      NUMERIC(18, 8) NOT NULL,
    time      TIMESTAMPTZ NOT NULL
<<<<<<< HEAD
) ;
SELECT create_hypertable('rates', 'time', if_not_exists => TRUE, chunk_time_interval => interval '1 month');
CREATE INDEX IF NOT EXISTS rates_currency_time_idx ON rates (currency, time);
CREATE UNIQUE INDEX IF NOT EXISTS rates_uniq ON rates (currency, time);
=======
);
SELECT create_hypertable('rates', 'time', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS rates_currency_time_idx ON rates (currency, time);
>>>>>>> 70b515e242298404ac81144933ec1f36cd7ad7e0

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
