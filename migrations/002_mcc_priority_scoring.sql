DELIMITER //

CREATE PROCEDURE add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

CALL add_column_if_missing('merchant_category_risk', 'risk_level', 'VARCHAR(20) DEFAULT ''LOW''');
CALL add_column_if_missing('merchant_category_risk', 'risk_points', 'INT NOT NULL DEFAULT 0');
CALL add_column_if_missing('merchant_category_risk', 'use_priority_multiplier', 'TINYINT(1) DEFAULT 1');
CALL add_column_if_missing('merchant_category_risk', 'priority_multiplier', 'DECIMAL(6,2) DEFAULT 3.00');
CALL add_column_if_missing('merchant_category_risk', 'expected_min_amount', 'DECIMAL(12,2) NULL');
CALL add_column_if_missing('merchant_category_risk', 'expected_max_amount', 'DECIMAL(12,2) NULL');
CALL add_column_if_missing('merchant_category_risk', 'expected_daily_count', 'INT NULL');
CALL add_column_if_missing('merchant_category_risk', 'expected_daily_value', 'DECIMAL(14,2) NULL');
CALL add_column_if_missing('merchant_category_risk', 'velocity_count', 'INT NULL');
CALL add_column_if_missing('merchant_category_risk', 'velocity_window_seconds', 'INT NULL');

CALL add_column_if_missing('transactions', 'base_rule_score', 'INT DEFAULT 0');
CALL add_column_if_missing('transactions', 'mcc_risk_points', 'INT DEFAULT 0');
CALL add_column_if_missing('transactions', 'raw_risk_score', 'INT DEFAULT 0');
CALL add_column_if_missing('transactions', 'displayed_risk_score', 'INT DEFAULT 0');
CALL add_column_if_missing('transactions', 'priority_multiplier', 'DECIMAL(6,2) DEFAULT 1.00');
CALL add_column_if_missing('transactions', 'priority_score', 'INT DEFAULT 0');

CALL add_column_if_missing('alerts', 'base_rule_score', 'INT DEFAULT 0');
CALL add_column_if_missing('alerts', 'mcc_risk_points', 'INT DEFAULT 0');
CALL add_column_if_missing('alerts', 'raw_risk_score', 'INT DEFAULT 0');
CALL add_column_if_missing('alerts', 'displayed_risk_score', 'INT DEFAULT 0');
CALL add_column_if_missing('alerts', 'priority_multiplier', 'DECIMAL(6,2) DEFAULT 1.00');
CALL add_column_if_missing('alerts', 'priority_score', 'INT DEFAULT 0');

DROP PROCEDURE add_column_if_missing;

UPDATE merchant_category_risk
SET risk_points = COALESCE(NULLIF(risk_points, 0), points, 0),
    risk_level = CASE
      WHEN UPPER(COALESCE(risk_level, '')) IN ('LOW', 'MEDIUM', 'ELEVATED', 'HIGH', 'VERY_HIGH') THEN UPPER(risk_level)
      WHEN COALESCE(points, 0) >= 20 THEN 'VERY_HIGH'
      WHEN COALESCE(points, 0) >= 15 THEN 'HIGH'
      WHEN COALESCE(points, 0) >= 5 THEN 'MEDIUM'
      ELSE 'LOW'
    END,
    priority_multiplier = COALESCE(priority_multiplier, 3.00),
    use_priority_multiplier = COALESCE(use_priority_multiplier, 1);

UPDATE merchant_category_risk
SET risk_points = 0, points = 0, risk_level = 'LOW'
WHERE mcc_code IN ('5411', '5812', '5814')
   OR LOWER(category_name) LIKE '%restaurant%'
   OR LOWER(category_name) LIKE '%food%';

UPDATE merchant_category_risk
SET expected_min_amount = COALESCE(expected_min_amount, 2),
    expected_max_amount = COALESCE(expected_max_amount, 250),
    expected_daily_count = COALESCE(expected_daily_count, 200),
    expected_daily_value = COALESCE(expected_daily_value, 25000),
    velocity_count = COALESCE(velocity_count, 8),
    velocity_window_seconds = COALESCE(velocity_window_seconds, 300)
