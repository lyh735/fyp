-- The compliance_manager role had the same permissions as admin.
-- Keep one canonical privileged role for all existing and future accounts.
UPDATE users
SET role = 'admin', updated_at = NOW()
WHERE LOWER(TRIM(role)) = 'compliance_manager';
