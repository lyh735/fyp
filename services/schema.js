const { query } = require("./dbQuery");

async function ensureComplianceSchema() {
  await query(`
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
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS merchants (
      merchant_id VARCHAR(50) PRIMARY KEY,
      merchant_name VARCHAR(100) NOT NULL,
      business_category VARCHAR(100),
      mcc_code VARCHAR(20),
      merchant_average_amount DECIMAL(12,2),
      operating_hours_start TIME,
      operating_hours_end TIME,
      risk_level VARCHAR(20),
      merchant_risk_score INT DEFAULT 0,
      country VARCHAR(50) DEFAULT 'Singapore',
      has_physical_location TINYINT(1) DEFAULT 1,
      status VARCHAR(30),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INT,
      updated_by INT,
      FOREIGN KEY (created_by) REFERENCES users(user_id),
      FOREIGN KEY (updated_by) REFERENCES users(user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS compliance_rules (
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
    )
  `);

  await query(`
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
      txn_time DATETIME,
      transaction_status VARCHAR(30),
      risk_score INT DEFAULT 0,
      risk_level VARCHAR(20),
      triggered_rules JSON,
      processing_status VARCHAR(50),
      source_type VARCHAR(30),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id)
    )
  `);

  await query(`
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by INT,
      read_at DATETIME,
      assigned_to INT,
      escalated_at DATETIME,
      FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
      FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id),
      FOREIGN KEY (reviewed_by) REFERENCES users(user_id),
      FOREIGN KEY (assigned_to) REFERENCES users(user_id)
    )
  `);

  await query(`
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
    )
  `);

  await query(`
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
      responded_at DATETIME NULL,
      is_sent TINYINT(1) DEFAULT 0,
      FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
      FOREIGN KEY (requested_by) REFERENCES users(user_id)
    )
  `);

  await query(`
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
    )
  `);

  await ensureCurrentSchemaCompatibility();

  await ensureDefaultRules();
}

async function columnExists(table, column) {
  const rows = await query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [table, column]);
  return rows[0].count > 0;
}

