-- Migration 009: Shareable token for the member details form
-- Run: wrangler d1 execute dhulaai-db --remote --file ./migrations/009_info_token.sql
--
-- Generated when the admin requests details from a member; the tokenized
-- link lets the customer fill in only building/flat/parking themselves.
ALTER TABLE subscriptions ADD COLUMN info_token TEXT;
