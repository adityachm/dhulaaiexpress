-- Migration 002: OTP verification table
CREATE TABLE IF NOT EXISTS otps (
  phone      TEXT    PRIMARY KEY,
  code       TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  verified   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    DEFAULT (datetime('now'))
);
