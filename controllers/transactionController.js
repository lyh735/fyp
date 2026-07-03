const db = require("../config/db");
const { query } = require("../services/dbQuery");
const { evaluateTransaction } = require("../services/riskEngine");
const { generateTransaction } = require("../services/simulator");
const { validateTransaction } = require("../services/validation");
const { ensureDefaultRules } = require("../services/schema");

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
  console.info(`[${eventType}]`, txn?.alert_id || txn?.transaction_id || "system", message);
}

async function logCritical(txn, message) {
  console.error("CRITICAL:", message);
  await logAudit("critical_error", txn, message);
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

async function getMerchantProfile(merchantId) {
  if (!merchantId) return null;

  const rows = await query(
    `
      SELECT *
      FROM merchants
      WHERE merchant_id = ?
      LIMIT 1
    `,
    [merchantId]
  );

  return rows[0] || null;
}

async function ensureMerchantRecord(txn, payload = {}, userId) {
  const merchantName = payload.merchant_name || txn.merchant_name || txn.merchant_id;

  await query(
    `
      INSERT INTO merchants
        (
          merchant_id, merchant_name, business_category, mcc_code,
          merchant_average_amount, operating_hours_start, operating_hours_end,
          risk_level, merchant_risk_score, country, has_physical_location,
          status, created_by, updated_by
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        merchant_name = VALUES(merchant_name),
        business_category = COALESCE(VALUES(business_category), business_category),
        mcc_code = COALESCE(VALUES(mcc_code), mcc_code),
        merchant_average_amount = COALESCE(VALUES(merchant_average_amount), merchant_average_amount),
        operating_hours_start = COALESCE(VALUES(operating_hours_start), operating_hours_start),
        operating_hours_end = COALESCE(VALUES(operating_hours_end), operating_hours_end),
        risk_level = COALESCE(VALUES(risk_level), risk_level),
        merchant_risk_score = COALESCE(VALUES(merchant_risk_score), merchant_risk_score),
        country = COALESCE(VALUES(country), country),
        has_physical_location = VALUES(has_physical_location),
        status = VALUES(status),
        updated_by = VALUES(updated_by),
        updated_at = NOW()
    `,
    [
      txn.merchant_id,
      merchantName,
      txn.business_category || payload.business_category || null,
      txn.mcc_code || payload.mcc_code || null,
      txn.merchant_average_amount || payload.merchant_average_amount || null,
      payload.operating_hours_start || null,
      payload.operating_hours_end || null,
      payload.merchant_risk_level || txn.customer_risk_profile || null,
      txn.merchant_risk_score_provided ? txn.merchant_risk_score : null,
      payload.merchant_country || txn.country || "Singapore",
      txn.has_physical_location,
      "active",
      userId,
      userId,
    ]
  );
}

async function createAlertRecord(txn, result) {
  const priority =
    result.risk_level === "Critical"
      ? "Critical"
      : result.risk_level === "High"
        ? "High"
        : "Medium";

  const insertResult = await withRetries(() =>
    query(
      `
        INSERT INTO alerts
          (
            transaction_id, merchant_id, risk_score, risk_level,
            triggered_rules, status, priority, message
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        txn.transaction_id,
        txn.merchant_id,
        result.risk_score,
        result.risk_level,
        JSON.stringify(result.triggered_rules),
        "Pending",
        priority,
        result.triggered_rules.join(", "),
      ]
    )
  );

  return insertResult.insertId;
}

async function getAlertById(alertId) {
  const rows = await query(
    `
      SELECT a.*, a.alert_id AS id, m.merchant_name,
             t.payment_method, t.amount, t.currency,
             t.transaction_type, t.ip_address, t.country, NULL AS customer_risk_profile,
             m.merchant_average_amount, m.risk_level AS merchant_risk_level,
             m.mcc_code, m.merchant_risk_score, m.has_physical_location,
             t.source_type, t.txn_time AS transaction_time,
             u.name AS officer_name, NULL AS escalation_report
      FROM alerts a
      LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
      LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
      LEFT JOIN users u ON a.reviewed_by = u.user_id
      WHERE a.alert_id = ?
      LIMIT 1
    `,
    [alertId]
  );

  return rows[0] || null;
}

async function updateAlertStatus(alertId, status, userId, report = null, actionType = null) {
  await query(
    `
      UPDATE alerts
      SET status = ?, reviewed_by = ?, reviewed_at = NOW(),
          escalated_at = CASE WHEN ? IN ('Escalated', 'Escalated to STRO') THEN NOW() ELSE escalated_at END
      WHERE alert_id = ?
    `,
    [status, userId, status, alertId]
  );

  if (actionType) {
    await query(
      `
        INSERT INTO case_actions
          (alert_id, user_id, action_type, status_after_action, remarks)
        VALUES (?, ?, ?, ?, ?)
      `,
      [alertId, userId, actionType, status, report]
    );
  }

  if (report) {
    await logAudit("escalation_report", { alert_id: alertId }, report);
  }
}

async function getVelocity30SecCount(txn) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= DATE_SUB(?, INTERVAL 30 SECOND)
        AND txn_time <= ?
        AND (
          merchant_id = ?
          OR (? IS NOT NULL AND ? <> '' AND masked_card_number = ?)
          OR (? IS NOT NULL AND ? <> '' AND terminal_id = ?)
        )
    `,
    [
      txn.timestamp,
      txn.timestamp,
      txn.merchant_id,
      txn.masked_card_number || "",
      txn.masked_card_number || "",
      txn.masked_card_number || "",
      txn.terminal_id || "",
      txn.terminal_id || "",
      txn.terminal_id || "",
    ]
  );

  return Number(rows[0]?.count || 0) + 1;
}

async function getSmallTxn5MinCount(txn) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= DATE_SUB(?, INTERVAL 5 MINUTE)
        AND txn_time <= ?
        AND amount < 10
        AND (
          merchant_id = ?
          OR (? IS NOT NULL AND ? <> '' AND masked_card_number = ?)
        )
    `,
    [
      txn.timestamp,
      txn.timestamp,
      txn.merchant_id,
      txn.masked_card_number || "",
      txn.masked_card_number || "",
      txn.masked_card_number || "",
    ]
  );

  return Number(rows[0]?.count || 0) + (Number(txn.amount) < 10 ? 1 : 0);
}

async function getLargeTxn30MinCount(txn, merchant) {
  const merchantAverage =
    Number(merchant?.merchant_average_amount) ||
    Number(txn.merchant_average_amount) ||
    0;

  if (merchantAverage <= 0) return 0;
  const largeAmountThreshold = merchantAverage * 3;

  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE merchant_id = ?
        AND txn_time >= DATE_SUB(?, INTERVAL 30 MINUTE)
        AND txn_time <= ?
        AND amount > ?
    `,
    [
      txn.merchant_id,
      txn.timestamp,
      txn.timestamp,
      largeAmountThreshold,
    ]
  );

  return Number(rows[0]?.count || 0) + (Number(txn.amount) > largeAmountThreshold ? 1 : 0);
}

