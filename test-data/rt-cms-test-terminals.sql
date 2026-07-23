-- Optional setup for face-to-face testing.
-- Run only after importing valid-merchants-import.xlsx.

INSERT INTO terminals (terminal_id, merchant_id, label, status)
SELECT 'TERM-RTM-BAR-001', 'RTM-BAR-HOURS-001', 'Riverside Bar Test Main POS', 'active'
WHERE EXISTS (SELECT 1 FROM merchants WHERE merchant_id = 'RTM-BAR-HOURS-001')
ON DUPLICATE KEY UPDATE
  merchant_id = VALUES(merchant_id),
  label = VALUES(label),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP;
