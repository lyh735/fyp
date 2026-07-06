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
      category_keyword VARCHAR(100) NULL,
      category_name VARCHAR(100) NOT NULL,
      points INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_merchant_category_mcc (mcc_code),
      UNIQUE KEY uq_merchant_category_keyword (category_keyword)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS high_risk_jurisdictions (
      jurisdiction_id INT AUTO_INCREMENT PRIMARY KEY,
      country_code VARCHAR(3) NOT NULL UNIQUE,
      country_name VARCHAR(100) NOT NULL UNIQUE,
      risk_level VARCHAR(20) NOT NULL DEFAULT 'high',
      reason VARCHAR(255),
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
}

async function columnExists(table, column) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [table, column]
  );

  return Number(rows[0]?.count || 0) > 0;
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
       OR (rule_type = 'velocity' AND time_window_seconds = 0)
  `);

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
    SET reference_no = CONCAT(
      'RFI-',
      YEAR(COALESCE(sent_at, NOW())),
      '-',
      LPAD(alert_id, 4, '0')
    )
    WHERE reference_no IS NULL OR reference_no = ''
  `);
  await query("UPDATE rfi_requests SET requested_documents = '[]' WHERE requested_documents IS NULL");
  await query("UPDATE rfi_requests SET status = 'Pending Merchant Response' WHERE status = 'Pending'");
  await query("UPDATE rfi_requests SET is_sent = 1 WHERE sent_at IS NOT NULL");
}

async function ensureReferenceData() {
  const mccRows = [
    ["4511", null, "Airlines / travel", 15],
    ["4722", null, "Travel agencies / tourism", 15],
    ["4789", null, "Transportation / travel services", 15],
    ["4812", null, "Financial / telecom payment services", 15],
    ["4829", null, "Money transfer / remittance", 15],
    ["5311", null, "Retail / department stores", 5],
    ["5411", null, "Grocery stores", 5],
    ["5541", null, "Retail / service stations", 5],
    ["5611", null, "Retail / apparel", 5],
    ["5621", null, "Retail / apparel", 5],
    ["5631", null, "Retail / accessories", 5],
    ["5641", null, "Retail / children clothing", 5],
    ["5651", null, "Retail / clothing", 5],
    ["5661", null, "Retail / shoes", 5],
    ["5691", null, "Retail / clothing", 5],
    ["5712", null, "Retail / furniture", 5],
    ["5732", null, "Electronics", 10],
    ["5812", null, "Restaurants", 5],
    ["5813", null, "Bars / food and beverage", 5],
    ["5814", null, "Fast food", 5],
    ["5942", null, "Retail / bookstores", 5],
    ["5964", null, "Retail / direct marketing", 5],
    ["5999", null, "Miscellaneous retail", 5],
    ["6012", null, "Financial institutions", 15],
    ["6051", null, "Money services / money orders", 15],
    ["7011", null, "Hotel / lodging", 15],
    ["7512", null, "Vehicle rental / travel", 15],
    ["7995", null, "Gambling / betting", 15],
    [null, "food", "Food and beverage", 5],
    [null, "restaurant", "Food and beverage", 5],
    [null, "dining", "Food and beverage", 5],
    [null, "retail", "Retail", 5],
    [null, "electronic", "Electronics", 10],
    [null, "travel", "Travel / tourism", 15],
    [null, "hotel", "Hotel / lodging", 15],
    [null, "remittance", "Money transfer / remittance", 15],
    [null, "financial", "Financial services", 15],
    [null, "gambling", "Gambling / betting", 15],
  ];

  for (const [mccCode, categoryKeyword, categoryName, points] of mccRows) {
    await query(
      `
        INSERT INTO merchant_category_risk
          (mcc_code, category_keyword, category_name, points, is_active)
        VALUES (?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          category_name = VALUES(category_name),
          points = VALUES(points),
          updated_at = NOW()
      `,
      [mccCode, categoryKeyword, categoryName, points]
    );
  }
}

async function ensureDefaultRules(createdBy = null) {
  let authorId = createdBy;

  if (!authorId) {
    const authors = await query("SELECT user_id FROM users ORDER BY user_id ASC LIMIT 1");
    authorId = authors[0]?.user_id || null;
  }

  const currentRules = [
    {
      rule_name: "Merchant MCC or industry risk",
      rule_type: "merchant_profile",
      description: "Adds a supporting risk score from the merchant_category_risk database table.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 15,
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
      description: "Flags repeated transactions below the configured amount using the same payment identifier.",
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
      rule_name: "Repeated failed or cancelled transactions",
      rule_type: "cancellation_velocity",
      description: "Flags repeated failed, cancelled, or voided attempts for the same payment identifier.",
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
      description: "Flags a successful transaction following several recent failed attempts using the same payment identifier.",
      threshold_value: null,
      threshold_count: 3,
      time_window_minutes: 10,
      time_window_seconds: 600,
      points: 30,
      is_active: 1,
    },
    {
      rule_name: "Possible duplicate or replayed payment",
      rule_type: "duplicate_transaction",
      description: "Flags a new transaction that repeats the same merchant, amount, and payment identifier within a short time window.",
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
      description: "Adds supporting risk points when the customer profile is marked high risk.",
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
      description: "Flags transactions missing masked card, payment reference, terminal ID, and gateway reference.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 10,
      is_active: 1,
    },
    {
      rule_name: "Online transaction with missing or invalid IP",
      rule_type: "ip_validation",
      description: "Flags online transactions where the IP address is missing or invalid.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 10,
      is_active: 1,
    },
    {
      rule_name: "High-risk jurisdiction",
      rule_type: "high_risk_jurisdiction",
      description: "Checks the transaction country against the high_risk_jurisdictions table. Activate only after an approved list is configured.",
      threshold_value: null,
      threshold_count: null,
      time_window_minutes: null,
      time_window_seconds: null,
      points: 25,
      is_active: 0,
    },
    {
      rule_name: "IP country mismatch",
      rule_type: "ip_country_mismatch",
      description: "Flags online transactions when the submitted country differs from the recorded IP-derived country.",
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

    if (existing.length > 0) continue;

    await query(
      `
        INSERT INTO compliance_rules
          (
            rule_name,
            rule_type,
            description,
            threshold_value,
            threshold_count,
            time_window_minutes,
            time_window_seconds,
            points,
            is_active,
            created_by,
            updated_by
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

module.exports = {
  ensureComplianceSchema,
  ensureDefaultRules,
  ensureReferenceData,
};
