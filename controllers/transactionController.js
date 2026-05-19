const db = require("../config/db");
const { query } = require("../services/dbQuery");
const { evaluateTransaction } = require("../services/riskEngine");
const { generateTransaction } = require("../services/simulator");
const { validateTransaction } = require("../services/validation");

async function withRetries(operation, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  throw lastError;
}

async function logAudit(eventType, txn, message) {
  try {
    await withRetries(() => query(
      `
        INSERT INTO audit_logs (event_type, transaction_id, merchant_id, message)
        VALUES (?, ?, ?, ?)
      `,
      [eventType, txn?.transaction_id || null, txn?.merchant_id || null, message]
    ));
  } catch (err) {
    console.error("CRITICAL: Failed to write audit log:", err.message || err);
  }
}

async function logCritical(txn, message) {
  console.error("CRITICAL:", message);
  await logAudit("critical_error", txn, message);
}

function createAlertId(transactionId) {
  return `ALT-${transactionId}-${Date.now()}`;
}

async function getPersistedTransactionRisk(transactionId, txn) {
  const rows = await query(
    `
      SELECT risk_score, risk_level
      FROM transactions
      WHERE transaction_id = ?
      LIMIT 1
    `,
    [transactionId]
  );

  if (!rows.length || rows[0].risk_score == null || rows[0].risk_level == null) {
    await logCritical(txn, "Risk Score not loaded. Please try again.");
    throw new Error("Risk Score not loaded. Please try again.");
  }

  return rows[0];
}

async function createAlertRecord(txn, result) {
  const alertId = createAlertId(txn.transaction_id);
  await withRetries(() => query(
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
      "Pending",
      result.triggered_rules.join(", "),
    ]
  ));

  return alertId;
}

async function getAlertById(alertId) {
  const rows = await query(
    `
      SELECT a.*, t.merchant_name, t.payment_method, t.amount, t.currency,
             t.transaction_type, t.ip_address, t.country, t.customer_risk_profile,
             t.merchant_average_amount, t.txn_time AS transaction_time
      FROM alerts a
      LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
      WHERE a.alert_id = ?
      LIMIT 1
    `,
    [alertId]
  );
  return rows[0] || null;
}

async function updateAlertStatus(alertId, status, userId, report = null) {
  const updates = ["status = ?", "reviewed_by = ?", "reviewed_at = NOW()"];
  const values = [status, userId];
  if (report !== null) {
    updates.push("escalation_report = ?");
    values.push(report);
  }
  values.push(alertId);

  await query(
    `
      UPDATE alerts
      SET ${updates.join(", ")}
      WHERE alert_id = ?
    `,
    values
  );
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
          merchant_average_amount, risk_score, risk_level, triggered_rules,
          processing_status
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      "Processing",
    ]
  );

  const persistedRisk = await getPersistedTransactionRisk(txn.transaction_id, txn);
  const shouldGenerateAlert = persistedRisk.risk_level === "Medium" || persistedRisk.risk_level === "High";
  let alertId = null;

  if (shouldGenerateAlert) {
    try {
      alertId = await createAlertRecord(txn, result);
      await logAudit("alert_generated", txn, `Alert generated: ${alertId}`);

      const io = req.app.get("io");
      io.emit("newAlert", {
        alert_id: alertId,
        transaction_id: txn.transaction_id,
        merchant_id: txn.merchant_id,
        ...result,
      });
    } catch (err) {
      await logCritical(txn, "Failed to generate alert");
    }
  }

  await logAudit(
    "transaction_processed",
    txn,
    `Transaction processed: ${persistedRisk.risk_level} risk, alert ${alertId ? `created (${alertId})` : "skipped"}`
  );

  await query(
    `
      UPDATE transactions
      SET processing_status = 'Complete'
      WHERE transaction_id = ?
    `,
    [txn.transaction_id]
  );

  result.processing_status = "Complete";
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
    processing_status: result.processing_status,
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

exports.getAlerts = async (req, res) => {
  const status = req.query.status || "Pending";
  const orderByRisk = "FIELD(risk_level, 'High', 'Medium', 'Low'), created_at DESC";
  const sql = status === "all"
    ? `SELECT * FROM alerts ORDER BY ${orderByRisk} LIMIT 200`
    : `SELECT * FROM alerts WHERE status = ? ORDER BY ${orderByRisk} LIMIT 200`;
  const values = status === "all" ? [] : [status];

  try {
    const results = await query(sql, values);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAlert = async (req, res) => {
  try {
    const alert = await getAlertById(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.dismissAlert = async (req, res) => {
  try {
    const alert = await getAlertById(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    if (alert.status !== "Pending") {
      return res.status(400).json({ message: "Only pending alerts can be dismissed" });
    }

    await updateAlertStatus(req.params.id, "Dismissed", req.user.id);
    await logAudit("alert_dismissed", alert, `Alert dismissed by user ${req.user.id}`);

    res.json({ message: "Alert successfully dismissed" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

function formatEscalationReport(alert) {
  let triggeredRules = alert.triggered_rules;
  try {
    const parsed = JSON.parse(alert.triggered_rules);
    if (Array.isArray(parsed)) triggeredRules = parsed.join("; ");
  } catch {}

  return `Escalation report for ${alert.transaction_id}: merchant=${alert.merchant_name || "N/A"}, amount=${alert.amount || "N/A"}, currency=${alert.currency || "N/A"}, risk_level=${alert.risk_level}, triggered_rules=${triggeredRules}`;
}

exports.escalateAlert = async (req, res) => {
  try {
    const alert = await getAlertById(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    if (alert.status !== "Pending") {
      return res.status(400).json({ message: "Only pending alerts can be escalated" });
    }

    const report = formatEscalationReport(alert);
    await updateAlertStatus(req.params.id, "Escalated", req.user.id, report);
    await logAudit("alert_escalated", alert, `Alert escalated by user ${req.user.id}`);
    await logAudit("escalation_report", alert, report);

    res.json({ message: "Alert successfully escalated", escalation_report: report });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
