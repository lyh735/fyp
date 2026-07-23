-- Optional test-only setup for case 20.
-- This temporarily disables the investigation priority multiplier for MCC 4829.
-- Run only in a test database, import TXN-RS-020, then restore the setting below.

UPDATE merchant_category_risk
SET use_priority_multiplier = 0
WHERE mcc_code = '4829' AND is_active = 1;

-- Restore after testing case 20:
-- UPDATE merchant_category_risk
-- SET use_priority_multiplier = 1, priority_multiplier = 3.00
-- WHERE mcc_code = '4829' AND is_active = 1;