async function getCancelledTxn10MinCount(txn) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= DATE_SUB(?, INTERVAL 10 MINUTE)
        AND txn_time <= ?
        AND LOWER(transaction_status) IN ('cancelled', 'canceled', 'failed', 'voided')
        AND (
          merchant_id = ?
          OR (? IS NOT NULL AND ? <> '' AND masked_card_number = ?)
        )
    `,
    [
      txn.timestamp,
      txn.timestamp,
      txn.merchant_id,
      txn.masked_card_number || "",
      txn.masked_card_number || "",
      txn.masked_card_number || "",
    ]
  );

  const currentStatus = String(txn.status || "").toLowerCase();
  const currentIsCancelled = ["cancelled", "canceled", "failed", "voided"].includes(currentStatus);
  return Number(rows[0]?.count || 0) + (currentIsCancelled ? 1 : 0);
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

  await ensureMerchantRecord(txn, payload, req.user.id);

  const merchant = await getMerchantProfile(txn.merchant_id);

  const velocity30SecCount = await getVelocity30SecCount(txn);
  const smallTxn5MinCount = await getSmallTxn5MinCount(txn);
  const largeTxn30MinCount = await getLargeTxn30MinCount(txn, merchant);
  const cancelledTxn10MinCount = await getCancelledTxn10MinCount(txn);

  const result = evaluateTransaction(txn, {
    merchant,
    velocity30SecCount,
    smallTxn5MinCount,
    largeTxn30MinCount,
    cancelledTxn10MinCount,
    missingRequiredInfo: validation.metadata.missingRequiredInfo,
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
          transaction_id, merchant_id, masked_payment_ref,
          card_bin, masked_card_number, card_presence,
          terminal_id, payment_gateway_ref,
          payment_method, transaction_type, amount, currency, ip_address,
          country, txn_time, transaction_status, risk_score, risk_level,
          triggered_rules, processing_status, source_type
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      txn.transaction_id,
      txn.merchant_id,
      txn.masked_payment_ref,
      txn.card_bin,
      txn.masked_card_number,
      txn.card_presence,
      txn.terminal_id,
      txn.payment_gateway_ref,
      txn.payment_method,
      txn.transaction_type,
      txn.amount,
      txn.currency,
      txn.ip_address,
      txn.country,
      txn.timestamp,
      txn.status || "success",
      result.risk_score,
      result.risk_level,
      JSON.stringify(result.triggered_rules),
      "Processing",
      txn.source_type,
    ]
  );

  const persistedRisk = await getPersistedTransactionRisk(txn.transaction_id, txn);

  const shouldGenerateAlert =
    persistedRisk.risk_level === "Medium" ||
    persistedRisk.risk_level === "High" ||
    persistedRisk.risk_level === "Critical";

  let alertId = null;

  if (shouldGenerateAlert) {
    try {
      alertId = await createAlertRecord(txn, result);

      try {
        await query(
          `
            INSERT INTO case_actions
              (alert_id, user_id, action_type, status_after_action, remarks)
            VALUES (?, ?, 'alert_created', 'Pending', ?)
          `,
          [
            alertId,
            req.user.id,
            result.triggered_rules.join(", ") || "Alert created by risk engine",
          ]
        );
      } catch (actionErr) {
        await logCritical(
          txn,
          `Alert ${alertId} was created but its case history entry failed: ${actionErr.message}`
        );
      }

      await logAudit("alert_generated", txn, `Alert generated: ${alertId}`);

      const io = req.app.get("io");
      if (io) {
        io.emit("newAlert", {
          alert_id: alertId,
          transaction_id: txn.transaction_id,
          merchant_id: txn.merchant_id,
          ...result,
        });
      }
    } catch (err) {
      await logCritical(txn, `Failed to generate alert: ${err.message}`);
    }
  }

  await logAudit(
    "transaction_processed",
    txn,
    `Transaction processed: ${persistedRisk.risk_level} risk, alert ${
      alertId ? `created (${alertId})` : "skipped"
    }`
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
  result.alert_id = alertId;

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
    transaction_status: result.status,
    source_type: txn.source_type,
    alert_id: result.alert_id,
    decision: result.decision || result.status,
    rejection_reason: result.rejection_reason || null,
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
    console.error("createTransaction error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.simulate = async (req, res) => {
  try {
    const generated = generateTransaction();

    const txn = {
      ...generated,
      timestamp: generated.txn_time,
      customer_risk_profile: generated.amount > 3000 ? "high" : "low",
      source_type: "simulator",
    };

    const processed = await processTransaction(txn, req);

    if (!processed.validation.isValid) {
      return res.status(400).json({
        message: "Generated transaction failed validation",
        errors: processed.validation.errors,
      });
    }

    res.json({ transaction: { ...txn, ...processed.txn, ...processed.result } });
  } catch (err) {
    console.error("simulate error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.getTransactions = (req, res) => {
  db.query(
    `
      SELECT t.*, t.transaction_status AS status,
             m.merchant_name, m.merchant_average_amount,
             m.risk_level AS merchant_risk_level, m.merchant_risk_score,
             m.has_physical_location, m.business_category, m.mcc_code,
             m.operating_hours_start, m.operating_hours_end
      FROM transactions t
      LEFT JOIN merchants m ON t.merchant_id = m.merchant_id
      ORDER BY COALESCE(t.txn_time, t.created_at) DESC
    `,
    (err, results) => {
      if (err) return res.status(500).json({ message: "Server error" });
      res.json(results);
    }
  );
};

exports.showTransactionDetailsPage = async (req, res) => {
  try {
    const transactionId = req.params.id;

    const transactions = await query(
      `
        SELECT t.*, t.transaction_status AS status,
               m.merchant_name, m.merchant_average_amount,
               m.risk_level AS merchant_risk_level, m.merchant_risk_score,
               m.has_physical_location, m.business_category, m.mcc_code,
               m.operating_hours_start, m.operating_hours_end
        FROM transactions t
        LEFT JOIN merchants m ON t.merchant_id = m.merchant_id
        WHERE t.transaction_id = ?
        LIMIT 1
      `,
      [transactionId]
    );

    if (!transactions.length) {
      return res.send("Transaction not found");
    }

    const transaction = transactions[0];

    const alerts = await query(
      `
        SELECT a.*, a.alert_id AS id, u.name AS officer_name, NULL AS escalation_report
        FROM alerts a
        LEFT JOIN users u ON a.reviewed_by = u.user_id
        WHERE a.transaction_id = ?
        ORDER BY a.created_at DESC
        LIMIT 1
      `,
      [transactionId]
    );

    const alert = alerts[0] || null;

    if (alert && !alert.read_at) {
      await query("UPDATE alerts SET read_at = NOW() WHERE alert_id = ?", [alert.alert_id]);
      alert.read_at = new Date();
    }

    res.render("transactionDetails", { transaction, alert });
  } catch (err) {
    console.error("showTransactionDetailsPage error:", err);
    res.send("Server error");
  }
};

exports.getAlerts = async (req, res) => {
  const status = req.query.status || "Pending";

  const orderByRisk =
    "a.read_at IS NOT NULL, FIELD(a.risk_level, 'Critical', 'High', 'Medium', 'Low'), a.created_at DESC";

  const sql =
    status === "all"
      ? `
        SELECT a.*, a.alert_id AS id, m.merchant_name,
               t.amount, t.currency, t.transaction_type, t.ip_address, t.country
        FROM alerts a
        LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
        LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
        ORDER BY ${orderByRisk}
        LIMIT 200
      `
      : `
        SELECT a.*, a.alert_id AS id, m.merchant_name,
               t.amount, t.currency, t.transaction_type, t.ip_address, t.country
        FROM alerts a
        LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
        LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
        WHERE a.status = ?
        ORDER BY ${orderByRisk}
        LIMIT 200
      `;

  const values = status === "all" ? [] : [status];

  try {
    const results = await query(sql, values);
    res.json(results);
  } catch (err) {
    console.error("getAlerts error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

function normalizeImportRow(row) {
  return Object.entries(row || {}).reduce((normalized, [key, value]) => {
    const normalizedKey = String(key)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (normalizedKey) normalized[normalizedKey] = value;

    return normalized;
  }, {});
}

function formatImportError(err) {
  if (err?.code === "ER_DUP_ENTRY") return "transaction_id already exists";
  return err?.message || "Unable to process transaction";
}

exports.uploadTransactions = async (req, res) => {
  const rows = req.body?.transactions;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "The upload contains no transaction rows" });
  }

  if (rows.length > 500) {
    return res.status(400).json({ message: "A maximum of 500 transactions is allowed per upload" });
  }

  const merchantAverageCache = new Map();
  const results = [];

  for (let index = 0; index < rows.length; index++) {
    const row = normalizeImportRow(rows[index]);
    const transactionId = row.transaction_id || null;

    try {
      if (!row.merchant_average_amount && row.merchant_id) {
        if (!merchantAverageCache.has(row.merchant_id)) {
          const merchants = await query(
            "SELECT merchant_average_amount FROM merchants WHERE merchant_id = ? LIMIT 1",
            [row.merchant_id]
          );

          merchantAverageCache.set(
            row.merchant_id,
            merchants[0]?.merchant_average_amount || 1000
          );
        }

        row.merchant_average_amount = merchantAverageCache.get(row.merchant_id);
      }

      const payload = {
        ...row,
        timestamp: row.timestamp || row.txn_time || row.transaction_time,
        currency: row.currency || "SGD",
        transaction_type: row.transaction_type || (row.ip_address ? "online" : "face_to_face"),
        customer_risk_profile: row.customer_risk_profile || "low",
        merchant_average_amount: row.merchant_average_amount || 1000,
        merchant_name: row.merchant_name || row.merchant_id,
        source_type: "excel_upload",
      };

      const processed = await processTransaction(payload, req);

      if (!processed.validation.isValid) {
        results.push({
          row: index + 2,
          transaction_id: transactionId,
          status: "failed",
          errors: processed.validation.errors,
        });
        continue;
      }

      results.push({
        row: index + 2,
        status: processed.result.decision === "Rejected" ? "rejected" : "processed",
        ...buildApiResponse(processed.txn, processed.result),
      });
    } catch (err) {
      results.push({
        row: index + 2,
        transaction_id: transactionId,
        status: "failed",
        errors: [formatImportError(err)],
      });
    }
  }

  const succeeded = results.filter((result) =>
    result.status === "processed" || result.status === "rejected"
  ).length;
  const rejected = results.filter((result) => result.status === "rejected").length;
  const alertsCreated = results.filter((result) => result.alert_id).length;

  res.status(succeeded > 0 ? 200 : 422).json({
    message: `Processed ${succeeded} of ${rows.length} transactions`,
    summary: {
      total: rows.length,
      succeeded,
      failed: rows.length - succeeded,
      rejected,
      alerts_created: alertsCreated,
    },
    results,
  });
};

exports.getComplianceRules = async (req, res) => {
  try {
    await ensureDefaultRules(req.user.id);

    const rules = await query(
      `
        SELECT rule_id, rule_name, rule_type, description, threshold_value,
               threshold_count, time_window_minutes, points, is_active,
               created_at, updated_at
        FROM compliance_rules
        ORDER BY is_active DESC, rule_type ASC, rule_name ASC
      `
    );

    res.json(rules);
  } catch (err) {
    console.error("getComplianceRules error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

function optionalDecimal(value, fieldName) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return number;
}

function optionalInteger(value, fieldName) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${fieldName} must be a positive whole number`);
  }
  return number;
}

