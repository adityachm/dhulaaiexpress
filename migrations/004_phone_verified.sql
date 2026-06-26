-- Migration 003: Track verified phone numbers on customer record
ALTER TABLE customers ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0;
