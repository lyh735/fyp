const { query } = require("./dbQuery");

async function ensureComplianceSchema() {
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
      country VARCHAR(50) DEFAULT 'Singapore',
      status VARCHAR(30),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      masked_wallet_ref VARCHAR(100),
      masked_payment_ref VARCHAR(100),
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
      triggered_rules TEXT,
      processing_status VARCHAR(50),
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
      triggered_rules TEXT,
      status VARCHAR(30) DEFAULT 'open',
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by INT,
      read_at DATETIME,
      FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
      FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id),
      FOREIGN KEY (reviewed_by) REFERENCES users(user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS officer_actions (
      action_id INT AUTO_INCREMENT PRIMARY KEY,
      alert_id INT NOT NULL,
      officer_id INT NOT NULL,
      action_type VARCHAR(50),
      remarks TEXT,
      action_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alert_id) REFERENCES alerts(alert_id),
      FOREIGN KEY (officer_id) REFERENCES users(user_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      audit_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      event_type VARCHAR(100),
      table_name VARCHAR(100),
      record_id VARCHAR(100),
      old_value TEXT,
      new_value TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  const rules = await query("SELECT COUNT(*) AS count FROM compliance_rules");
  if (rules[0].count === 0) {
    await query(`
      INSERT INTO compliance_rules
        (
          rule_name, rule_type, description, threshold_value, threshold_count,
          time_window_minutes, points, is_active
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
          1
        ),
        (
          'Repeated transactions within short period',
          'velocity',
          'Flags merchants with five or more transactions within ten minutes.',
          NULL,
          5,
          10,
          25,
          1
        ),
        (
          'Transaction outside operating hours',
          'time',
          'Flags transactions made from 11 PM to before 6 AM.',
          NULL,
          NULL,
          NULL,
          15,
          1
        ),
        (
          'High-risk customer profile',
          'customer_risk',
          'Adds risk points when the customer profile is marked high risk.',
          NULL,
          NULL,
          NULL,
          25,
          1
        ),
        (
          'High-risk country/jurisdiction',
          'jurisdiction',
          'Flags transactions from configured high-risk countries or jurisdictions.',
          NULL,
          NULL,
          NULL,
          30,
          1
        ),
        (
          'Missing or insufficient information',
          'data_quality',
          'Flags transactions where important information such as country was missing or defaulted.',
          NULL,
          NULL,
          NULL,
          20,
          1
        ),
        (
          'Online transaction with missing/invalid IP',
          'ip_validation',
          'Flags online transactions without a valid IP address.',
          NULL,
          NULL,
          NULL,
          20,
          1
        ),
        (
          'Large cross-border transfer amount if country is not Singapore',
          'cross_border',
          'Flags SGD transactions above 1500 when the transaction country is not Singapore.',
          1500.00,
          NULL,
          NULL,
          25,
          1
        )
    `);
  }
}

module.exports = { ensureComplianceSchema };
