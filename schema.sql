-- Dhulaai Express — Database Schema
-- Run: wrangler d1 execute dhulaai-db --file ./schema.sql (--local for dev, --remote for prod)

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL UNIQUE,
  created_at TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  reg_number  TEXT    NOT NULL,
  make_model  TEXT    NOT NULL DEFAULT '',
  color       TEXT    NOT NULL DEFAULT '',
  car_type    TEXT    NOT NULL,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- One-time wash price matrix: car_type × wash_type
CREATE TABLE IF NOT EXISTS wash_pricing (
  car_type   TEXT NOT NULL,
  wash_type  TEXT NOT NULL,
  price      INTEGER NOT NULL,
  PRIMARY KEY (car_type, wash_type)
);

-- Monthly package price matrix: car_type × frequency × wash_type
CREATE TABLE IF NOT EXISTS monthly_pricing (
  car_type   TEXT    NOT NULL,
  frequency  INTEGER NOT NULL, -- 1, 2, or 4 washes/month
  wash_type  TEXT    NOT NULL,
  price      INTEGER NOT NULL,
  PRIMARY KEY (car_type, frequency, wash_type)
);

-- Add-on services (Interior Cleaning, Full Rubbing)
CREATE TABLE IF NOT EXISTS addon_services (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  base_price INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- Checkpoint templates (admin-editable, snapshotted onto each job)
CREATE TABLE IF NOT EXISTS checkpoint_templates (
  service_key TEXT PRIMARY KEY, -- top | normal | foam | interior | rubbing | pickup_drop
  steps       TEXT NOT NULL,    -- JSON array of step labels
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Monthly subscriptions (defined before jobs so the FK reference is valid)
CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  car_type     TEXT    NOT NULL,
  wash_type    TEXT    NOT NULL,
  frequency    INTEGER NOT NULL,
  plan_label   TEXT    NOT NULL,
  price        INTEGER NOT NULL,
  washes_total INTEGER NOT NULL,
  washes_used  INTEGER NOT NULL DEFAULT 0,
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    DEFAULT (datetime('now'))
);

-- Jobs (after subscriptions so the FK reference subscription_id is valid)
CREATE TABLE IF NOT EXISTS jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id       INTEGER NOT NULL REFERENCES vehicles(id),
  car_type         TEXT    NOT NULL,
  wash_type        TEXT    NOT NULL DEFAULT '',
  addons           TEXT    NOT NULL DEFAULT '[]',
  is_monthly       INTEGER NOT NULL DEFAULT 0,
  pickup_drop      INTEGER NOT NULL DEFAULT 0,
  pickup_address   TEXT    NOT NULL DEFAULT '',
  services_summary TEXT    NOT NULL DEFAULT '',
  price            INTEGER NOT NULL DEFAULT 0,
  amount_paid      INTEGER NOT NULL DEFAULT 0,
  payment_mode     TEXT    NOT NULL DEFAULT 'cash',
  assigned_worker  TEXT    NOT NULL DEFAULT '',
  notes            TEXT    NOT NULL DEFAULT '',
  subscription_id  INTEGER REFERENCES subscriptions(id),
  checkpoints      TEXT    NOT NULL DEFAULT '[]',
  status           TEXT    NOT NULL DEFAULT 'received',
  created_at       TEXT    DEFAULT (datetime('now')),
  started_at       TEXT,
  ready_at         TEXT,
  delivered_at     TEXT
);

-- Key/value settings
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
