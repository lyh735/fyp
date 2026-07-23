-- Deactivate failed-payment monitoring rules for the current merchant-focused scope.
-- Lecturer feedback: failed, declined and cancelled payment attempts may be captured
-- from input sources, but they must not enter compliance monitoring, risk scoring,
-- history-based rule counts, alert generation or investigation queues.
--
-- This migration preserves historical rule rows and IDs. It does not delete data.

UPDATE compliance_rules
SET
  is_active = 0,
  description = CASE
    WHEN rule_type = 'failed_attempt_velocity'
      THEN 'Inactive future enhancement. Failed, declined and cancelled transactions do not enter compliance monitoring under the current project scope.'
    WHEN rule_type = 'failure_then_success'
      THEN 'Inactive future enhancement. Failed-payment sequences are excluded from active merchant-focused monitoring under the current project scope.'
    ELSE description
  END,
  updated_at = NOW()
WHERE rule_type IN (
  'failed_attempt_velocity',
  'failure_then_success',
  'failed_transactions_velocity'
);

UPDATE compliance_rules
SET
  description = 'Flags successful or completed transaction velocity by payment identifier. Failed, declined and cancelled transactions are captured only as intake statuses and are not monitored.',
  updated_at = NOW()
WHERE rule_type IN ('transaction_velocity', 'velocity');
