-- Inserts missing MCC-specific category profile rows for the FYP prototype.
-- These values are prototype assumptions, not official regulatory thresholds.
-- Safe to run after 003_mcc_category_thresholds.sql.
-- This migration does not delete rows or recreate the table.
-- If an MCC row already exists, only the MCC profile/default threshold fields are updated.

INSERT INTO merchant_category_risk
  (
    mcc_code, category_name, category_keyword, risk_level, risk_points,
    points, expected_min_amount, expected_max_amount, expected_daily_count,
    expected_daily_value, velocity_count, velocity_window_seconds,
    use_priority_multiplier, priority_multiplier, is_active
  )
VALUES
  ('4511', 'Airlines / travel', NULL, 'HIGH', 15, 15, 20, 2500, 20, 30000, 4, 300, 1, 3.00, 1),
  ('4722', 'Travel agencies / tourism', NULL, 'HIGH', 15, 15, 20, 2500, 20, 30000, 4, 300, 1, 3.00, 1),
  ('4789', 'Transportation / travel services', NULL, 'HIGH', 15, 15, 10, 1000, 40, 20000, 6, 300, 1, 3.00, 1),
  ('4812', 'Financial / telecom payment services', NULL, 'HIGH', 15, 15, 10, 10000, 50, 100000, 5, 300, 1, 3.00, 1),
  ('4829', 'Money transfer / remittance', NULL, 'HIGH', 15, 15, 10, 10000, 60, 120000, 5, 300, 1, 3.00, 1),
  ('5311', 'Retail / department stores', NULL, 'MEDIUM', 5, 5, 5, 1500, 80, 50000, 6, 300, 1, 3.00, 1),
  ('5411', 'Grocery stores', NULL, 'LOW', 0, 0, 2, 300, 150, 25000, 8, 300, 1, 3.00, 1),
  ('5541', 'Retail / service stations', NULL, 'MEDIUM', 5, 5, 5, 500, 100, 30000, 7, 300, 1, 3.00, 1),
  ('5611', 'Retail / apparel', NULL, 'MEDIUM', 5, 5, 10, 1000, 60, 30000, 6, 300, 1, 3.00, 1),
  ('5621', 'Retail / apparel', NULL, 'MEDIUM', 5, 5, 10, 1000, 60, 30000, 6, 300, 1, 3.00, 1),
  ('5631', 'Retail / accessories', NULL, 'MEDIUM', 5, 5, 10, 1000, 60, 30000, 6, 300, 1, 3.00, 1),
  ('5641', 'Retail / children clothing', NULL, 'MEDIUM', 5, 5, 10, 1000, 60, 30000, 6, 300, 1, 3.00, 1),
  ('5651', 'Retail / clothing', NULL, 'MEDIUM', 5, 5, 10, 1000, 60, 30000, 6, 300, 1, 3.00, 1),
  ('5661', 'Retail / shoes', NULL, 'MEDIUM', 5, 5, 10, 1000, 60, 30000, 6, 300, 1, 3.00, 1),
  ('5691', 'Retail / clothing', NULL, 'MEDIUM', 5, 5, 10, 1000, 60, 30000, 6, 300, 1, 3.00, 1),
  ('5712', 'Retail / furniture', NULL, 'MEDIUM', 5, 5, 20, 3000, 30, 60000, 5, 300, 1, 3.00, 1),
  ('5732', 'Electronics', NULL, 'MEDIUM', 5, 5, 20, 3000, 40, 50000, 5, 300, 1, 3.00, 1),
  ('5812', 'Restaurants', NULL, 'LOW', 0, 0, 2, 250, 200, 25000, 8, 300, 1, 3.00, 1),
  ('5813', 'Bars / food and beverage', NULL, 'MEDIUM', 5, 5, 5, 500, 120, 30000, 7, 300, 1, 3.00, 1),
  ('5814', 'Fast food', NULL, 'LOW', 0, 0, 2, 150, 250, 20000, 10, 300, 1, 3.00, 1),
  ('5942', 'Retail / bookstores', NULL, 'LOW', 0, 0, 5, 300, 80, 15000, 8, 300, 1, 3.00, 1),
  ('5964', 'Retail / direct marketing', NULL, 'MEDIUM', 5, 5, 5, 1000, 80, 40000, 6, 300, 1, 3.00, 1),
  ('5999', 'Miscellaneous retail', NULL, 'MEDIUM', 5, 5, 5, 1000, 80, 40000, 6, 300, 1, 3.00, 1),
  ('6012', 'Financial institutions', NULL, 'HIGH', 15, 15, 10, 10000, 50, 100000, 5, 300, 1, 3.00, 1),
  ('6051', 'Money services / money orders', NULL, 'HIGH', 15, 15, 10, 10000, 60, 120000, 5, 300, 1, 3.00, 1),
  ('7011', 'Hotel / lodging', NULL, 'HIGH', 15, 15, 20, 3000, 30, 50000, 5, 300, 1, 3.00, 1),
  ('7512', 'Vehicle rental / travel', NULL, 'HIGH', 15, 15, 10, 1000, 40, 20000, 6, 300, 1, 3.00, 1),
  ('7995', 'Gambling / betting', NULL, 'VERY_HIGH', 20, 20, 5, 5000, 100, 150000, 5, 300, 1, 3.00, 1)
ON DUPLICATE KEY UPDATE
  category_name = VALUES(category_name),
  risk_level = VALUES(risk_level),
  risk_points = VALUES(risk_points),
  points = VALUES(points),
  expected_min_amount = VALUES(expected_min_amount),
  expected_max_amount = VALUES(expected_max_amount),
  expected_daily_count = VALUES(expected_daily_count),
  expected_daily_value = VALUES(expected_daily_value),
  velocity_count = VALUES(velocity_count),
  velocity_window_seconds = VALUES(velocity_window_seconds),
  use_priority_multiplier = VALUES(use_priority_multiplier),
  priority_multiplier = VALUES(priority_multiplier),
  is_active = VALUES(is_active),
  updated_at = NOW();
