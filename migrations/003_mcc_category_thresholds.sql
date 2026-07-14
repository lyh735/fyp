-- Prototype MCC/category threshold defaults for transaction monitoring.
-- These values are FYP prototype assumptions, not official regulatory thresholds.
-- This migration preserves existing rows and unrelated columns. It updates active
-- merchant_category_risk rows by risk_id/MCC/category keyword only.

DROP PROCEDURE IF EXISTS add_mcc_threshold_column_if_missing;

DELIMITER //
CREATE PROCEDURE add_mcc_threshold_column_if_missing(
  IN table_name VARCHAR(64),
  IN column_name VARCHAR(64),
  IN column_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name
      AND COLUMN_NAME = column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE ', table_name, ' ADD COLUMN ', column_name, ' ', column_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'risk_level', 'VARCHAR(20) DEFAULT ''LOW''');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'risk_points', 'INT NOT NULL DEFAULT 0');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'use_priority_multiplier', 'TINYINT(1) DEFAULT 1');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'priority_multiplier', 'DECIMAL(6,2) DEFAULT 3.00');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'expected_min_amount', 'DECIMAL(12,2) NULL');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'expected_max_amount', 'DECIMAL(12,2) NULL');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'expected_daily_count', 'INT NULL');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'expected_daily_value', 'DECIMAL(14,2) NULL');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'velocity_count', 'INT NULL');
CALL add_mcc_threshold_column_if_missing('merchant_category_risk', 'velocity_window_seconds', 'INT NULL');

UPDATE merchant_category_risk
SET risk_level = 'HIGH', risk_points = 15, points = 15,
    expected_min_amount = 20, expected_max_amount = 2500,
    expected_daily_count = 20, expected_daily_value = 30000,
    velocity_count = 4, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (1, 2, 34) OR mcc_code IN ('4511', '4722') OR category_keyword = 'travel');

UPDATE merchant_category_risk
SET risk_level = 'HIGH', risk_points = 15, points = 15,
    expected_min_amount = 10, expected_max_amount = 1000,
    expected_daily_count = 40, expected_daily_value = 20000,
    velocity_count = 6, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (3, 27) OR mcc_code IN ('4789', '7512'));

UPDATE merchant_category_risk
SET risk_level = 'HIGH', risk_points = 15, points = 15,
    expected_min_amount = 10, expected_max_amount = 10000,
    expected_daily_count = 50, expected_daily_value = 100000,
    velocity_count = 5, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (4, 24, 37) OR mcc_code IN ('4812', '6012') OR category_keyword = 'financial');

UPDATE merchant_category_risk
SET risk_level = 'HIGH', risk_points = 15, points = 15,
    expected_min_amount = 10, expected_max_amount = 10000,
    expected_daily_count = 60, expected_daily_value = 120000,
    velocity_count = 5, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (5, 25, 36) OR mcc_code IN ('4829', '6051') OR category_keyword = 'remittance');

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 5, expected_max_amount = 1500,
    expected_daily_count = 80, expected_daily_value = 50000,
    velocity_count = 6, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (6, 32) OR mcc_code = '5311' OR category_keyword = 'retail');

UPDATE merchant_category_risk
SET risk_level = 'LOW', risk_points = 0, points = 0,
    expected_min_amount = 2, expected_max_amount = 300,
    expected_daily_count = 150, expected_daily_value = 25000,
    velocity_count = 8, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 7 OR mcc_code = '5411');

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 5, expected_max_amount = 500,
    expected_daily_count = 100, expected_daily_value = 30000,
    velocity_count = 7, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 8 OR mcc_code = '5541');

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 10, expected_max_amount = 1000,
    expected_daily_count = 60, expected_daily_value = 30000,
    velocity_count = 6, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (9, 10, 11, 12, 13, 14, 15) OR mcc_code IN ('5611', '5621', '5631', '5641', '5651', '5661', '5691'));

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 20, expected_max_amount = 3000,
    expected_daily_count = 30, expected_daily_value = 60000,
    velocity_count = 5, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 16 OR mcc_code = '5712');

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 20, expected_max_amount = 3000,
    expected_daily_count = 40, expected_daily_value = 50000,
    velocity_count = 5, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (17, 33) OR mcc_code = '5732' OR category_keyword = 'electronic');

UPDATE merchant_category_risk
SET risk_level = 'LOW', risk_points = 0, points = 0,
    expected_min_amount = 2, expected_max_amount = 250,
    expected_daily_count = 200, expected_daily_value = 25000,
    velocity_count = 8, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (18, 29, 30, 31) OR mcc_code = '5812' OR category_keyword IN ('food', 'restaurant', 'dining'));

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 5, expected_max_amount = 500,
    expected_daily_count = 120, expected_daily_value = 30000,
    velocity_count = 7, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 19 OR mcc_code = '5813');

UPDATE merchant_category_risk
SET risk_level = 'LOW', risk_points = 0, points = 0,
    expected_min_amount = 2, expected_max_amount = 150,
    expected_daily_count = 250, expected_daily_value = 20000,
    velocity_count = 10, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 20 OR mcc_code = '5814');

UPDATE merchant_category_risk
SET risk_level = 'LOW', risk_points = 0, points = 0,
    expected_min_amount = 5, expected_max_amount = 300,
    expected_daily_count = 80, expected_daily_value = 15000,
    velocity_count = 8, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 21 OR mcc_code = '5942');

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 5, expected_max_amount = 1000,
    expected_daily_count = 80, expected_daily_value = 40000,
    velocity_count = 6, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 22 OR mcc_code = '5964');

UPDATE merchant_category_risk
SET risk_level = 'MEDIUM', risk_points = 5, points = 5,
    expected_min_amount = 5, expected_max_amount = 1000,
    expected_daily_count = 80, expected_daily_value = 40000,
    velocity_count = 6, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id = 23 OR mcc_code = '5999');

UPDATE merchant_category_risk
SET risk_level = 'HIGH', risk_points = 15, points = 15,
    expected_min_amount = 20, expected_max_amount = 3000,
    expected_daily_count = 30, expected_daily_value = 50000,
    velocity_count = 5, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (26, 35) OR mcc_code = '7011' OR category_keyword = 'hotel');

UPDATE merchant_category_risk
SET risk_level = 'VERY_HIGH', risk_points = 20, points = 20,
    expected_min_amount = 5, expected_max_amount = 5000,
    expected_daily_count = 100, expected_daily_value = 150000,
    velocity_count = 5, velocity_window_seconds = 300,
    use_priority_multiplier = 1, priority_multiplier = 3.00,
    updated_at = NOW()
WHERE is_active = 1
  AND (risk_id IN (28, 38) OR mcc_code = '7995' OR category_keyword = 'gambling');

DROP PROCEDURE IF EXISTS add_mcc_threshold_column_if_missing;
