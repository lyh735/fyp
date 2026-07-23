-- Optional prerequisite for face-to-face transaction test rows.
-- Safe test seed: inserts only the demo terminal needed by TXN-RS-014.
-- Do not run on production unless the DEMO-BAR-HOURS-001 merchant exists and you want this test terminal.

INSERT INTO terminals (terminal_id, merchant_id, label, status)
SELECT 'TERM-DEMO-BAR-001', 'DEMO-BAR-HOURS-001', 'Demo Riverside Bar Main POS', 'active'
WHERE EXISTS (
  SELECT 1 FROM merchants WHERE merchant_id = 'DEMO-BAR-HOURS-001'
)
ON DUPLICATE KEY UPDATE
  merchant_id = VALUES(merchant_id),
  label = VALUES(label),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP;
