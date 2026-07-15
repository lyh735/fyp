-- Adds an optional merchant-specific maximum transaction amount.
-- This preserves all existing merchant rows and leaves the value NULL until
-- configured by an administrator or merchant import.

DROP PROCEDURE IF EXISTS add_merchant_max_column_if_missing;

DELIMITER //
CREATE PROCEDURE add_merchant_max_column_if_missing(
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

CALL add_merchant_max_column_if_missing('merchants', 'merchant_max_transaction_amount', 'DECIMAL(12,2) NULL AFTER merchant_average_amount');

DROP PROCEDURE IF EXISTS add_merchant_max_column_if_missing;
