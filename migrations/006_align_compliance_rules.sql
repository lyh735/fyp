-- Align compliance rule metadata with the merchant-focused prototype scoring model.
-- These are prototype scoring weights and descriptions, not regulatory values.
-- This migration preserves rule IDs where possible, inserts missing supported rules,
-- deactivates out-of-scope historical rules, and avoids duplicate active rule_type rows.

UPDATE compliance_rules
SET rule_type = 'merchant_category_risk', updated_at = NOW()
WHERE rule_type = 'merchant_profile'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'merchant_category_risk'
    ) AS existing_rule
  );

UPDATE compliance_rules
SET rule_type = 'large_transaction', updated_at = NOW()
WHERE rule_type = 'amount_multiplier'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'large_transaction'
    ) AS existing_rule
  );

UPDATE compliance_rules
SET rule_type = 'transaction_velocity', updated_at = NOW()
WHERE rule_type = 'velocity'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'transaction_velocity'
    ) AS existing_rule
  );

UPDATE compliance_rules
SET rule_type = 'repeated_small_transactions', updated_at = NOW()
WHERE rule_type = 'velocity_small_amount'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'repeated_small_transactions'
    ) AS existing_rule
  );

UPDATE compliance_rules
SET rule_type = 'frequent_large_transactions', updated_at = NOW()
WHERE rule_type = 'large_amount_frequency'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'frequent_large_transactions'
    ) AS existing_rule
  );

UPDATE compliance_rules
SET rule_type = 'outside_operating_hours', updated_at = NOW()
WHERE rule_type = 'time'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'outside_operating_hours'
    ) AS existing_rule
  );

UPDATE compliance_rules
SET rule_type = 'duplicate_payment_identifier', updated_at = NOW()
WHERE rule_type = 'duplicate_transaction'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT rule_id FROM compliance_rules WHERE rule_type = 'duplicate_payment_identifier'
    ) AS existing_rule
  );

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count, time_window_minutes, time_window_seconds, points, is_active)
SELECT
  'Merchant average deviation',
  'merchant_average_deviation',
  'Compares the transaction amount with merchant_average_amount using the configured multiplier; shares the amount_anomaly scoring group.',
  5.00,
  NULL,
  NULL,
  NULL,
  25,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM compliance_rules WHERE rule_type = 'merchant_average_deviation'
);

UPDATE compliance_rules
SET rule_name = 'Merchant MCC category risk',
    description = 'MCC/category risk has 0 fixed rule points. Actual category points come from merchant_category_risk.risk_points and are added once only after a non-MCC suspicious rule triggers.',
    threshold_value = NULL,
    threshold_count = NULL,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 0,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'merchant_category_risk';

UPDATE compliance_rules
SET rule_name = 'Large transaction',
    description = 'Flags a transaction above one absolute threshold resolved as merchant_max_transaction_amount, then MCC expected_max_amount, then this rule threshold_value.',
    threshold_count = NULL,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 25,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'large_transaction';

UPDATE compliance_rules
SET rule_name = 'Merchant average deviation',
    description = 'Compares the transaction amount with merchant_average_amount using the configured multiplier; shares the amount_anomaly scoring group.',
    threshold_value = COALESCE(threshold_value, 5.00),
    threshold_count = NULL,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 25,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'merchant_average_deviation';

UPDATE compliance_rules
SET rule_name = 'High transaction velocity',
    description = 'Flags successful or pending transaction velocity by payment identifier. Failed and declined transactions are excluded and evaluated by failed_attempt_velocity.',
    threshold_value = NULL,
    threshold_count = 6,
    time_window_minutes = 1,
    time_window_seconds = 60,
    points = 25,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'transaction_velocity';

UPDATE compliance_rules
SET rule_name = 'Repeated small transactions',
    description = 'Flags at least 5 transactions below SGD 10.00 for the same payment identifier within 5 minutes; overlaps with velocity use highest-points-only evidence.',
    threshold_value = 10.00,
    threshold_count = 5,
    time_window_minutes = 5,
    time_window_seconds = 300,
    points = 20,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'repeated_small_transactions';

UPDATE compliance_rules
SET rule_name = 'Frequent unusually large transactions',
    description = 'Flags at least 3 transactions above the configured large threshold within 30 minutes; overlaps with short-term velocity use highest-points-only evidence.',
    threshold_value = 3.00,
    threshold_count = 3,
    time_window_minutes = 30,
    time_window_seconds = 1800,
    points = 30,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'frequent_large_transactions';

UPDATE compliance_rules
SET rule_name = 'Repeated failed or declined payment attempts',
    description = 'Flags at least 3 failed or declined attempts for the same payment identifier within 10 minutes.',
    threshold_value = NULL,
    threshold_count = 3,
    time_window_minutes = 10,
    time_window_seconds = 600,
    points = 15,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'failed_attempt_velocity';

UPDATE compliance_rules
SET rule_name = 'Failed attempts followed by success',
    description = 'Flags a successful transaction after at least 3 failed or declined attempts for the same payment identifier within 10 minutes.',
    threshold_value = NULL,
    threshold_count = 3,
    time_window_minutes = 10,
    time_window_seconds = 600,
    points = 30,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'failure_then_success';

UPDATE compliance_rules
SET rule_name = 'Possible duplicate successful transaction',
    description = 'Flags at least one earlier successful transaction with the same merchant, payment identifier, amount, and currency within the configured window.',
    threshold_value = NULL,
    threshold_count = 1,
    time_window_minutes = 1,
    time_window_seconds = 60,
    points = 25,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'duplicate_payment_identifier';

UPDATE compliance_rules
SET rule_name = 'Transaction outside merchant operating hours',
    description = 'Applies only to face-to-face transactions for merchants with stored operating hours and a physical location.',
    threshold_value = NULL,
    threshold_count = NULL,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 10,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'outside_operating_hours';

UPDATE compliance_rules
SET rule_name = 'Missing useful identifying information',
    description = 'Flags missing monitoring references such as masked card, payment reference, terminal ID, or gateway reference.',
    threshold_value = NULL,
    threshold_count = NULL,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 10,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'data_quality';

UPDATE compliance_rules
SET rule_name = 'Online transaction with missing/invalid IP',
    description = 'Applies only to online transactions where an IP address is expected and is missing or invalid.',
    threshold_value = NULL,
    threshold_count = NULL,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 10,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'ip_validation';

UPDATE compliance_rules
SET is_active = 0,
    updated_at = NOW()
WHERE rule_type IN (
  'customer_risk',
  'ip_country_mismatch',
  'high_risk_jurisdiction',
  'cancellation_velocity',
  'country',
  'country_risk',
  'jurisdiction',
  'cross_border'
);

UPDATE compliance_rules duplicate_rule
JOIN compliance_rules canonical_rule
  ON canonical_rule.rule_type = duplicate_rule.rule_type
 AND canonical_rule.rule_id < duplicate_rule.rule_id
 AND canonical_rule.is_active = 1
SET duplicate_rule.is_active = 0,
    duplicate_rule.updated_at = NOW()
WHERE duplicate_rule.is_active = 1;
