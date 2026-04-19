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
);
SELECT create_hypertable('trades', 'time', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS trades_symbol_time_idx ON trades (symbol, time DESC);

CREATE TABLE IF NOT EXISTS prices (
    symbol   TEXT NOT NULL,
    price    NUMERIC(18, 8) NOT NULL,
    time     TIMESTAMPTZ NOT NULL
);
SELECT create_hypertable('prices', 'time', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS prices_symbol_time_idx ON prices (symbol, time);

CREATE TABLE IF NOT EXISTS rates (
    currency  TEXT NOT NULL,
    rate      NUMERIC(18, 8) NOT NULL,
    time      TIMESTAMPTZ NOT NULL
);
SELECT create_hypertable('rates', 'time', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);
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

CREATE TABLE IF NOT EXISTS books (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS book_accounts (
    book_id     BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    account     TEXT NOT NULL,
    PRIMARY KEY (book_id, account),
    UNIQUE (account)
);

CREATE INDEX IF NOT EXISTS book_accounts_account_idx ON book_accounts (account);

CREATE OR REPLACE VIEW positions AS
SELECT
    s.*,
    b.name AS book
FROM snapshots AS s
LEFT JOIN book_accounts AS ba
    ON ba.account = s.account
LEFT JOIN books AS b
    ON b.id = ba.book_id;

COMMIT;
