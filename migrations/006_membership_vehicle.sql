-- Migration 006: Tie memberships (subscriptions) to a specific vehicle
-- Run: wrangler d1 execute dhulaai-db --remote --file ./migrations/006_membership_vehicle.sql
--
-- Legacy rows keep vehicle_id NULL and continue to work for any of the
-- customer's vehicles; new memberships always carry a vehicle_id.
ALTER TABLE subscriptions ADD COLUMN vehicle_id INTEGER REFERENCES vehicles(id);
