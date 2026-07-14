-- Migration 007: Payment tracking on memberships
-- Run: wrangler d1 execute dhulaai-db --remote --file ./migrations/007_membership_payment.sql
--
-- New memberships start unpaid; admin marks them paid separately.
-- Existing rows are treated as paid so old plans don't show as dues.
ALTER TABLE subscriptions ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN paid_at TEXT;
UPDATE subscriptions SET is_paid = 1 WHERE is_paid = 0;
