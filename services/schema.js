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
      time_window_seconds INT,
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
    CREATE TABLE IF NOT EXISTS merchant_category_risk (
      risk_id INT AUTO_INCREMENT PRIMARY KEY,
      mcc_code VARCHAR(20) NULL,
      category_name VARCHAR(100) NOT NULL,
      category_keyword VARCHAR(100) NULL,
      points INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_merchant_category_mcc (mcc_code),
      UNIQUE KEY uq_merchant_category_keyword (category_keyword)
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

  await ensureReferenceData();
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

async function addUniqueIndexIfNoDuplicates(table, indexName, column) {
  if (await indexExists(table, indexName)) return;

  const duplicates = await query(`
    SELECT ${column}, COUNT(*) AS count
    FROM ${table}
    WHERE ${column} IS NOT NULL AND ${column} <> ''
    GROUP BY ${column}
    HAVING COUNT(*) > 1
    LIMIT 1
  `);

  if (!duplicates.length) {
    await query(`CREATE UNIQUE INDEX ${indexName} ON ${table}(${column})`);
  }
}

async function ensureCurrentSchemaCompatibility() {
  await addColumnIfMissing("merchants", "has_physical_location", "TINYINT(1) DEFAULT 1");
  await addColumnIfMissing("merchants", "created_by", "INT NULL");
  await addColumnIfMissing("merchants", "updated_by", "INT NULL");
  await addColumnIfMissing("merchants", "terminals_seeded", "TINYINT(1) DEFAULT 0");

  await addColumnIfMissing("compliance_rules", "time_window_seconds", "INT NULL");

  await addColumnIfMissing("transactions", "card_bin", "VARCHAR(10) NULL");
  await addColumnIfMissing("transactions", "masked_card_number", "VARCHAR(30) NULL");
  await addColumnIfMissing("transactions", "card_presence", "VARCHAR(20) NULL");
  await addColumnIfMissing("transactions", "terminal_id", "VARCHAR(50) NULL");
  await addColumnIfMissing("transactions", "payment_gateway_ref", "VARCHAR(100) NULL");
  await addColumnIfMissing("transactions", "ip_country", "VARCHAR(50) NULL");
  await addColumnIfMissing("transactions", "customer_risk_profile", "VARCHAR(20) NULL");

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
  await addUniqueIndexIfNoDuplicates("compliance_rules", "uq_compliance_rules_rule_type", "rule_type");

  await query(`
    UPDATE compliance_rules
    SET rule_type = 'failed_attempt_velocity',
        rule_name = CASE
          WHEN rule_name IS NULL OR rule_name = '' OR LOWER(rule_name) LIKE '%cancel%'
          THEN 'Repeated failed or declined payment attempts'
          ELSE rule_name
        END,
        description = 'Flags repeated failed or declined payment attempts using the same payment identifier.',
        time_window_seconds = COALESCE(time_window_seconds, time_window_minutes * 60, 600),
        updated_at = NOW()
    WHERE rule_type = 'cancellation_velocity'
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT rule_id FROM compliance_rules WHERE rule_type = 'failed_attempt_velocity'
        ) AS existing_failed_rule
      )
  `);

  await query(`
    UPDATE compliance_rules
    SET is_active = 0, updated_at = NOW()
    WHERE rule_type = 'cancellation_velocity'
  `);

  await query(`
    UPDATE compliance_rules
    SET is_active = 0, updated_at = NOW()
    WHERE rule_type = 'high_risk_jurisdiction'
       OR rule_type IN ('country', 'country_risk', 'jurisdiction', 'cross_border')
       OR LOWER(COALESCE(rule_name, '')) LIKE '%high-risk jurisdiction%'
       OR LOWER(COALESCE(rule_name, '')) LIKE '%high risk jurisdiction%'
       OR LOWER(COALESCE(rule_name, '')) LIKE '%high-risk country%'
       OR LOWER(COALESCE(rule_name, '')) LIKE '%cross-border%'
       OR LOWER(COALESCE(rule_name, '')) LIKE '%cross border%'
       OR LOWER(COALESCE(rule_name, '')) LIKE '%jurisdiction%'
  `);

  await query(`
    UPDATE compliance_rules
    SET time_window_seconds = CASE
      WHEN time_window_seconds IS NOT NULL THEN time_window_seconds
      WHEN time_window_minutes IS NOT NULL THEN time_window_minutes * 60
      WHEN rule_type = 'velocity' THEN 60
      WHEN rule_type = 'velocity_small_amount' THEN 300
      WHEN rule_type = 'large_amount_frequency' THEN 1800
      WHEN rule_type = 'failed_attempt_velocity' THEN 600
      WHEN rule_type = 'failure_then_success' THEN 600
      WHEN rule_type = 'duplicate_transaction' THEN 60
      ELSE NULL
    END
  `);

  await query(`
    UPDATE rfi_requests
    SET reference_no = CONCAT('RFI-', YEAR(COALESCE(sent_at, NOW())), '-', LPAD(alert_id, 4, '0'))
    WHERE reference_no IS NULL OR reference_no = ''
  `);
  await query("UPDATE rfi_requests SET requested_documents = '[]' WHERE requested_documents IS NULL");
  await query("UPDATE rfi_requests SET status = 'Pending Merchant Response' WHERE status = 'Pending'");
  await query("UPDATE rfi_requests SET is_sent = 1 WHERE sent_at IS NOT NULL");
}

async function ensureReferenceData() {
  const rows = [
    ["4511", "Airlines / travel", null, 15],
    ["4722", "Travel agencies / tourism", null, 15],
    ["4789", "Transportation / travel services", null, 15],
    ["4812", "Financial / telecom payment services", null, 15],
    ["4829", "Money transfer / remittance", null, 15],
    ["5311", "Retail / department stores", null, 5],
    ["5411", "Grocery stores", null, 5],
    ["5541", "Retail / service stations", null, 5],
    ["5651", "Retail / clothing", null, 5],
    ["5732", "Electronics", null, 10],
    ["5812", "Restaurants", null, 5],
    ["5813", "Bars / food and beverage", null, 5],
    ["5814", "Fast food", null, 5],
    ["6012", "Financial institutions", null, 15],
    ["6051", "Money services / money orders", null, 15],
    ["7011", "Hotel / lodging", null, 15],
    ["7995", "Gambling / betting", null, 15],
    [null, "Food and beverage", "food", 5],
    [null, "Food and beverage", "restaurant", 5],
    [null, "Retail", "retail", 5],
    [null, "Electronics", "electronic", 10],
    [null, "Travel / tourism", "travel", 15],
    [null, "Money transfer / remittance", "remittance", 15],
    [null, "Financial services", "financial", 15],
    [null, "Gambling / betting", "gambling", 15],
  ];

  for (const [mccCode, categoryName, categoryKeyword, points] of rows) {
    await query(
      `
        INSERT INTO merchant_category_risk
          (mcc_code, category_name, category_keyword, points, is_active)
        VALUES (?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          category_name = VALUES(category_name),
          points = VALUES(points),
          updated_at = NOW()
      `,
      [mccCode, categoryName, categoryKeyword, points]
    );
  }
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

  const currentRules = [
    {
      rule_name: "Merchant MCC or industry risk",
      rule_type: "merchant_profile",
      description: "Adds configured merchant profile risk points from the merchant_category_risk database table.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 0,
      is_active: 1,
    },
    {
      rule_name: "Significant amount compared to merchant average",
      rule_type: "amount_multiplier",
      description: "Flags transactions above a configurable multiple of the trusted merchant average amount.",
      threshold_value: 3,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 25,
      is_active: 1,
    },
    {
      rule_name: "High transaction velocity",
      rule_type: "velocity",
      description: "Flags repeated transactions using the same payment identifier within the configured time window.",
      threshold_value: null,
      threshold_count: 6,
      time_window_minutes: 1,
      time_window_seconds: 60,
      points: 25,
      is_active: 1,
    },
    {
      rule_name: "Repeated small transactions",
      rule_type: "velocity_small_amount",
      description: "Flags repeated small-value transactions using the same payment identifier.",
      threshold_value: 10,
      threshold_count: 5,
      time_window_minutes: 5,
      time_window_seconds: 300,
      points: 20,
      is_active: 1,
    },
    {
      rule_name: "Frequent unusually large transactions",
      rule_type: "large_amount_frequency",
      description: "Flags repeated transactions above a configurable multiple of the merchant average.",
      threshold_value: 3,
      threshold_count: 3,
      time_window_minutes: 30,
      time_window_seconds: 1800,
      points: 30,
      is_active: 1,
    },
    {
      rule_name: "Repeated failed or declined payment attempts",
      rule_type: "failed_attempt_velocity",
      description: "Flags repeated failed or declined payment attempts using the same payment identifier.",
      threshold_value: null,
      threshold_count: 3,
      time_window_minutes: 10,
      time_window_seconds: 600,
      points: 15,
      is_active: 1,
    },
    {
      rule_name: "Failed attempts followed by success",
      rule_type: "failure_then_success",
      description: "Flags a successful transaction following several recent failed or declined attempts using the same payment identifier.",
      threshold_value: null,
      threshold_count: 3,
      time_window_minutes: 10,
      time_window_seconds: 600,
      points: 30,
      is_active: 1,
    },
    {
      rule_name: "Possible duplicate successful transaction",
      rule_type: "duplicate_transaction",
      description: "Flags a successful transaction that repeats merchant, amount, currency, and payment identifier within a short window.",
      threshold_value: null,
      threshold_count: 1,
      time_window_minutes: 1,
      time_window_seconds: 60,
      points: 25,
      is_active: 1,
    },
    {
      rule_name: "Transaction outside merchant operating hours",
      rule_type: "time",
      description: "Applies only to face-to-face transactions for merchants with a physical location and recorded operating hours.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 10,
      is_active: 1,
    },
    {
      rule_name: "High-risk customer profile",
      rule_type: "customer_risk",
      description: "Adds supporting risk points when the customer profile is independently marked high risk.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 15,
      is_active: 1,
    },
    {
      rule_name: "Missing useful identifying information",
      rule_type: "data_quality",
      description: "Flags transactions missing useful monitoring references such as masked card, payment reference, terminal ID, or gateway reference.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 10,
      is_active: 1,
    },
    {
      rule_name: "Online transaction with missing/invalid IP",
      rule_type: "ip_validation",
      description: "Flags online transactions where IP address is missing or invalid.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 10,
      is_active: 1,
    },
    {
      rule_name: "IP country mismatch",
      rule_type: "ip_country_mismatch",
      description: "Flags online transactions when verified IP-derived country differs from transaction country.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 20,
      is_active: 0,
    },
  ];

  for (const rule of currentRules) {
    const existing = await query(
      "SELECT rule_id FROM compliance_rules WHERE rule_type = ? ORDER BY rule_id ASC LIMIT 1",
      [rule.rule_type]
    );

    if (!existing.length) {
      await query(
        `
          INSERT INTO compliance_rules
            (
              rule_name, rule_type, description, threshold_value, threshold_count,
              time_window_minutes, time_window_seconds, points, is_active, created_by, updated_by
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          rule.rule_name,
          rule.rule_type,
          rule.description,
          rule.threshold_value,
          rule.threshold_count,
          rule.time_window_minutes,
          rule.time_window_seconds,
          rule.points,
          rule.is_active,
          authorId,
          authorId,
        ]
      );
    }
  }
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

module.exports = { ensureComplianceSchema, ensureDefaultRules, ensureDefaultMccCodes, ensureReferenceData };
