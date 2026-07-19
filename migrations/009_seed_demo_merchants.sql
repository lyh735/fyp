-- Migration 009: sample/demo merchants for risk-rule testing.
-- These rows are prototype test data only, not production merchant records.
-- Safe behavior:
--   - Does not delete any data.
--   - Uses only MCC codes that already exist and are active in merchant_category_risk.
--   - Inserts/updates only merchant IDs prefixed with DEMO-.
--   - Leaves live database unchanged until this file is manually executed.

INSERT INTO merchants (
  merchant_id,
  merchant_name,
  business_category,
  mcc_code,
  merchant_average_amount,
  merchant_max_transaction_amount,
  operating_hours_start,
  operating_hours_end,
  risk_level,
  merchant_risk_score,
  country,
  has_physical_location,
  status,
  updated_at
)
SELECT
  demo.merchant_id,
  demo.merchant_name,
  demo.business_category,
  demo.mcc_code,
  demo.merchant_average_amount,
  demo.merchant_max_transaction_amount,
  demo.operating_hours_start,
  demo.operating_hours_end,
  demo.risk_level,
  demo.merchant_risk_score,
  'Singapore',
  demo.has_physical_location,
  'active',
  NOW()
FROM (
  -- 1. Low-risk F&B / restaurant. Has merchant max for amount-threshold testing.
  SELECT
    'DEMO-FNB-LOW-001' AS merchant_id,
    'Demo Orchard Family Restaurant' AS merchant_name,
    'Restaurants' AS business_category,
    '5812' AS mcc_code,
    45.00 AS merchant_average_amount,
    250.00 AS merchant_max_transaction_amount,
    '10:00:00' AS operating_hours_start,
    '22:00:00' AS operating_hours_end,
    'Low' AS risk_level,
    10 AS merchant_risk_score,
    1 AS has_physical_location

  UNION ALL

  -- 2. Low-risk retail. Useful for normal low-MCC retail tests.
  SELECT
    'DEMO-RETAIL-LOW-001',
    'Demo Campus Bookstore',
    'Retail / bookstores',
    '5942',
    25.00,
    300.00,
    '09:00:00',
    '20:00:00',
    'Low',
    10,
    1

  UNION ALL

  -- 3. Medium-risk merchant. No merchant max so amount checks fall back to MCC expected_max_amount.
  SELECT
    'DEMO-ELECTRONICS-MED-001',
    'Demo TechHub Electronics',
    'Electronics',
    '5732',
    400.00,
    NULL,
    '10:00:00',
    '21:30:00',
    'Medium',
    30,
    1

  UNION ALL

  -- 4. High-risk MCC merchant. Useful for MCC points and priority multiplier tests.
  SELECT
    'DEMO-MONEY-HIGH-001',
    'Demo QuickRemit Money Transfer',
    'Money transfer / remittance',
    '4829',
    1000.00,
    10000.00,
    '09:00:00',
    '20:00:00',
    'High',
    60,
    1

  UNION ALL

  -- 5. Very-high-risk MCC merchant, configured as online/no physical location.
  SELECT
    'DEMO-BETTING-VERYHIGH-001',
    'Demo Lucky Bet Online',
    'Gambling / betting',
    '7995',
    200.00,
    5000.00,
    '00:00:00',
    '00:00:00',
    'High',
    75,
    0

  UNION ALL

  -- 6. Low-risk grocery with merchant-specific max amount for merchant threshold precedence.
  SELECT
    'DEMO-GROCERY-MAX-001',
    'Demo Daily Fresh Grocery',
    'Grocery stores',
    '5411',
    25.00,
    120.00,
    '08:00:00',
    '22:00:00',
    'Low',
    10,
    1

  UNION ALL

  -- 7. Low-risk fast food without merchant max to test MCC expected_max_amount fallback.
  SELECT
    'DEMO-FASTFOOD-MCCFALLBACK-001',
    'Demo Campus Fast Food',
    'Fast food',
    '5814',
    12.00,
    NULL,
    '07:00:00',
    '23:00:00',
    'Low',
    10,
    1

  UNION ALL

  -- 8. Medium-risk F&B with clear operating hours for outside-operating-hours tests.
  SELECT
    'DEMO-BAR-HOURS-001',
    'Demo Riverside Bar',
    'Bars / food and beverage',
    '5813',
    60.00,
    500.00,
    '17:00:00',
    '23:30:00',
    'Medium',
    35,
    1
) AS demo
WHERE EXISTS (
  SELECT 1
  FROM merchant_category_risk mcr
  WHERE mcr.mcc_code = demo.mcc_code
    AND mcr.is_active = 1
)
ON DUPLICATE KEY UPDATE
  merchant_name = VALUES(merchant_name),
  business_category = VALUES(business_category),
  mcc_code = VALUES(mcc_code),
  merchant_average_amount = VALUES(merchant_average_amount),
  merchant_max_transaction_amount = VALUES(merchant_max_transaction_amount),
  operating_hours_start = VALUES(operating_hours_start),
  operating_hours_end = VALUES(operating_hours_end),
  risk_level = VALUES(risk_level),
  merchant_risk_score = VALUES(merchant_risk_score),
  country = VALUES(country),
  has_physical_location = VALUES(has_physical_location),
  status = VALUES(status),
  updated_at = NOW();

-- Verification query after applying:
-- SELECT
--   m.merchant_id,
--   m.merchant_name,
--   m.business_category,
--   m.mcc_code,
--   m.merchant_average_amount,
--   m.merchant_max_transaction_amount,
--   m.operating_hours_start,
--   m.operating_hours_end,
--   m.country,
--   m.status,
--   mcr.category_name,
--   mcr.risk_level AS mcc_risk_level,
--   mcr.risk_points AS mcc_risk_points,
--   mcr.expected_max_amount
-- FROM merchants m
-- LEFT JOIN merchant_category_risk mcr
--   ON mcr.is_active = 1
--  AND mcr.mcc_code = m.mcc_code
-- WHERE m.merchant_id LIKE 'DEMO-%'
-- ORDER BY m.merchant_id;
