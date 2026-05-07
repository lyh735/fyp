-- ============================================================
-- Compliance Monitoring System — Full Setup
-- Includes: database, tables, and all existing data
-- Run this entire file in MySQL Workbench (Ctrl+Shift+Enter)
-- ============================================================

CREATE DATABASE IF NOT EXISTS transaction_monitoring;
USE transaction_monitoring;

-- ── Alerts ────────────────────────────────────────────────────
DROP TABLE IF EXISTS alerts;
CREATE TABLE alerts (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id VARCHAR(100),
    message        TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Transactions ──────────────────────────────────────────────
DROP TABLE IF EXISTS transactions;
CREATE TABLE transactions (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id VARCHAR(100),
    user_id        VARCHAR(100),
    merchant_name  VARCHAR(150),
    payment_method VARCHAR(50),
    amount         DECIMAL(10,2),
    country        VARCHAR(100),
    txn_time       DATETIME,
    risk_score     INT,
    status         VARCHAR(50)
);

-- ── Users ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)         NOT NULL,
    dob         DATE                 NOT NULL,
    email       VARCHAR(100) UNIQUE  NOT NULL,
    password    VARCHAR(255)         NOT NULL,
    role        ENUM('admin','user') DEFAULT 'user',
    first_login TINYINT(1)           DEFAULT 1,
    created_at  DATETIME             DEFAULT CURRENT_TIMESTAMP
);

-- ── Data: Users ───────────────────────────────────────────────
INSERT INTO users (id, name, dob, email, password, role, first_login, created_at) VALUES
(1, 'Alan Tan',  '2006-02-02', 'admin@gmail.com',  '$2b$10$HMK8tqiG/TYUsAYEElZ7FOW47cxalsbTyg6lwKOlInmLf63hMAtKm', 'admin', 0, '2026-05-07 19:11:36'),
(3, 'user1',     '2007-03-02', 'user1@gmail.com',  '$2b$10$p2oFMkZ.S48H3sPiP.Yk9.Scwz9O8yLeYNLkqV57ykUeJ70u1rMtO', 'user',  0, '2026-05-07 19:37:03');