WHERE risk_level = 'LOW';

UPDATE merchant_category_risk
SET expected_min_amount = COALESCE(expected_min_amount, 10),
    expected_max_amount = COALESCE(expected_max_amount, 10000),
    expected_daily_count = COALESCE(expected_daily_count, 60),
    expected_daily_value = COALESCE(expected_daily_value, 120000),
    velocity_count = COALESCE(velocity_count, 5),
    velocity_window_seconds = COALESCE(velocity_window_seconds, 300)
WHERE risk_level IN ('HIGH', 'VERY_HIGH');

UPDATE transactions
SET base_rule_score = COALESCE(NULLIF(base_rule_score, 0), risk_score, 0),
    raw_risk_score = COALESCE(NULLIF(raw_risk_score, 0), risk_score, 0),
    displayed_risk_score = COALESCE(NULLIF(displayed_risk_score, 0), risk_score, 0),
    priority_multiplier = COALESCE(priority_multiplier, 1.00),
    priority_score = COALESCE(NULLIF(priority_score, 0), risk_score, 0)
WHERE risk_score IS NOT NULL;

UPDATE alerts
SET base_rule_score = COALESCE(NULLIF(base_rule_score, 0), risk_score, 0),
    raw_risk_score = COALESCE(NULLIF(raw_risk_score, 0), risk_score, 0),
    displayed_risk_score = COALESCE(NULLIF(displayed_risk_score, 0), risk_score, 0),
    priority_multiplier = COALESCE(priority_multiplier, 1.00),
    priority_score = COALESCE(NULLIF(priority_score, 0), risk_score, 0)
WHERE risk_score IS NOT NULL;

UPDATE compliance_rules
SET rule_type = 'merchant_category_risk', updated_at = NOW()
WHERE rule_type = 'merchant_profile'
  AND NOT EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'merchant_category_risk') existing_rule);

UPDATE compliance_rules
SET rule_type = 'large_transaction', updated_at = NOW()
WHERE rule_type = 'amount_multiplier'
  AND NOT EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'large_transaction') existing_rule);

UPDATE compliance_rules
SET rule_type = 'transaction_velocity', updated_at = NOW()
WHERE rule_type = 'velocity'
  AND NOT EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'transaction_velocity') existing_rule);

UPDATE compliance_rules
SET rule_type = 'repeated_small_transactions', updated_at = NOW()
WHERE rule_type = 'velocity_small_amount'
  AND NOT EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'repeated_small_transactions') existing_rule);

UPDATE compliance_rules
SET rule_type = 'frequent_large_transactions', updated_at = NOW()
WHERE rule_type = 'large_amount_frequency'
  AND NOT EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'frequent_large_transactions') existing_rule);

UPDATE compliance_rules
SET rule_type = 'outside_operating_hours', updated_at = NOW()
WHERE rule_type = 'time'
  AND NOT EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'outside_operating_hours') existing_rule);

UPDATE compliance_rules
SET rule_type = 'duplicate_payment_identifier', updated_at = NOW()
WHERE rule_type = 'duplicate_transaction'
  AND NOT EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'duplicate_payment_identifier') existing_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'merchant_profile'
  AND EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'merchant_category_risk' AND is_active = 1) canonical_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'amount_multiplier'
  AND EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'large_transaction' AND is_active = 1) canonical_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'velocity'
  AND EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'transaction_velocity' AND is_active = 1) canonical_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'velocity_small_amount'
  AND EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'repeated_small_transactions' AND is_active = 1) canonical_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'large_amount_frequency'
  AND EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'frequent_large_transactions' AND is_active = 1) canonical_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'time'
  AND EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'outside_operating_hours' AND is_active = 1) canonical_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'duplicate_transaction'
  AND EXISTS (SELECT 1 FROM (SELECT rule_id FROM compliance_rules WHERE rule_type = 'duplicate_payment_identifier' AND is_active = 1) canonical_rule);

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type IN ('high_risk_jurisdiction', 'cancellation_velocity', 'customer_risk');
