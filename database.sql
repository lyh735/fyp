-- ============================================================
-- Compliance Monitoring System - Non-destructive MySQL setup
-- Run this file in MySQL Workbench if the database needs setup.
-- It creates missing tables and columns without dropping data.
-- ============================================================

CREATE DATABASE IF NOT EXISTS transaction_monitoring;
USE transaction_monitoring;

CREATE TABLE IF NOT EXISTS users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)         NOT NULL,
    dob         DATE                 NOT NULL,
    email       VARCHAR(100) UNIQUE  NOT NULL,
    password    VARCHAR(255)         NOT NULL,
    role        ENUM('admin','user') DEFAULT 'user',
    first_login TINYINT(1)           DEFAULT 1,
    created_at  DATETIME             DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO users (id, name, dob, email, password, role, first_login, created_at) VALUES
(1, 'Alan Tan', '2006-02-02', 'admin@gmail.com', '$2b$10$HMK8tqiG/TYUsAYEElZ7FOW47cxalsbTyg6lwKOlInmLf63hMAtKm', 'admin', 0, '2026-05-07 19:11:36'),
(3, 'user1', '2007-03-02', 'user1@gmail.com', '$2b$10$p2oFMkZ.S48H3sPiP.Yk9.Scwz9O8yLeYNLkqV57ykUeJ70u1rMtO', 'user', 0, '2026-05-07 19:37:03');

CREATE TABLE IF NOT EXISTS transactions (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id          VARCHAR(100),
    user_id                 VARCHAR(100),
    merchant_name           VARCHAR(150),
    payment_method          VARCHAR(50),
    merchant_id             VARCHAR(100),
    amount                  DECIMAL(10,2),
    currency                VARCHAR(10),
    transaction_type        VARCHAR(50),
    ip_address              VARCHAR(100),
    country                 VARCHAR(100),
    txn_time                DATETIME,
    `timestamp`             DATETIME,
    status                  VARCHAR(50),
    customer_risk_profile   VARCHAR(20),
    merchant_average_amount DECIMAL(10,2),
    risk_score              INT,
    risk_level              VARCHAR(20),
    triggered_rules         TEXT,
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    alert_id        VARCHAR(100),
    transaction_id  VARCHAR(100),
    merchant_id     VARCHAR(100),
    risk_score      INT,
    risk_level      VARCHAR(20),
    triggered_rules TEXT,
    status          VARCHAR(50) DEFAULT 'Pending Review',
    message         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at     DATETIME NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    event_type     VARCHAR(100) NOT NULL,
    transaction_id VARCHAR(100),
    merchant_id    VARCHAR(100),
    message        TEXT NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE alerts (
  alert_id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT,
  risk_level VARCHAR(20),
  status VARCHAR(30) DEFAULT 'Pending',
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE officer_actions (
  action_id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT,
  officer_name VARCHAR(100),
  action_type VARCHAR(30),
  remarks TEXT,
  action_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  officer_name VARCHAR(100),
  action VARCHAR(100),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add missing columns to older prototype tables without deleting data.
DROP PROCEDURE IF EXISTS add_column_if_missing;

DELIMITER //

CREATE PROCEDURE add_column_if_missing(
    IN target_table VARCHAR(64),
    IN target_column VARCHAR(64),
    IN column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = target_table
          AND COLUMN_NAME = target_column
    ) THEN
        SET @ddl = CONCAT(
            'ALTER TABLE `', target_table, '` ADD COLUMN `',
            target_column, '` ', column_definition
        );
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END//

DELIMITER ;

CALL add_column_if_missing('transactions', 'merchant_id', 'VARCHAR(100)');
CALL add_column_if_missing('transactions', 'currency', 'VARCHAR(10)');
CALL add_column_if_missing('transactions', 'transaction_type', 'VARCHAR(50)');
CALL add_column_if_missing('transactions', 'ip_address', 'VARCHAR(100)');
CALL add_column_if_missing('transactions', 'timestamp', 'DATETIME');
CALL add_column_if_missing('transactions', 'customer_risk_profile', 'VARCHAR(20)');
CALL add_column_if_missing('transactions', 'merchant_average_amount', 'DECIMAL(10,2)');
CALL add_column_if_missing('transactions', 'risk_level', 'VARCHAR(20)');
CALL add_column_if_missing('transactions', 'triggered_rules', 'TEXT');
CALL add_column_if_missing('transactions', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

CALL add_column_if_missing('alerts', 'alert_id', 'VARCHAR(100)');
CALL add_column_if_missing('alerts', 'merchant_id', 'VARCHAR(100)');
CALL add_column_if_missing('alerts', 'risk_score', 'INT');
CALL add_column_if_missing('alerts', 'risk_level', 'VARCHAR(20)');
CALL add_column_if_missing('alerts', 'triggered_rules', 'TEXT');
CALL add_column_if_missing('alerts', 'status', 'VARCHAR(50) DEFAULT ''Pending Review''');
CALL add_column_if_missing('alerts', 'reviewed_at', 'DATETIME NULL');

DROP PROCEDURE add_column_if_missing;


