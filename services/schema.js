const { query } = require("./dbQuery");

async function columnExists(tableName, columnName) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );

  return rows[0].count > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
  if (!(await columnExists(tableName, columnName))) {
    await query(`ALTER TABLE ${tableName} ADD COLUMN \`${columnName}\` ${definition}`);
  }
}

async function ensureComplianceSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      transaction_id VARCHAR(100),
      user_id VARCHAR(100),
      merchant_name VARCHAR(150),
      payment_method VARCHAR(50),
      amount DECIMAL(10,2),
      country VARCHAR(100),
      txn_time DATETIME,
      risk_score INT,
      status VARCHAR(50)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      transaction_id VARCHAR(100),
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      transaction_id VARCHAR(100),
      merchant_id VARCHAR(100),
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const transactionColumns = [
    ["merchant_id", "VARCHAR(100)"],
    ["currency", "VARCHAR(10)"],
    ["transaction_type", "VARCHAR(50)"],
    ["ip_address", "VARCHAR(100)"],
    ["timestamp", "DATETIME"],
    ["customer_risk_profile", "VARCHAR(20)"],
    ["merchant_average_amount", "DECIMAL(10,2)"],
    ["risk_level", "VARCHAR(20)"],
    ["triggered_rules", "TEXT"],
    ["processing_status", "VARCHAR(50)"],
    ["created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"],
  ];

  for (const [name, definition] of transactionColumns) {
    await addColumnIfMissing("transactions", name, definition);
  }

  const alertColumns = [
    ["alert_id", "VARCHAR(100)"],
    ["merchant_id", "VARCHAR(100)"],
    ["risk_score", "INT"],
    ["risk_level", "VARCHAR(20)"],
    ["triggered_rules", "TEXT"],
    ["status", "VARCHAR(50) DEFAULT 'Pending'"],
    ["reviewed_by", "VARCHAR(100)"],
    ["reviewed_at", "DATETIME NULL"],
    ["review_notes", "TEXT"],
    ["escalation_report", "TEXT"],
  ];

  for (const [name, definition] of alertColumns) {
    await addColumnIfMissing("alerts", name, definition);
  }
}

module.exports = { ensureComplianceSchema };
