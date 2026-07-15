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

CALL add_column_if_missing('compliance_rules', 'time_window_seconds', 'INT NULL');
CALL add_column_if_missing('transactions', 'ip_country', 'VARCHAR(50) NULL');
CALL add_column_if_missing('transactions', 'customer_risk_profile', 'VARCHAR(20) NULL');

DROP PROCEDURE add_column_if_missing;

CREATE TABLE IF NOT EXISTS merchant_category_risk (
  risk_id INT AUTO_INCREMENT PRIMARY KEY,
  mcc_code VARCHAR(20) NULL,
  category_name VARCHAR(100) NOT NULL,
  category_keyword VARCHAR(100) NULL,
  points INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_merchant_category_mcc (mcc_code),
  UNIQUE KEY uq_merchant_category_keyword (category_keyword)
);

INSERT INTO merchant_category_risk (mcc_code, category_name, category_keyword, points, is_active)
VALUES
  ('5812', 'Restaurants', NULL, 5, 1),
  ('5814', 'Fast food', NULL, 5, 1),
  ('5732', 'Electronics', NULL, 10, 1),
  ('4829', 'Money transfer / remittance', NULL, 15, 1),
  ('6012', 'Financial institutions', NULL, 15, 1),
  ('6051', 'Money services / money orders', NULL, 15, 1),
  ('7011', 'Hotel / lodging', NULL, 15, 1),
  ('7995', 'Gambling / betting', NULL, 15, 1),
  (NULL, 'Food and beverage', 'food', 5, 1),
  (NULL, 'Retail', 'retail', 5, 1),
  (NULL, 'Electronics', 'electronic', 10, 1),
  (NULL, 'Travel / tourism', 'travel', 15, 1),
  (NULL, 'Financial services', 'financial', 15, 1)
ON DUPLICATE KEY UPDATE
  category_name = VALUES(category_name),
  points = VALUES(points),
  updated_at = NOW();

UPDATE compliance_rules
SET rule_type = 'failed_attempt_velocity',
    rule_name = 'Repeated failed or declined payment attempts',
    description = 'Flags repeated failed or declined payment attempts using the same payment identifier.',
    time_window_seconds = COALESCE(time_window_seconds, time_window_minutes * 60, 600),
    updated_at = NOW()
WHERE rule_type = 'cancellation_velocity'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'failed_attempt_velocity'
    ) AS existing_failed_rule
  );

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'cancellation_velocity';

UPDATE compliance_rules
SET is_active = 0, updated_at = NOW()
WHERE rule_type = 'high_risk_jurisdiction'
   OR rule_type IN ('country', 'country_risk', 'jurisdiction', 'cross_border')
   OR LOWER(COALESCE(rule_name, '')) LIKE '%high-risk jurisdiction%'
   OR LOWER(COALESCE(rule_name, '')) LIKE '%high risk jurisdiction%'
   OR LOWER(COALESCE(rule_name, '')) LIKE '%high-risk country%'
   OR LOWER(COALESCE(rule_name, '')) LIKE '%cross-border%'
   OR LOWER(COALESCE(rule_name, '')) LIKE '%cross border%'
   OR LOWER(COALESCE(rule_name, '')) LIKE '%jurisdiction%';

UPDATE compliance_rules
SET time_window_seconds = CASE
  WHEN time_window_seconds IS NOT NULL THEN time_window_seconds
  WHEN time_window_minutes IS NOT NULL THEN time_window_minutes * 60
  WHEN rule_type = 'velocity' THEN 60
  WHEN rule_type = 'velocity_small_amount' THEN 300
  WHEN rule_type = 'large_amount_frequency' THEN 1800
  WHEN rule_type = 'failed_attempt_velocity' THEN 600
  WHEN rule_type = 'failure_then_success' THEN 600
  WHEN rule_type = 'duplicate_transaction' THEN 60
  ELSE NULL
END;

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Merchant MCC or industry risk', 'merchant_profile', 'Adds configured merchant profile risk points from merchant_category_risk.', NULL, NULL, NULL, NULL, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'merchant_profile');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Significant amount compared to merchant average', 'amount_multiplier', 'Flags transactions above a configurable multiple of trusted merchant average amount.', 3, NULL, NULL, NULL, 25, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'amount_multiplier');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'High transaction velocity', 'velocity', 'Flags repeated transactions using the same payment identifier.', NULL, 6, 1, 60, 25, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'velocity');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Repeated small transactions', 'velocity_small_amount', 'Flags repeated small-value transactions using the same payment identifier.', 10, 5, 5, 300, 20, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'velocity_small_amount');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Frequent unusually large transactions', 'large_amount_frequency', 'Flags repeated transactions above a configurable multiple of merchant average.', 3, 3, 30, 1800, 30, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'large_amount_frequency');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Repeated failed or declined payment attempts', 'failed_attempt_velocity', 'Flags repeated failed or declined payment attempts.', NULL, 3, 10, 600, 15, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'failed_attempt_velocity');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Failed attempts followed by success', 'failure_then_success', 'Flags a successful transaction after repeated failed or declined attempts.', NULL, 3, 10, 600, 30, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'failure_then_success');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Possible duplicate successful transaction', 'duplicate_transaction', 'Flags repeated successful transaction details within a short window.', NULL, 1, 1, 60, 25, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'duplicate_transaction');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Transaction outside merchant operating hours', 'time', 'Applies only to face-to-face transactions with stored operating hours.', NULL, NULL, NULL, NULL, 10, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'time');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'High-risk customer profile', 'customer_risk', 'Adds points when independent customer profile is high risk.', NULL, NULL, NULL, NULL, 15, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'customer_risk');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Missing useful identifying information', 'data_quality', 'Flags missing monitoring references.', NULL, NULL, NULL, NULL, 10, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'data_quality');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'Online transaction with missing/invalid IP', 'ip_validation', 'Flags online transactions with missing or invalid IP.', NULL, NULL, NULL, NULL, 10, 1
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'ip_validation');

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT 'IP country mismatch', 'ip_country_mismatch', 'Flags verified IP-country mismatch; inactive by default.', NULL, NULL, NULL, NULL, 20, 0
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules WHERE rule_type = 'ip_country_mismatch');
