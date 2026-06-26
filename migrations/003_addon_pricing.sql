-- Migration 003: Per-car-type pricing for add-on services
CREATE TABLE IF NOT EXISTS addon_pricing (
  addon_id  INTEGER NOT NULL REFERENCES addon_services(id),
  car_type  TEXT    NOT NULL,
  price     INTEGER NOT NULL,
  PRIMARY KEY (addon_id, car_type)
);

-- Rename Interior Cleaning → Dry Cleaning
UPDATE addon_services SET name = 'Dry Cleaning' WHERE id = 1;

-- Seed Dry Cleaning prices by car type
INSERT OR IGNORE INTO addon_pricing (addon_id, car_type, price) VALUES
  (1, 'Hatchback',    999),
  (1, 'Sedan',        1299),
  (1, 'Compact SUV',  1499),
  (1, 'Mid SUV',      1799),
  (1, 'Large SUV',    1999),
  (1, 'Luxury Car',   2499);

-- Seed Full Rubbing prices by car type
INSERT OR IGNORE INTO addon_pricing (addon_id, car_type, price) VALUES
  (2, 'Hatchback',    1499),
  (2, 'Sedan',        1999),
  (2, 'Compact SUV',  2499),
  (2, 'Mid SUV',      2999),
  (2, 'Large SUV',    3499),
  (2, 'Luxury Car',   4999);
