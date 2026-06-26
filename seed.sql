-- Dhulaai Express — Seed Data
-- Run after schema.sql: wrangler d1 execute dhulaai-db --file ./seed.sql

-- ── One-time wash pricing matrix ─────────────────────────────────────────
INSERT OR IGNORE INTO wash_pricing (car_type, wash_type, price) VALUES
  ('Hatchback',   'top',    199),
  ('Hatchback',   'normal', 299),
  ('Hatchback',   'foam',   499),
  ('Sedan',       'top',    249),
  ('Sedan',       'normal', 349),
  ('Sedan',       'foam',   599),
  ('Compact SUV', 'top',    299),
  ('Compact SUV', 'normal', 399),
  ('Compact SUV', 'foam',   699),
  ('Mid SUV',     'top',    349),
  ('Mid SUV',     'normal', 499),
  ('Mid SUV',     'foam',   799),
  ('Large SUV',   'top',    399),
  ('Large SUV',   'normal', 599),
  ('Large SUV',   'foam',   899),
  ('Luxury Car',  'top',    499),
  ('Luxury Car',  'normal', 699),
  ('Luxury Car',  'foam',   1199);

-- ── Monthly package pricing matrix ───────────────────────────────────────
INSERT OR IGNORE INTO monthly_pricing (car_type, frequency, wash_type, price) VALUES
  ('Hatchback',   1, 'normal', 249),  ('Hatchback',   1, 'foam',   399),
  ('Hatchback',   2, 'normal', 449),  ('Hatchback',   2, 'foam',   749),
  ('Hatchback',   4, 'normal', 799),  ('Hatchback',   4, 'foam',   1299),
  ('Sedan',       1, 'normal', 299),  ('Sedan',       1, 'foam',   499),
  ('Sedan',       2, 'normal', 549),  ('Sedan',       2, 'foam',   949),
  ('Sedan',       4, 'normal', 999),  ('Sedan',       4, 'foam',   1699),
  ('Compact SUV', 1, 'normal', 349),  ('Compact SUV', 1, 'foam',   599),
  ('Compact SUV', 2, 'normal', 649),  ('Compact SUV', 2, 'foam',   1099),
  ('Compact SUV', 4, 'normal', 1199), ('Compact SUV', 4, 'foam',   1999),
  ('Mid SUV',     1, 'normal', 449),  ('Mid SUV',     1, 'foam',   749),
  ('Mid SUV',     2, 'normal', 799),  ('Mid SUV',     2, 'foam',   1349),
  ('Mid SUV',     4, 'normal', 1449), ('Mid SUV',     4, 'foam',   2499),
  ('Large SUV',   1, 'normal', 549),  ('Large SUV',   1, 'foam',   899),
  ('Large SUV',   2, 'normal', 999),  ('Large SUV',   2, 'foam',   1699),
  ('Large SUV',   4, 'normal', 1799), ('Large SUV',   4, 'foam',   2999),
  ('Luxury Car',  1, 'normal', 699),  ('Luxury Car',  1, 'foam',   1199),
  ('Luxury Car',  2, 'normal', 1249), ('Luxury Car',  2, 'foam',   2099),
  ('Luxury Car',  4, 'normal', 2299), ('Luxury Car',  4, 'foam',   3999);

-- ── Add-on services ───────────────────────────────────────────────────────
INSERT OR IGNORE INTO addon_services (id, name, base_price) VALUES
  (1, 'Interior Cleaning', 999),
  (2, 'Full Rubbing',      1499);

-- ── Checkpoint templates ──────────────────────────────────────────────────
INSERT OR IGNORE INTO checkpoint_templates (service_key, steps) VALUES
  ('top', '["Pre-rinse & dust removal","Exterior body wash","Wheels & tyres","Wipe & dry exterior","Exterior glass","Final inspection"]'),
  ('normal', '["Pre-rinse","Shampoo body wash","Wheels, tyres & arches","Glass (inside & out)","Microfiber dry","Tyre dressing","Final inspection"]'),
  ('foam', '["Pre-rinse / dust blow-off","Snow-foam application & dwell","Two-bucket hand wash","Wheels, tyres & arches deep clean","Rinse","Microfiber dry","Glass inside & out","Tyre dressing / shine","Dashboard quick wipe","Final inspection & handover"]'),
  ('interior', '["Remove mats & loose items","Vacuum seats, carpet & boot","Dashboard, console & vents","Door panels & handles","Seat cleaning (fabric/leather)","Interior glass","Mats wash & dry","Air freshener","Final inspection"]'),
  ('rubbing', '["Wash & decontaminate surface","Inspect paint & mask trims","Compounding / rubbing (scratch removal)","Polishing (gloss restore)","Wipe residue","Protective wax / sealant","Final gloss check & inspection"]'),
  ('pickup_drop', '["Pickup confirmed & car collected","Safe drop-back completed"]');

-- ── Default settings ──────────────────────────────────────────────────────
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('shop_phone',      '919149292076'),
  ('shop_name',       'Dhulaai Express'),
  ('tpl_received',    'Hi {name}! 🚗 We have received your {car} ({reg}) at Dhulaai Express. We will get started shortly. Thank you!'),
  ('tpl_inprogress',  'Hi {name}! Your {car} ({reg}) is now being washed at Dhulaai Express. We will notify you when it''s ready! ✨'),
  ('tpl_ready',       'Hi {name}! ✅ Your {car} ({reg}) is ready for pickup at Dhulaai Express. Amount: ₹{amount}. Thank you for choosing us!'),
  ('tpl_delivered',   'Hi {name}! 🎉 Your {car} ({reg}) has been delivered. Thank you for visiting Dhulaai Express, Dehradun. See you next time!');
