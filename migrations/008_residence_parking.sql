-- Migration 008: Residence (Windlass building + flat) and parking details
-- Run: wrangler d1 execute dhulaai-db --remote --file ./migrations/008_residence_parking.sql
--
-- Building/flat live on the customer (their residence); the parking spot
-- lives on the vehicle (that's where the car is found for daily care).
ALTER TABLE customers ADD COLUMN building_name TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN flat_number   TEXT NOT NULL DEFAULT '';
ALTER TABLE vehicles  ADD COLUMN parking_number TEXT NOT NULL DEFAULT '';