async function addColumnIfMissing(table, column, definition) {
  if (!(await columnExists(table, column))) {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureCurrentSchemaCompatibility() {
  await addColumnIfMissing("merchants", "has_physical_location", "TINYINT(1) DEFAULT 1");
  await addColumnIfMissing("merchants", "created_by", "INT NULL");
  await addColumnIfMissing("merchants", "updated_by", "INT NULL");

  await addColumnIfMissing("transactions", "card_bin", "VARCHAR(10) NULL");
  await addColumnIfMissing("transactions", "masked_card_number", "VARCHAR(30) NULL");
  await addColumnIfMissing("transactions", "card_presence", "VARCHAR(20) NULL");
  await addColumnIfMissing("transactions", "terminal_id", "VARCHAR(50) NULL");
  await addColumnIfMissing("transactions", "payment_gateway_ref", "VARCHAR(100) NULL");

  await addColumnIfMissing("alerts", "priority", "VARCHAR(20) NULL");
  await addColumnIfMissing("alerts", "assigned_to", "INT NULL");
  await addColumnIfMissing("alerts", "reviewed_at", "DATETIME NULL");
  await addColumnIfMissing("alerts", "reviewed_by", "INT NULL");
  await addColumnIfMissing("alerts", "escalated_at", "DATETIME NULL");
  await addColumnIfMissing("case_actions", "status_after_action", "VARCHAR(40) NULL");
  await query(`
    UPDATE case_actions
    SET action_type = CASE action_type
      WHEN 'review' THEN 'review_started'
      WHEN 'dismiss' THEN 'close_case'
      WHEN 'escalate' THEN 'escalate_to_stro'
      WHEN 'rfi_sent' THEN 'rfi_marked_sent'
      WHEN 'rfi_received' THEN 'rfi_response_recorded'
      ELSE action_type
    END
    WHERE action_type IN ('review', 'dismiss', 'escalate', 'rfi_sent', 'rfi_received')
  `);

  await query("ALTER TABLE rfi_requests MODIFY COLUMN status VARCHAR(40) DEFAULT 'Draft'");
  await query("ALTER TABLE rfi_requests MODIFY COLUMN sent_at DATETIME NULL DEFAULT NULL");
  await addColumnIfMissing("rfi_requests", "reference_no", "VARCHAR(30) NULL");
  await addColumnIfMissing("rfi_requests", "requested_documents", "TEXT NULL");
  await addColumnIfMissing("rfi_requests", "additional_remarks", "TEXT NULL");
  await addColumnIfMissing("rfi_requests", "created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");
  await addColumnIfMissing("rfi_requests", "updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");
  await addColumnIfMissing("rfi_requests", "response_message", "TEXT NULL");
  await addColumnIfMissing("rfi_requests", "responded_at", "DATETIME NULL");
  await addColumnIfMissing("rfi_requests", "response_attachment", "VARCHAR(255) NULL");
  await addColumnIfMissing("rfi_requests", "is_sent", "TINYINT(1) DEFAULT 0");
  await addColumnIfMissing("str_reports", "rejected_at", "DATETIME NULL");

  await query(`
    UPDATE rfi_requests
    SET reference_no = CONCAT('RFI-', YEAR(COALESCE(sent_at, NOW())), '-', LPAD(alert_id, 4, '0'))
    WHERE reference_no IS NULL OR reference_no = ''
  `);
  await query("UPDATE rfi_requests SET requested_documents = '[]' WHERE requested_documents IS NULL");
  await query("UPDATE rfi_requests SET status = 'Pending Merchant Response' WHERE status = 'Pending'");
  await query("UPDATE rfi_requests SET is_sent = 1 WHERE sent_at IS NOT NULL");
}

async function ensureDefaultRules(createdBy = null) {
  let authorId = createdBy;

  if (!authorId) {
    const authors = await query(
      "SELECT user_id FROM users ORDER BY user_id ASC LIMIT 1"
    );
    if (authors.length === 0) return;
    authorId = authors[0].user_id;
  }

  await query(`
    UPDATE compliance_rules
    SET is_active = 0, updated_at = NOW()
    WHERE LOWER(rule_name) LIKE '%high-risk country%'
       OR LOWER(rule_name) LIKE '%high risk country%'
       OR LOWER(rule_name) LIKE '%jurisdiction%'
       OR LOWER(rule_name) LIKE '%cross-border%'
       OR LOWER(rule_name) LIKE '%cross border%'
       OR rule_type IN ('country', 'country_risk', 'jurisdiction', 'cross_border')
  `);

  const currentRules = [
    {
      rule_name: "Merchant MCC/base industry risk score",
      rule_type: "merchant_profile",
      description: "Adds base risk using merchant MCC or business category: F&B +5, retail +10, electronics +15, travel/tourism/hotel +20, money service/remittance/financial/gambling +30.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      points: 30,
    },
    {
      rule_name: "Significant amount compared to merchant average",
      rule_type: "amount_multiplier",
      description: "Flags transactions greater than three times the merchant average amount.",
      threshold_value: 3.00,
      threshold_count: null,
      time_window_minutes: null,
      points: 30,
    },
    {
      rule_name: "High transaction velocity",
      rule_type: "velocity",
      description: "High transaction velocity detected: 10 transactions within 30 seconds.",
      threshold_value: null,
      threshold_count: 10,
      time_window_minutes: 0,
      points: 35,
    },
    {
      rule_name: "Repeated small transactions",
      rule_type: "velocity_small_amount",
      description: "Repeated small transactions detected: 5 transactions below SGD 10 within 5 minutes.",
      threshold_value: 10.00,
      threshold_count: 5,
      time_window_minutes: 5,
      points: 25,
    },
    {
      rule_name: "Frequent large amount transactions",
      rule_type: "large_amount_frequency",
      description: "Frequent large amount transactions detected within 30 minutes.",
      threshold_value: 3.00,
      threshold_count: 3,
      time_window_minutes: 30,
      points: 35,
    },
    {
      rule_name: "Repeated cancelled or failed transactions",
      rule_type: "cancellation_velocity",
      description: "Repeated cancelled or failed transactions detected within 10 minutes.",
      threshold_value: null,
      threshold_count: 3,
      time_window_minutes: 10,
      points: 25,
    },
    {
      rule_name: "Transaction outside merchant operating hours",
      rule_type: "time",
      description: "Flags transactions made outside the merchant operating_hours_start and operating_hours_end values. The rule is skipped when operating hours are missing.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      points: 15,
    },
    {
      rule_name: "High-risk customer profile",
      rule_type: "customer_risk",
      description: "Adds risk points when the customer profile is marked high risk.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      points: 25,
    },
    {
      rule_name: "Missing or insufficient transaction information",
      rule_type: "data_quality",
      description: "Flags transactions missing useful identifying references such as masked card, masked payment reference, terminal ID, or gateway reference.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      points: 20,
    },
    {
      rule_name: "Online transaction with missing/invalid IP",
      rule_type: "ip_validation",
      description: "Flags online transactions where IP address is missing or invalid.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      points: 20,
    },
  ];

  for (const rule of currentRules) {
    const existing = await query(
      "SELECT rule_id FROM compliance_rules WHERE rule_type = ? OR rule_name = ? ORDER BY rule_id ASC LIMIT 1",
      [rule.rule_type, rule.rule_name]
    );

    if (existing.length) {
      await query(
        `
          UPDATE compliance_rules
          SET rule_name = ?, description = ?, threshold_value = ?,
              threshold_count = ?, time_window_minutes = ?, points = ?,
              is_active = 1, updated_by = ?, updated_at = NOW()
          WHERE rule_id = ?
        `,
        [
          rule.rule_name,
          rule.description,
          rule.threshold_value,
          rule.threshold_count,
          rule.time_window_minutes,
          rule.points,
          authorId,
          existing[0].rule_id,
        ]
      );
    } else {
      await query(
        `
          INSERT INTO compliance_rules
            (
              rule_name, rule_type, description, threshold_value, threshold_count,
              time_window_minutes, points, is_active, created_by
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        `,
        [
          rule.rule_name,
          rule.rule_type,
          rule.description,
          rule.threshold_value,
          rule.threshold_count,
          rule.time_window_minutes,
          rule.points,
          authorId,
        ]
      );
    }
  }
}

module.exports = { ensureComplianceSchema, ensureDefaultRules };
