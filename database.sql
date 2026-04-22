CREATE DATABASE transaction_monitoring;
USE transaction_monitoring;

CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id VARCHAR(100),
    user_id VARCHAR(100),
    amount DECIMAL(10,2),
    country VARCHAR(100),
    txn_time DATETIME,
    risk_score INT,
    status VARCHAR(50)
);

CREATE TABLE alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id VARCHAR(100),
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);