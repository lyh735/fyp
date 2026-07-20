USE `soi-2026-0046-yuhan`;

CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- admin, analyst, stro
    first_login TINYINT DEFAULT 1,
    status VARCHAR(30) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE merchants (
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
    terminals_seeded TINYINT(1) DEFAULT 0,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    created_by INT,
    updated_by INT,

    FOREIGN KEY (created_by) REFERENCES users(user_id),
    FOREIGN KEY (updated_by) REFERENCES users(user_id)
);

CREATE TABLE compliance_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    rule_name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50),
    description TEXT,
    threshold_value DECIMAL(12,2),
    threshold_count INT,
    time_window_minutes INT,
    points INT DEFAULT 0,
    is_active TINYINT DEFAULT 1,
    created_by INT,
    updated_by INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by) REFERENCES users(user_id),
    FOREIGN KEY (updated_by) REFERENCES users(user_id)
);

CREATE TABLE transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    merchant_id VARCHAR(50) NOT NULL,

    masked_payment_ref VARCHAR(100),

    card_bin VARCHAR(10),
    masked_card_number VARCHAR(30),
    card_presence VARCHAR(20), -- card_present / card_not_present

    terminal_id VARCHAR(50),
    payment_gateway_ref VARCHAR(100),

    payment_method VARCHAR(50),
    transaction_type VARCHAR(50), -- online / face_to_face
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'SGD',
    ip_address VARCHAR(45),
    country VARCHAR(50) DEFAULT 'Singapore',
    txn_time DATETIME,
    transaction_status VARCHAR(30),

    risk_score INT DEFAULT 0,
    risk_level VARCHAR(20),
    triggered_rules JSON,
    processing_status VARCHAR(50),

    source_type VARCHAR(30), -- simulator / manual / excel_upload / text_input
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id)
);

CREATE TABLE alerts (
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

CREATE TABLE case_actions (
    action_id INT AUTO_INCREMENT PRIMARY KEY,
    alert_id INT NOT NULL,
    user_id INT NOT NULL,

    action_type VARCHAR(50),
    -- alert_created, review_started, add_remark, rfi_generated,
    -- rfi_marked_sent, rfi_response_recorded, rfi_cancelled,
    -- escalate_to_stro, str_draft_generated, approve_str,
    -- reject_str, close_case, reassign_case
    status_after_action VARCHAR(40),

    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE rfi_requests (
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

CREATE TABLE mcc_codes (
    mcc_code VARCHAR(20) PRIMARY KEY,
    description VARCHAR(150) NOT NULL,
    is_active TINYINT(1) DEFAULT 1,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    created_by INT,
    updated_by INT,

    FOREIGN KEY (created_by) REFERENCES users(user_id),
    FOREIGN KEY (updated_by) REFERENCES users(user_id)
);

CREATE TABLE terminals (
    terminal_id VARCHAR(50) PRIMARY KEY,
    merchant_id VARCHAR(50) NOT NULL,
    label VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    created_by INT,
    updated_by INT,

    FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id),
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    FOREIGN KEY (updated_by) REFERENCES users(user_id)
);

CREATE TABLE str_reports (
    str_id INT AUTO_INCREMENT PRIMARY KEY,
    alert_id INT NOT NULL,

    generated_by INT NOT NULL,
    approved_by INT,

    str_reference_number VARCHAR(100) UNIQUE,
    narrative_text TEXT NOT NULL,

    status VARCHAR(30) DEFAULT 'draft', -- draft / approved / closed
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    rejected_at DATETIME,

    FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
    FOREIGN KEY (generated_by) REFERENCES users(user_id),
    FOREIGN KEY (approved_by) REFERENCES users(user_id)
);

CREATE INDEX idx_alerts_status_assigned
ON alerts(status, assigned_to);

CREATE INDEX idx_alerts_priority
ON alerts(priority);

CREATE INDEX idx_transactions_merchant_time
ON transactions(merchant_id, txn_time);

CREATE INDEX idx_transactions_terminal_time
ON transactions(terminal_id, txn_time);

CREATE INDEX idx_transactions_masked_card_time
ON transactions(masked_card_number, txn_time);

CREATE INDEX idx_case_actions_created
ON case_actions(created_at);

CREATE INDEX idx_rfi_status_due
ON rfi_requests(status, due_at);

CREATE INDEX idx_str_status
ON str_reports(status);

CREATE INDEX idx_terminals_merchant
ON terminals(merchant_id);
