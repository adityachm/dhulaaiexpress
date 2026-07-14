-- Dhulaai Express — Seed Data
-- Run after schema.sql: wrangler d1 execute dhulaai-db --file ./seed.sql

-- ── One-time wash pricing matrix (Wash Menu, July 2026) ──────────────────
-- Menu lists "Sedan / Compact SUV" as one category — both rows share prices.
INSERT OR IGNORE INTO wash_pricing (car_type, wash_type, price) VALUES
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

-- ── Monthly package pricing matrix (Wash Menu, July 2026) ────────────────
-- The menu has a single package price per car type & frequency (includes
-- 6 days of waterless cleaning), so 'normal' and 'foam' share the price.
INSERT OR IGNORE INTO monthly_pricing (car_type, frequency, wash_type, price) VALUES
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

-- ── Add-on services (Wash Menu, July 2026) ────────────────────────────────
INSERT OR IGNORE INTO addon_services (id, name, base_price) VALUES
  (1, 'Dry Cleaning', 1249),
  (2, 'Full Rubbing', 1499);

INSERT OR IGNORE INTO addon_pricing (addon_id, car_type, price) VALUES
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
  ('tpl_received',    'Hi {name}! 🚗 Your {car} ({reg}) has been received at Dhulaai Express. Track your wash status live here: {status_url} — Thank you!'),
  ('tpl_inprogress',  'Hi {name}! Your {car} ({reg}) is now being washed at Dhulaai Express. We will notify you when it''s ready! ✨'),
  ('tpl_ready',       'Hi {name}! ✅ Your {car} ({reg}) is ready for pickup at Dhulaai Express. Amount: ₹{amount}. Thank you for choosing us!'),
  ('tpl_delivered',   'Hi {name}! 🎉 Your {car} ({reg}) has been delivered. Thank you for visiting Dhulaai Express, Dehradun. See you next time!'),
  ('tpl_expiring',    'Hi {name}! ⏳ Your Dhulaai Express membership ({plan}) for {reg} expires on {expiry}. Renew today at {price}/month to keep enjoying 6-day waterless care & member washes! 🚗✨'),
  ('tpl_payment',     'Hi {name}! 💳 Friendly reminder from Dhulaai Express: payment of {price} for your {plan} membership ({reg}) is pending. UPI or cash both work — thank you! 🙏'),
  ('tpl_info',        'Hi {name}! 🚗 To care for your car ({reg}) every day, we need your parking & address details. Please fill this quick form: {info_url} — Dhulaai Express');
