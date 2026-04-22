const db = require("../config/db");
const { evaluateTransaction } = require("../services/riskEngine");

exports.createTransaction = (req, res) => {
  const txn = req.body;

  const result = evaluateTransaction(txn);

  const sql = `
    INSERT INTO transactions 
    (transaction_id, user_id, amount, country, txn_time, risk_score, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    txn.transaction_id,
    txn.user_id,
    txn.amount,
    txn.country,
    txn.txn_time,
    result.risk_score,
    result.status
  ];

  db.query(sql, values, (err) => {
    if (err) return res.status(500).json(err);

    // send real-time alert
    if (result.status !== "normal") {
      const io = req.app.get("io");
      io.emit("newAlert", {
        transaction_id: txn.transaction_id,
        ...result
      });

      db.query(
        "INSERT INTO alerts (transaction_id, message) VALUES (?, ?)",
        [txn.transaction_id, result.reasons.join(", ")]
      );
    }

    res.json({
      message: "Transaction processed",
      result
    });
  });
};