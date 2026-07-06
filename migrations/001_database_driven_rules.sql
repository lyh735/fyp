-- Optional manual migration for an existing database.
-- The Node application performs the same changes automatically at startup.

ALTER TABLE compliance_rules
  ADD COLUMN IF NOT EXISTS time_window_seconds INT NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS ip_country VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS customer_risk_profile VARCHAR(20) NULL;

CREATE TABLE IF NOT EXISTS merchant_category_risk (
  risk_id INT AUTO_INCREMENT PRIMARY KEY,
  mcc_code VARCHAR(20) NULL,
  category_keyword VARCHAR(100) NULL,
  category_name VARCHAR(100) NOT NULL,
  points INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_merchant_category_mcc (mcc_code),
  UNIQUE KEY uq_merchant_category_keyword (category_keyword)
);

CREATE TABLE IF NOT EXISTS high_risk_jurisdictions (
  jurisdiction_id INT AUTO_INCREMENT PRIMARY KEY,
  country_code VARCHAR(3) NOT NULL UNIQUE,
  country_name VARCHAR(100) NOT NULL UNIQUE,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'high',
  reason VARCHAR(255),
  is_active TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

UPDATE compliance_rules
SET time_window_seconds = CASE rule_type
  WHEN 'velocity' THEN 30
  WHEN 'velocity_small_amount' THEN 300
  WHEN 'large_amount_frequency' THEN 1800
  WHEN 'cancellation_velocity' THEN 600
  WHEN 'failure_then_success' THEN 600
  WHEN 'duplicate_transaction' THEN 60
  ELSE time_window_seconds
END
WHERE time_window_seconds IS NULL
   OR (rule_type = 'velocity' AND time_window_seconds = 0);
