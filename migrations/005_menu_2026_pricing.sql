-- Migration 005: New rates from the July 2026 Wash Menu
-- Run: wrangler d1 execute dhulaai-db --remote --file ./migrations/005_menu_2026_pricing.sql
--
-- Notes:
--  * The menu lists "Sedan / Compact SUV" as one category — both car types
--    share the same prices.
--  * Monthly packages have a single price per car type & frequency (includes
--    6 days of waterless cleaning), so 'normal' and 'foam' share the price.

-- ── One-time wash pricing ─────────────────────────────────────────────────
INSERT OR REPLACE INTO wash_pricing (car_type, wash_type, price) VALUES
  ('Hatchback',   'top',    200),
  ('Hatchback',   'normal', 300),
  ('Hatchback',   'foam',   350),
  ('Sedan',       'top',    250),
  ('Sedan',       'normal', 350),
  ('Sedan',       'foam',   400),
  ('Compact SUV', 'top',    250),
  ('Compact SUV', 'normal', 350),
  ('Compact SUV', 'foam',   400),
  ('Mid SUV',     'top',    300),
  ('Mid SUV',     'normal', 400),
  ('Mid SUV',     'foam',   600),
  ('Large SUV',   'top',    350),
  ('Large SUV',   'normal', 500),
  ('Large SUV',   'foam',   700),
  ('Luxury Car',  'top',    500),
  ('Luxury Car',  'normal', 700),
  ('Luxury Car',  'foam',   900);

-- ── Monthly package pricing ───────────────────────────────────────────────
INSERT OR REPLACE INTO monthly_pricing (car_type, frequency, wash_type, price) VALUES
  ('Hatchback',   1, 'normal', 849),  ('Hatchback',   1, 'foam',   849),
  ('Hatchback',   2, 'normal', 1249), ('Hatchback',   2, 'foam',   1249),
  ('Hatchback',   4, 'normal', 1949), ('Hatchback',   4, 'foam',   1949),
  ('Sedan',       1, 'normal', 949),  ('Sedan',       1, 'foam',   949),
  ('Sedan',       2, 'normal', 1449), ('Sedan',       2, 'foam',   1449),
  ('Sedan',       4, 'normal', 2149), ('Sedan',       4, 'foam',   2149),
  ('Compact SUV', 1, 'normal', 949),  ('Compact SUV', 1, 'foam',   949),
  ('Compact SUV', 2, 'normal', 1449), ('Compact SUV', 2, 'foam',   1449),
  ('Compact SUV', 4, 'normal', 2149), ('Compact SUV', 4, 'foam',   2149),
  ('Mid SUV',     1, 'normal', 1049), ('Mid SUV',     1, 'foam',   1049),
  ('Mid SUV',     2, 'normal', 1549), ('Mid SUV',     2, 'foam',   1549),
  ('Mid SUV',     4, 'normal', 2349), ('Mid SUV',     4, 'foam',   2349),
  ('Large SUV',   1, 'normal', 1249), ('Large SUV',   1, 'foam',   1249),
  ('Large SUV',   2, 'normal', 1749), ('Large SUV',   2, 'foam',   1749),
  ('Large SUV',   4, 'normal', 2449), ('Large SUV',   4, 'foam',   2449),
  ('Luxury Car',  1, 'normal', 1449), ('Luxury Car',  1, 'foam',   1449),
  ('Luxury Car',  2, 'normal', 1949), ('Luxury Car',  2, 'foam',   1949),
  ('Luxury Car',  4, 'normal', 2949), ('Luxury Car',  4, 'foam',   2949);

-- ── Add-ons: new rates (internal name stays 'Dry Cleaning';
--    the public menu/site shows it as 'Interior Cleaning') ─────────────────
UPDATE addon_services SET base_price = 1249 WHERE id = 1;
UPDATE addon_services SET base_price = 1499 WHERE id = 2;

INSERT OR REPLACE INTO addon_pricing (addon_id, car_type, price) VALUES
  (1, 'Hatchback',    1249),
  (1, 'Sedan',        1549),
  (1, 'Compact SUV',  1549),
  (1, 'Mid SUV',      1849),
  (1, 'Large SUV',    2049),
  (1, 'Luxury Car',   2549),
  (2, 'Hatchback',    1499),
  (2, 'Sedan',        1799),
  (2, 'Compact SUV',  1799),
  (2, 'Mid SUV',      1999),
  (2, 'Large SUV',    2399),
  (2, 'Luxury Car',   2999);
