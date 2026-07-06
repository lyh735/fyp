-- Select your own database before running this script.
-- Example: USE your_database_name;

CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    first_login TINYINT DEFAULT 1,
    status VARCHAR(30) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS merchants (
    merchant_id VARCHAR(50) PRIMARY KEY,
    merchant_name VARCHAR(100) NOT NULL,
    business_category VARCHAR(100),
    mcc_code VARCHAR(20),
    merchant_average_amount DECIMAL(12,2),
    merchant_risk_score INT DEFAULT 0,
    operating_hours_start TIME,
    operating_hours_end TIME,
    risk_level VARCHAR(20),
    country VARCHAR(50) DEFAULT 'Singapore',
    has_physical_location TINYINT(1) DEFAULT 1,
    status VARCHAR(30),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INT,
    updated_by INT,
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    FOREIGN KEY (updated_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS compliance_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50),
    description TEXT,
    threshold_value DECIMAL(12,2),
    threshold_count INT,
    time_window_minutes INT,
    time_window_seconds INT,
    points INT DEFAULT 0,
    is_active TINYINT DEFAULT 1,
    created_by INT,
    updated_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    FOREIGN KEY (updated_by) REFERENCES users(user_id)
);

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

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    merchant_id VARCHAR(50) NOT NULL,
    masked_payment_ref VARCHAR(100),
    card_bin VARCHAR(10),
    masked_card_number VARCHAR(30),
    card_presence VARCHAR(20),
    terminal_id VARCHAR(50),
    payment_gateway_ref VARCHAR(100),
    payment_method VARCHAR(50),
    transaction_type VARCHAR(50),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'SGD',
    ip_address VARCHAR(45),
    country VARCHAR(50) DEFAULT 'Singapore',
    ip_country VARCHAR(50),
    customer_risk_profile VARCHAR(20),
    txn_time DATETIME,
    transaction_status VARCHAR(30),
    risk_score INT DEFAULT 0,
    risk_level VARCHAR(20),
    triggered_rules JSON,
    processing_status VARCHAR(50),
    source_type VARCHAR(30),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id)
);

CREATE TABLE IF NOT EXISTS alerts (
    alert_id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id VARCHAR(50) NOT NULL,
    merchant_id VARCHAR(50) NOT NULL,
    risk_score INT,
    risk_level VARCHAR(20),
    triggered_rules JSON,
    status VARCHAR(30) DEFAULT 'open',
    priority VARCHAR(20),
    message TEXT,
    assigned_to INT,
    read_at DATETIME,
    reviewed_at DATETIME,
    reviewed_by INT,
    escalated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
    FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id),
    FOREIGN KEY (assigned_to) REFERENCES users(user_id),
    FOREIGN KEY (reviewed_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS case_actions (
    action_id INT AUTO_INCREMENT PRIMARY KEY,
    alert_id INT NOT NULL,
    user_id INT NOT NULL,
    action_type VARCHAR(50),
    status_after_action VARCHAR(40),
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS rfi_requests (
    rfi_id INT AUTO_INCREMENT PRIMARY KEY,
    alert_id INT NOT NULL UNIQUE,
    requested_by INT NOT NULL,
    reference_no VARCHAR(30) NOT NULL UNIQUE,
    requested_documents TEXT NOT NULL,
    additional_remarks TEXT,
    request_message TEXT,
    response_message TEXT,
    response_attachment VARCHAR(255),
    status VARCHAR(40) DEFAULT 'Draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,
    due_at DATETIME NOT NULL,
    responded_at DATETIME,
    is_sent TINYINT(1) DEFAULT 0,
    FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
    FOREIGN KEY (requested_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS str_reports (
    str_id INT AUTO_INCREMENT PRIMARY KEY,
    alert_id INT NOT NULL,
    generated_by INT NOT NULL,
    approved_by INT,
    str_reference_number VARCHAR(100) UNIQUE,
    narrative_text TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'draft',
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    rejected_at DATETIME,
    FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
    FOREIGN KEY (generated_by) REFERENCES users(user_id),
    FOREIGN KEY (approved_by) REFERENCES users(user_id)
);

-- The application automatically inserts the default compliance rules and
-- merchant-category reference data when it starts.
-- Add only jurisdictions approved for your project/demo, for example:
-- INSERT INTO high_risk_jurisdictions
--   (country_code, country_name, risk_level, reason)
-- VALUES ('TST', 'Demo Jurisdiction', 'high', 'Demonstration record only');
