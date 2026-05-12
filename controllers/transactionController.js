const db = require("../config/db");
const { query } = require("../services/dbQuery");
const { evaluateTransaction } = require("../services/riskEngine");
const { generateTransaction } = require("../services/simulator");
const { validateTransaction } = require("../services/validation");

async function logAudit(eventType, txn, message) {
  await query(
    `
      INSERT INTO audit_logs (event_type, transaction_id, merchant_id, message)
      VALUES (?, ?, ?, ?)
    `,
    [eventType, txn?.transaction_id || null, txn?.merchant_id || null, message]
  );
}

function createAlertId(transactionId) {
  return `ALT-${transactionId}-${Date.now()}`;
}

async function getRecentMerchantTransactionCount(merchantId, timestamp) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE merchant_id = ?
        AND COALESCE(\`timestamp\`, txn_time) >= DATE_SUB(?, INTERVAL 10 MINUTE)
        AND COALESCE(\`timestamp\`, txn_time) <= ?
    `,
    [merchantId, timestamp, timestamp]
  );

  return rows[0].count;
}

async function processTransaction(payload, req) {
  await logAudit("transaction_received", payload, "Transaction received");

  const validation = validateTransaction(payload);
  if (!validation.isValid) {
    await logAudit(
      "validation_failed",
      payload,
      `Validation failed: ${validation.errors.join("; ")}`
    );
    return { validation };
  }

  const txn = validation.transaction;
  const recentMerchantTransactionCount = await getRecentMerchantTransactionCount(
    txn.merchant_id,
    txn.timestamp
  );

  const result = evaluateTransaction(txn, {
    recentMerchantTransactionCount,
    countryWasDefaulted: validation.metadata.countryWasDefaulted,
  });

  await logAudit(
    "rules_triggered",
    txn,
    result.triggered_rules.length
      ? `Rules triggered: ${result.triggered_rules.join("; ")}`
      : "No rules triggered"
  );

  await logAudit(
    "risk_score_calculated",
    txn,
    `Risk score calculated: ${result.risk_score} (${result.risk_level})`
  );

  await query(
    `
      INSERT INTO transactions
        (
          transaction_id, user_id, merchant_name, payment_method,
          merchant_id, amount, currency, transaction_type, ip_address, country,
          txn_time, \`timestamp\`, status, customer_risk_profile,
          merchant_average_amount, risk_score, risk_level, triggered_rules
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      txn.transaction_id,
      payload.user_id || null,
      payload.merchant_name || txn.merchant_id,
      payload.payment_method || null,
      txn.merchant_id,
      txn.amount,
      txn.currency,
      txn.transaction_type,
      txn.ip_address,
      txn.country,
      txn.timestamp,
      txn.timestamp,
      result.status,
      txn.customer_risk_profile,
      txn.merchant_average_amount,
      result.risk_score,
      result.risk_level,
      JSON.stringify(result.triggered_rules),
    ]
  );

  if (result.alert_required) {
    const alertId = createAlertId(txn.transaction_id);

    await query(
      `
        INSERT INTO alerts
          (
            alert_id, transaction_id, merchant_id, risk_score, risk_level,
            triggered_rules, status, message
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        alertId,
        txn.transaction_id,
        txn.merchant_id,
        result.risk_score,
        result.risk_level,
        JSON.stringify(result.triggered_rules),
        "Pending Review",
        result.triggered_rules.join(", "),
      ]
    );

    await logAudit("alert_generated", txn, `Alert generated: ${alertId}`);

    const io = req.app.get("io");
    io.emit("newAlert", {
      alert_id: alertId,
      transaction_id: txn.transaction_id,
      merchant_id: txn.merchant_id,
      ...result,
    });
  }

  return { txn, result, validation };
}

function buildApiResponse(txn, result) {
  return {
    transaction_id: txn.transaction_id,
    merchant_id: txn.merchant_id,
    risk_score: result.risk_score,
    risk_level: result.risk_level,
    triggered_rules: result.triggered_rules,
    alert_required: result.alert_required,
    alert_status: result.alert_status,
  };
}

exports.createTransaction = async (req, res) => {
  try {
    const processed = await processTransaction(req.body, req);

    if (!processed.validation.isValid) {
      return res.status(400).json({
        message: "Validation failed",
        errors: processed.validation.errors,
      });
    }

    res.json(buildApiResponse(processed.txn, processed.result));
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.simulate = async (req, res) => {
  try {
    const generated = generateTransaction();
    const txn = {
      ...generated,
      merchant_id: generated.merchant_name,
      currency: "SGD",
      transaction_type: "face_to_face",
      timestamp: generated.txn_time,
      customer_risk_profile: generated.amount > 3000 ? "high" : "low",
      merchant_average_amount: generated.amount > 3000 ? 800 : Math.max(generated.amount, 25),
    };

    const processed = await processTransaction(txn, req);
    if (!processed.validation.isValid) {
      return res.status(400).json({
        message: "Generated transaction failed validation",
        errors: processed.validation.errors,
      });
    }

    res.json({ transaction: { ...processed.txn, ...processed.result } });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.getTransactions = (req, res) => {
  db.query(
    "SELECT * FROM transactions ORDER BY COALESCE(`timestamp`, txn_time, created_at) DESC LIMIT 500",
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
