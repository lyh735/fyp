const db = require("../config/db");
const { evaluateTransaction } = require("../services/riskEngine");
const { generateTransaction }  = require("../services/simulator");

exports.createTransaction = (req, res) => {
  const txn = req.body;
  const result = evaluateTransaction(txn);

  const sql = `
    INSERT INTO transactions
      (transaction_id, user_id, merchant_name, payment_method, amount, country, txn_time, risk_score, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    txn.transaction_id, txn.user_id, txn.merchant_name || null,
    txn.payment_method || null, txn.amount, txn.country,
    txn.txn_time, result.risk_score, result.status
  ];

  db.query(sql, values, (err) => {
    if (err) return res.status(500).json(err);

    if (result.status !== "normal") {
      const io = req.app.get("io");
      io.emit("newAlert", { transaction_id: txn.transaction_id, ...result });
      db.query(
        "INSERT INTO alerts (transaction_id, message) VALUES (?, ?)",
        [txn.transaction_id, result.reasons.join(", ")]
      );
    }

    res.json({ message: "Transaction processed", result });
  });
};

exports.simulate = (req, res) => {
  const txn    = generateTransaction();
  const result = evaluateTransaction(txn);

  const sql = `
    INSERT INTO transactions
      (transaction_id, user_id, merchant_name, payment_method, amount, country, txn_time, risk_score, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    txn.transaction_id, txn.user_id, txn.merchant_name,
    txn.payment_method, txn.amount, txn.country,
    txn.txn_time, result.risk_score, result.status
  ];

  db.query(sql, values, (err) => {
    if (err) return res.status(500).json({ message: "Server error", error: err.message });

    if (result.status !== "normal") {
      const io = req.app.get("io");
      io.emit("newAlert", { transaction_id: txn.transaction_id, ...result });
      db.query(
        "INSERT INTO alerts (transaction_id, message) VALUES (?, ?)",
        [txn.transaction_id, result.reasons.join(", ")]
      );
    }

    res.json({ transaction: { ...txn, ...result } });
  });
};

exports.getTransactions = (req, res) => {
  db.query(
    "SELECT * FROM transactions ORDER BY txn_time DESC LIMIT 500",
    (err, results) => {
      if (err) return res.status(500).json({ message: "Server error" });
      res.json(results);
    }
  );
};

exports.getAlerts = (req, res) => {
  db.query(
    "SELECT * FROM alerts ORDER BY created_at DESC LIMIT 200",
    (err, results) => {
      if (err) return res.status(500).json({ message: "Server error" });
      res.json(results);
    }
  );
};