function normalizeRulePayload(body = {}) {
  const ruleName = String(body.rule_name || "").trim();
  const ruleType = String(body.rule_type || "").trim();
  const description = String(body.description || "").trim();

  if (!ruleName) throw new Error("Rule name is required");
  if (ruleName.length > 100) throw new Error("Rule name must be 100 characters or fewer");
  if (ruleType.length > 50) throw new Error("Rule type must be 50 characters or fewer");

  return {
    rule_name: ruleName,
    rule_type: ruleType || null,
    description: description || null,
    threshold_value: optionalDecimal(body.threshold_value, "Threshold value"),
    threshold_count: optionalInteger(body.threshold_count, "Threshold count"),
    time_window_minutes: optionalInteger(body.time_window_minutes, "Time window"),
    points: optionalInteger(body.points ?? 0, "Points") ?? 0,
    is_active: body.is_active ? 1 : 0,
  };
}

exports.createComplianceRule = async (req, res) => {
  try {
    const rule = normalizeRulePayload(req.body);

    const result = await query(
      `
        INSERT INTO compliance_rules
          (
            rule_name, rule_type, description, threshold_value,
            threshold_count, time_window_minutes, points, is_active,
            created_by, updated_by
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        rule.rule_name,
        rule.rule_type,
        rule.description,
        rule.threshold_value,
        rule.threshold_count,
        rule.time_window_minutes,
        rule.points,
        rule.is_active,
        req.user.id,
        req.user.id,
      ]
    );

    res.status(201).json({ message: "Rule created successfully", rule_id: result.insertId });
  } catch (err) {
    console.error("createComplianceRule error:", err);
    res.status(400).json({ message: err.message || "Unable to create rule" });
  }
};

exports.updateComplianceRule = async (req, res) => {
  try {
    const ruleId = Number(req.params.id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      return res.status(400).json({ message: "Invalid rule ID" });
    }

    const rule = normalizeRulePayload(req.body);

    const result = await query(
      `
        UPDATE compliance_rules
        SET rule_name = ?, rule_type = ?, description = ?,
            threshold_value = ?, threshold_count = ?, time_window_minutes = ?,
            points = ?, is_active = ?, updated_by = ?, updated_at = NOW()
        WHERE rule_id = ?
      `,
      [
        rule.rule_name,
        rule.rule_type,
        rule.description,
        rule.threshold_value,
        rule.threshold_count,
        rule.time_window_minutes,
        rule.points,
        rule.is_active,
        req.user.id,
        ruleId,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Rule not found" });
    }

    res.json({ message: "Rule updated successfully" });
  } catch (err) {
    console.error("updateComplianceRule error:", err);
    res.status(400).json({ message: err.message || "Unable to update rule" });
  }
};

exports.deleteComplianceRule = async (req, res) => {
  try {
    const ruleId = Number(req.params.id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      return res.status(400).json({ message: "Invalid rule ID" });
    }

    const result = await query("DELETE FROM compliance_rules WHERE rule_id = ?", [ruleId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Rule not found" });
    }

    res.json({ message: "Rule deleted successfully" });
  } catch (err) {
    console.error("deleteComplianceRule error:", err);
    res.status(500).json({ message: "Unable to delete rule" });
  }
};

exports.getAlert = async (req, res) => {
  try {
    const alert = await getAlertById(req.params.id);

    if (!alert) return res.status(404).json({ message: "Alert not found" });

    res.json(alert);
  } catch (err) {
    console.error("getAlert error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.markAlertRead = async (req, res) => {
  try {
    const alert = await getAlertById(req.params.id);

    if (!alert) return res.status(404).json({ message: "Alert not found" });

    if (!alert.read_at) {
      await query(
        `
          UPDATE alerts
          SET read_at = NOW()
          WHERE alert_id = ?
        `,
        [req.params.id]
      );
    }

    const updated = await getAlertById(req.params.id);

    res.json({ message: "Alert marked as read", alert: updated });
  } catch (err) {
    console.error("markAlertRead error:", err);
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

    await updateAlertStatus(req.params.id, "Closed", req.user.id, null, "close_case");
    await logAudit("alert_dismissed", alert, `Alert dismissed by user ${req.user.id}`);

    res.json({ message: "Alert successfully dismissed" });
  } catch (err) {
    console.error("dismissAlert error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

function formatEscalationReport(alert) {
  let triggeredRules = alert.triggered_rules;

  try {
    const parsed = JSON.parse(alert.triggered_rules);
    if (Array.isArray(parsed)) triggeredRules = parsed.join("; ");
  } catch {}

  return `Escalation report for ${alert.transaction_id}: merchant=${
    alert.merchant_name || "N/A"
  }, amount=${alert.amount || "N/A"}, currency=${alert.currency || "N/A"}, risk_level=${
    alert.risk_level
  }, triggered_rules=${triggeredRules}`;
}

exports.escalateAlert = async (req, res) => {
  try {
    const alert = await getAlertById(req.params.id);

    if (!alert) return res.status(404).json({ message: "Alert not found" });

    if (alert.status !== "Pending") {
      return res.status(400).json({ message: "Only pending alerts can be escalated" });
    }

    const report = formatEscalationReport(alert);

    await updateAlertStatus(
      req.params.id,
      "Escalated to STRO",
      req.user.id,
      report,
      "escalate_to_stro"
    );

    await logAudit("alert_escalated", alert, `Alert escalated by user ${req.user.id}`);
    await logAudit("escalation_report", alert, report);

    res.json({ message: "Alert successfully escalated", escalation_report: report });
  } catch (err) {
    console.error("escalateAlert error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
