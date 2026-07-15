-- Migration 007: add missing merchant-focused behavioral rules.
-- These prototype scoring weights are project assumptions, not regulatory thresholds.
-- Safe to rerun: existing rows are updated in place, missing rows are inserted,
-- and duplicate active rows for these rule types are deactivated without deletion.

UPDATE compliance_rules
SET rule_name = 'Daily transaction count spike',
    description = 'Flags daily transaction counts above merchant historical daily averages, MCC expected daily count, or the configured general fallback.',
    threshold_value = NULL,
    threshold_count = 50,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 15,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'daily_transaction_count_spike';

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count,
   time_window_minutes, time_window_seconds, points, is_active)
SELECT
  'Daily transaction count spike',
  'daily_transaction_count_spike',
  'Flags daily transaction counts above merchant historical daily averages, MCC expected daily count, or the configured general fallback.',
  NULL,
  50,
  NULL,
  NULL,
  15,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM compliance_rules WHERE rule_type = 'daily_transaction_count_spike'
);

UPDATE compliance_rules
SET rule_name = 'Daily transaction value spike',
    description = 'Flags daily transaction value above merchant historical daily averages, MCC expected daily value, or the configured general fallback.',
    threshold_value = 25000,
    threshold_count = NULL,
    time_window_minutes = NULL,
    time_window_seconds = NULL,
    points = 20,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'daily_transaction_value_spike';

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count,
   time_window_minutes, time_window_seconds, points, is_active)
SELECT
  'Daily transaction value spike',
  'daily_transaction_value_spike',
  'Flags daily transaction value above merchant historical daily averages, MCC expected daily value, or the configured general fallback.',
  25000,
  NULL,
  NULL,
  NULL,
  20,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM compliance_rules WHERE rule_type = 'daily_transaction_value_spike'
);

UPDATE compliance_rules
SET rule_name = 'Repeated identical amounts',
    description = 'Flags repeated exact or near-identical transaction amounts for the same merchant within 5 minutes, even when payment identifiers differ.',
    threshold_value = NULL,
    threshold_count = 4,
    time_window_minutes = 5,
    time_window_seconds = 300,
    points = 15,
    is_active = 1,
    updated_at = NOW()
WHERE rule_type = 'repeated_identical_amounts';

INSERT INTO compliance_rules
  (rule_name, rule_type, description, threshold_value, threshold_count,
   time_window_minutes, time_window_seconds, points, is_active)
SELECT
  'Repeated identical amounts',
  'repeated_identical_amounts',
  'Flags repeated exact or near-identical transaction amounts for the same merchant within 5 minutes, even when payment identifiers differ.',
  NULL,
  4,
  5,
  300,
  15,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM compliance_rules WHERE rule_type = 'repeated_identical_amounts'
);

UPDATE compliance_rules cr
JOIN (
  SELECT rule_type, MIN(rule_id) AS keep_rule_id
  FROM compliance_rules
  WHERE rule_type IN (
    'daily_transaction_count_spike',
    'daily_transaction_value_spike',
    'repeated_identical_amounts'
  )
  GROUP BY rule_type
) keepers ON keepers.rule_type = cr.rule_type
SET cr.is_active = 0,
    cr.updated_at = NOW()
WHERE cr.rule_id <> keepers.keep_rule_id
  AND cr.is_active = 1
  AND cr.rule_type IN (
    'daily_transaction_count_spike',
    'daily_transaction_value_spike',
    'repeated_identical_amounts'
  );
