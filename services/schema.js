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
      terminals_seeded TINYINT(1) DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS mcc_codes (
      mcc_code VARCHAR(20) PRIMARY KEY,
      description VARCHAR(150) NOT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INT,
      updated_by INT,
      FOREIGN KEY (created_by) REFERENCES users(user_id),
      FOREIGN KEY (updated_by) REFERENCES users(user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS terminals (
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
  await ensureDefaultMccCodes();
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

async function indexExists(table, indexName) {
  const rows = await query(`
    SELECT COUNT(*) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
  `, [table, indexName]);
  return rows[0].count > 0;
}

async function addIndexIfMissing(table, indexName, columns) {
  if (!(await indexExists(table, indexName))) {
    await query(`CREATE INDEX ${indexName} ON ${table}(${columns})`);
  }
}

async function ensureCurrentSchemaCompatibility() {
  await addColumnIfMissing("merchants", "has_physical_location", "TINYINT(1) DEFAULT 1");
  await addColumnIfMissing("merchants", "created_by", "INT NULL");
  await addColumnIfMissing("merchants", "updated_by", "INT NULL");
  await addColumnIfMissing("merchants", "terminals_seeded", "TINYINT(1) DEFAULT 0");

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

  await addIndexIfMissing("terminals", "idx_terminals_merchant", "merchant_id");

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
  const rules = await query("SELECT COUNT(*) AS count FROM compliance_rules");
  if (rules[0].count > 0) return;

  let authorId = createdBy;
  if (!authorId) {
    const authors = await query(
      "SELECT user_id FROM users ORDER BY user_id ASC LIMIT 1"
    );
    if (authors.length === 0) return;
    authorId = authors[0].user_id;
  }

  await query(`
      INSERT INTO compliance_rules
        (
          rule_name, rule_type, description, threshold_value, threshold_count,
          time_window_minutes, points, is_active, created_by
        )
      VALUES
        (
          'Significant amount compared to merchant average',
          'amount_multiplier',
          'Flags transactions greater than three times the merchant average amount.',
          3.00,
          NULL,
          NULL,
          30,
          1,
          ?
        ),
        (
          'Repeated transactions within short period',
          'velocity',
          'Flags merchants with five or more transactions within ten minutes.',
          NULL,
          5,
          10,
          25,
          1,
          ?
        ),
        (
          'Transaction outside operating hours',
          'time',
          'Flags transactions made from 11 PM to before 6 AM.',
          NULL,
          NULL,
          NULL,
          15,
          1,
          ?
        ),
        (
          'High-risk customer profile',
          'customer_risk',
          'Adds risk points when the customer profile is marked high risk.',
          NULL,
          NULL,
          NULL,
          25,
          1,
          ?
        ),
        (
          'High-risk country/jurisdiction',
          'jurisdiction',
          'Flags transactions from configured high-risk countries or jurisdictions.',
          NULL,
          NULL,
          NULL,
          30,
          1,
          ?
        ),
        (
          'Missing or insufficient information',
          'data_quality',
          'Flags transactions where important information such as country was missing or defaulted.',
          NULL,
          NULL,
          NULL,
          20,
          1,
          ?
        ),
        (
          'Online transaction with missing/invalid IP',
          'ip_validation',
          'Flags online transactions without a valid IP address.',
          NULL,
          NULL,
          NULL,
          20,
          1,
          ?
        ),
        (
          'Large cross-border transfer amount if country is not Singapore',
          'cross_border',
          'Flags SGD transactions above 1500 when the transaction country is not Singapore.',
          1500.00,
          NULL,
          NULL,
          25,
          1,
          ?
        )
  `, Array(8).fill(authorId));
}

async function ensureDefaultMccCodes(createdBy = null) {
  const existing = await query("SELECT COUNT(*) AS count FROM mcc_codes");
  if (existing[0].count > 0) return;

  let authorId = createdBy;
  if (!authorId) {
    const authors = await query("SELECT user_id FROM users ORDER BY user_id ASC LIMIT 1");
    if (authors.length === 0) return;
    authorId = authors[0].user_id;
  }

  const defaults = [
    ["5812", "Eating Places, Restaurants"],
    ["5814", "Fast Food Restaurants"],
    ["5399", "Miscellaneous General Merchandise"],
    ["5462", "Bakeries"],
    ["5947", "Gift, Novelty & Souvenir Shops"],
    ["5651", "Family Clothing Stores"],
  ];

  for (const [mccCode, description] of defaults) {
    await query(
      "INSERT IGNORE INTO mcc_codes (mcc_code, description, is_active, created_by, updated_by) VALUES (?, ?, 1, ?, ?)",
      [mccCode, description, authorId, authorId]
    );
  }
}

module.exports = { ensureComplianceSchema, ensureDefaultRules, ensureDefaultMccCodes };
