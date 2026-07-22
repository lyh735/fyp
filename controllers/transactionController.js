const db = require("../config/db");
const { randomUUID } = require("crypto");
const { query } = require("../services/dbQuery");
const { evaluateTransaction } = require("../services/riskEngine");
const { generateTransaction } = require("../services/simulator");
const { validateTransaction } = require("../services/validation");
const {
  SUPPORTED_RULE_TYPES,
  isSupportedRuleType,
  getActiveRulesByType,
  getMerchantCategoryRisk,
  getMerchantCategoryProfiles,
  updateMerchantCategoryProfile,
} = require("../services/complianceRuleService");

const FAILED_ATTEMPT_STATUSES = Object.freeze(["failed", "declined"]);

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
      SELECT risk_score, risk_level, raw_risk_score, priority_score
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
  const existingMerchant = await getMerchantProfile(txn.merchant_id);
  if (existingMerchant) return existingMerchant;

  const merchantName = payload.merchant_name || txn.merchant_name || txn.merchant_id;

  await query(
    `
      INSERT INTO merchants
        (
          merchant_id, merchant_name, business_category, mcc_code,
          merchant_average_amount, merchant_max_transaction_amount,
          operating_hours_start, operating_hours_end,
          risk_level, merchant_risk_score, country, has_physical_location,
          status, created_by, updated_by
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      txn.merchant_id,
      merchantName,
      txn.business_category || payload.business_category || null,
      txn.mcc_code || payload.mcc_code || null,
      txn.merchant_average_amount || payload.merchant_average_amount || null,
      payload.merchant_max_transaction_amount || null,
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

  return getMerchantProfile(txn.merchant_id);
}

async function ensureMerchantTerminals(merchantId, userId) {
  // terminals_seeded gates a one-time initial pool so it doesn't get resurrected
  // after an admin deliberately deletes all of a merchant's terminals.
  const rows = await query("SELECT terminals_seeded FROM merchants WHERE merchant_id = ? LIMIT 1", [merchantId]);
  if (!rows.length || rows[0].terminals_seeded) return;

  const terminalCount = Math.floor(Math.random() * 3) + 1; // 1-3 terminals for a new outlet
  for (let i = 1; i <= terminalCount; i++) {
    await query(
      `INSERT INTO terminals (terminal_id, merchant_id, label, status, created_by, updated_by)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      [`${merchantId}-T${i}`, merchantId, `Counter ${i}`, userId, userId]
    );
  }

  await query("UPDATE merchants SET terminals_seeded = 1 WHERE merchant_id = ?", [merchantId]);
}

async function pickActiveTerminalId(merchantId) {
  const rows = await query(
    "SELECT terminal_id FROM terminals WHERE merchant_id = ? AND status = 'active'",
    [merchantId]
  );
  if (!rows.length) return null;
  return rows[Math.floor(Math.random() * rows.length)].terminal_id;
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
            transaction_id, merchant_id, risk_score, base_rule_score,
            mcc_risk_points, raw_risk_score, displayed_risk_score,
            priority_multiplier, priority_score, risk_level,
            triggered_rules, status, priority, message
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        txn.transaction_id,
        txn.merchant_id,
        result.risk_score,
        result.base_rule_score,
        result.mcc_risk_points,
        result.raw_risk_score,
        result.displayed_risk_score,
        result.priority_multiplier,
        result.priority_score,
        result.risk_level,
        JSON.stringify(result.triggered_rules),
        "Pending",
        priority,
        formatTriggeredRules(result.triggered_rules),
      ]
    )
  );

  return insertResult.insertId;
}

function formatTriggeredRules(triggeredRules) {
  if (!Array.isArray(triggeredRules) || triggeredRules.length === 0) {
    return "No rules triggered";
  }

  return triggeredRules
    .map((item) => {
      if (item && typeof item === "object") {
        const label = item.rule_name || item.message || "Risk rule";
        const detail = item.message && item.message !== label ? `: ${item.message}` : "";
        return `+${Number(item.points || 0)} ${label}${detail}`;
      }
      return String(item);
    })
    .join(", ");
}

async function getAlertById(alertId) {
  const rows = await query(
    `
      SELECT a.*, a.alert_id AS id, m.merchant_name,
             t.payment_method, t.amount, t.currency,
             t.transaction_type, t.ip_address, t.country, t.ip_country, t.customer_risk_profile,
             m.merchant_average_amount, m.risk_level AS merchant_risk_level,
             m.mcc_code, m.merchant_risk_score, m.has_physical_location,
             t.base_rule_score AS transaction_base_rule_score,
             t.mcc_risk_points AS transaction_mcc_risk_points,
             t.raw_risk_score AS transaction_raw_risk_score,
             t.displayed_risk_score AS transaction_displayed_risk_score,
             t.priority_multiplier AS transaction_priority_multiplier,
             t.priority_score AS transaction_priority_score,
             mcr.category_name AS mcc_category_name,
             COALESCE(mcr.risk_level, 'LOW') AS mcc_risk_level,
             t.source_type, t.txn_time AS transaction_time,
             u.name AS officer_name, NULL AS escalation_report
      FROM alerts a
      LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
      LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
      LEFT JOIN merchant_category_risk mcr ON mcr.is_active = 1 AND mcr.mcc_code = m.mcc_code
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

const ACTIVITY_IDENTIFIER_COLUMNS = Object.freeze([
  ["masked_card_number", "masked_card_number"],
  ["masked_payment_ref", "masked_payment_ref"],
  ["payment_gateway_ref", "payment_gateway_ref"],
]);

function getPaymentActivityIdentifier(txn) {
  for (const [type, column] of ACTIVITY_IDENTIFIER_COLUMNS) {
    const value = String(txn[type] || "").trim();
    if (value) return { type, column, value };
  }
  return null;
}

function getRuleWindowSeconds(rule, fallbackSeconds) {
  const configured = Number(rule?.time_window_seconds);
  return Number.isInteger(configured) && configured > 0 ? configured : fallbackSeconds;
}

function getRule(rules, ...types) {
  for (const type of types) {
    if (rules[type]) return rules[type];
  }
  return null;
}

async function getVelocityCount(txn, rule, identity) {
  if (!rule || !identity) return 0;
  const windowSeconds = getRuleWindowSeconds(rule, 60);
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= TIMESTAMPADD(SECOND, ?, ?)
        AND txn_time <= ?
        AND ${identity.column} = ?
        AND LOWER(COALESCE(transaction_status, '')) NOT IN ('failed', 'declined')
    `,
    [-windowSeconds, txn.timestamp, txn.timestamp, identity.value]
  );

  const currentStatus = String(txn.status || "").trim().toLowerCase();
  const currentCountsForGeneralVelocity = !FAILED_ATTEMPT_STATUSES.includes(currentStatus);
  return Number(rows[0]?.count || 0) + (currentCountsForGeneralVelocity ? 1 : 0);
}

async function getSmallTransactionCount(txn, rule, identity, merchantCategoryRisk) {
  if (!rule || !identity) return 0;
  const windowSeconds = getRuleWindowSeconds(rule, 300);
  const amountLimit = Number(rule.threshold_value || merchantCategoryRisk?.expected_min_amount || 10);
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= TIMESTAMPADD(SECOND, ?, ?)
        AND txn_time <= ?
        AND amount < ?
        AND ${identity.column} = ?
    `,
    [-windowSeconds, txn.timestamp, txn.timestamp, amountLimit, identity.value]
  );

  return Number(rows[0]?.count || 0) + (Number(txn.amount) < amountLimit ? 1 : 0);
}

async function getLargeTransactionCount(txn, merchant, merchantCategoryRisk, rule, identity) {
  if (!rule || !identity) return 0;

  const merchantMaximum = Number(merchant?.merchant_max_transaction_amount || 0);
  const mccExpectedMax = Number(merchantCategoryRisk?.expected_max_amount || 0);
  const generalThreshold = Number(rule?.threshold_value || 0);
  if (merchantMaximum <= 0 && mccExpectedMax <= 0 && generalThreshold <= 0) return 0;

  const windowSeconds = getRuleWindowSeconds(rule, 1800);
  const largeAmountThreshold = merchantMaximum > 0
    ? merchantMaximum
    : mccExpectedMax > 0
      ? mccExpectedMax
      : generalThreshold;
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= TIMESTAMPADD(SECOND, ?, ?)
        AND txn_time <= ?
        AND amount > ?
        AND ${identity.column} = ?
    `,
    [-windowSeconds, txn.timestamp, txn.timestamp, largeAmountThreshold, identity.value]
  );

  return Number(rows[0]?.count || 0) + (Number(txn.amount) > largeAmountThreshold ? 1 : 0);
}

async function getRepeatedIdenticalAmountPattern(txn, rule, identity) {
  if (!rule) {
    return { count: 0, distinctIdentifierCount: 0 };
  }
  const windowSeconds = getRuleWindowSeconds(rule, 300);
  const identifierExpression = `
    COALESCE(
      NULLIF(masked_card_number, ''),
      NULLIF(masked_payment_ref, ''),
      NULLIF(payment_gateway_ref, ''),
      CONCAT('txn:', transaction_id)
    )
  `;
  const currentIdentifier = identity?.value || `txn:${txn.transaction_id}`;
  const rows = await query(
    `
      SELECT COUNT(*) AS count,
             COUNT(DISTINCT ${identifierExpression}) AS distinct_identifier_count,
             SUM(CASE WHEN ${identifierExpression} = ? THEN 1 ELSE 0 END) AS same_identifier_count
      FROM transactions
      WHERE txn_time >= TIMESTAMPADD(SECOND, ?, ?)
        AND txn_time <= ?
        AND transaction_id <> ?
        AND merchant_id = ?
        AND amount BETWEEN ? AND ?
    `,
    [
      currentIdentifier,
      -windowSeconds,
      txn.timestamp,
      txn.timestamp,
      txn.transaction_id,
      txn.merchant_id,
      Number(txn.amount) - 0.01,
      Number(txn.amount) + 0.01,
    ]
  );

  const priorCount = Number(rows[0]?.count || 0);
  const priorDistinctIdentifierCount = Number(rows[0]?.distinct_identifier_count || 0);
  const sameIdentifierCount = Number(rows[0]?.same_identifier_count || 0);
  return {
    count: priorCount + 1,
    distinctIdentifierCount: priorDistinctIdentifierCount + (sameIdentifierCount > 0 ? 0 : 1),
    sameIdentifierCount: sameIdentifierCount + (identity ? 1 : 0),
  };
}

async function getDailyActivity(txn) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS value
      FROM transactions
      WHERE merchant_id = ?
        AND DATE(txn_time) = DATE(?)
    `,
    [txn.merchant_id, txn.timestamp]
  );
  return {
    count: Number(rows[0]?.count || 0) + 1,
    value: Number(rows[0]?.value || 0) + Number(txn.amount || 0),
  };
}

async function getMerchantDailyAverages(merchantId, beforeTimestamp) {
  const rows = await query(
    `
      SELECT AVG(day_count) AS avg_count, AVG(day_value) AS avg_value
      FROM (
        SELECT DATE(txn_time) AS txn_date, COUNT(*) AS day_count, SUM(amount) AS day_value
        FROM transactions
        WHERE merchant_id = ?
          AND txn_time < ?
        GROUP BY DATE(txn_time)
      ) daily
    `,
    [merchantId, beforeTimestamp]
  );
  return {
    avgCount: Number(rows[0]?.avg_count || 0),
    avgValue: Number(rows[0]?.avg_value || 0),
  };
}

function resolveDailyThresholds(rules, merchantAverages, merchantCategoryRisk) {
  const countRule = getRule(rules, "daily_transaction_count_spike");
  const valueRule = getRule(rules, "daily_transaction_value_spike");
  const countMultiplier = Number(countRule?.threshold_value || 2);
  const valueMultiplier = Number(valueRule?.threshold_count || 2);

  const dailyCountThreshold = merchantAverages.avgCount > 0
    ? Math.ceil(merchantAverages.avgCount * countMultiplier)
    : Number(merchantCategoryRisk?.expected_daily_count || countRule?.threshold_count || 0);
  const dailyValueThreshold = merchantAverages.avgValue > 0
    ? merchantAverages.avgValue * valueMultiplier
    : Number(merchantCategoryRisk?.expected_daily_value || valueRule?.threshold_value || 0);

  return {
    dailyCountThreshold,
    dailyCountThresholdSource: merchantAverages.avgCount > 0 ? "MERCHANT" : merchantCategoryRisk?.expected_daily_count ? "MCC" : "GENERAL",
    dailyValueThreshold,
    dailyValueThresholdSource: merchantAverages.avgValue > 0 ? "MERCHANT" : merchantCategoryRisk?.expected_daily_value ? "MCC" : "GENERAL",
  };
}

async function getFailedAttemptCount(txn, rule, identity) {
  if (!rule || !identity) return 0;
  const windowSeconds = getRuleWindowSeconds(rule, 600);
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= TIMESTAMPADD(SECOND, ?, ?)
        AND txn_time <= ?
        AND LOWER(transaction_status) IN ('failed', 'declined')
        AND ${identity.column} = ?
    `,
    [-windowSeconds, txn.timestamp, txn.timestamp, identity.value]
  );

  const currentStatus = String(txn.status || "").toLowerCase();
  const currentIsFailedAttempt = ["failed", "declined"].includes(currentStatus);
  return Number(rows[0]?.count || 0) + (currentIsFailedAttempt ? 1 : 0);
}

async function getPreviousFailureCount(txn, rule, identity) {
  if (!rule || !identity) return 0;
  const windowSeconds = getRuleWindowSeconds(rule, 600);
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE txn_time >= TIMESTAMPADD(SECOND, ?, ?)
        AND txn_time <= ?
        AND LOWER(transaction_status) IN ('failed', 'declined')
        AND ${identity.column} = ?
    `,
    [-windowSeconds, txn.timestamp, txn.timestamp, identity.value]
  );

  return Number(rows[0]?.count || 0);
}

async function getDuplicatePattern(txn, rule, identity) {
  if (!rule || !identity || !["success", "completed"].includes(String(txn.status || "").toLowerCase())) {
    return { count: 0, previous: null };
  }

  const windowSeconds = getRuleWindowSeconds(rule, 60);
  const rows = await query(
    `
      SELECT transaction_id, txn_time
      FROM transactions
      WHERE txn_time >= TIMESTAMPADD(SECOND, ?, ?)
        AND txn_time <= ?
        AND transaction_id <> ?
        AND merchant_id = ?
        AND amount = ?
        AND currency = ?
        AND LOWER(transaction_status) IN ('success', 'completed')
        AND ${identity.column} = ?
      ORDER BY txn_time DESC
      LIMIT 5
    `,
    [
      -windowSeconds,
      txn.timestamp,
      txn.timestamp,
      txn.transaction_id,
      txn.merchant_id,
      txn.amount,
      txn.currency,
      identity.value,
    ]
  );

  return { count: rows.length, previous: rows[0] || null };
}

async function processTransaction(payload, req, validationOptions = {}) {
  await logAudit("transaction_received", payload, "Transaction received");

  const validation = validateTransaction(payload, validationOptions);
  if (!validation.isValid) {
    await logAudit(
      "validation_failed",
      payload,
      `Validation failed: ${validation.errors.join("; ")}`
    );

    return { validation };
  }

  const txn = validation.transaction;

  const merchant = await ensureMerchantRecord(txn, payload, req.user.id);
  await ensureMerchantTerminals(txn.merchant_id, req.user.id);

  if (txn.source_type === "simulator") {
    txn.terminal_id = txn.transaction_type === "face_to_face"
      ? await pickActiveTerminalId(txn.merchant_id)
      : null;
  }

  const rules = await getActiveRulesByType();
  const paymentIdentifier = getPaymentActivityIdentifier(txn);
  const merchantCategoryRisk = getRule(rules, "merchant_category_risk", "merchant_profile")
    ? await getMerchantCategoryRisk(merchant)
    : await getMerchantCategoryRisk(merchant);
  const dailyActivityPromise = getDailyActivity(txn);
  const merchantDailyAveragesPromise = getMerchantDailyAverages(txn.merchant_id, txn.timestamp);
  const smallRule = getRule(rules, "repeated_small_transactions", "velocity_small_amount");
  const largeRule = getRule(rules, "frequent_large_transactions", "large_amount_frequency");
  const velocityRule = getRule(rules, "transaction_velocity", "velocity");
  const duplicateRule = getRule(rules, "duplicate_payment_identifier", "duplicate_transaction");
  const identicalRule = getRule(rules, "repeated_identical_amounts");
  const [
    velocityCount,
    smallTransactionCount,
    largeTransactionCount,
    failedAttemptCount,
    previousFailureCount,
    duplicatePattern,
    repeatedIdenticalPattern,
    dailyActivity,
    merchantDailyAverages,
  ] = await Promise.all([
    getVelocityCount(txn, velocityRule, paymentIdentifier),
    getSmallTransactionCount(txn, smallRule, paymentIdentifier, merchantCategoryRisk),
    getLargeTransactionCount(txn, merchant, merchantCategoryRisk, largeRule, paymentIdentifier),
    getFailedAttemptCount(txn, rules.failed_attempt_velocity, paymentIdentifier),
    getPreviousFailureCount(txn, rules.failure_then_success, paymentIdentifier),
    getDuplicatePattern(txn, duplicateRule, paymentIdentifier),
    getRepeatedIdenticalAmountPattern(txn, identicalRule, paymentIdentifier),
    dailyActivityPromise,
    merchantDailyAveragesPromise,
  ]);
  const dailyThresholds = resolveDailyThresholds(rules, merchantDailyAverages, merchantCategoryRisk);

  const result = evaluateTransaction(txn, {
    merchant,
    rules,
    merchantCategoryRisk,
    paymentIdentifier,
    velocityCount,
    smallTransactionCount,
    largeTransactionCount,
    failedAttemptCount,
    previousFailureCount,
    duplicatePatternCount: duplicatePattern.count,
    previousDuplicateTransaction: duplicatePattern.previous,
    repeatedIdenticalAmountCount: repeatedIdenticalPattern.count,
    repeatedIdenticalDistinctIdentifierCount: repeatedIdenticalPattern.distinctIdentifierCount,
    repeatedIdenticalSameIdentifierCount: repeatedIdenticalPattern.sameIdentifierCount,
    dailyTransactionCount: dailyActivity.count,
    dailyTransactionValue: dailyActivity.value,
    ...dailyThresholds,
    missingRequiredInfo: validation.metadata.missingRequiredInfo,
    ipCountryVerified: validation.metadata.ipCountryVerified,
  });

  const ruleSummary = formatTriggeredRules(result.triggered_rules);

  await logAudit(
    "rules_triggered",
    txn,
    result.triggered_rules.length
      ? `Rules triggered: ${ruleSummary}`
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
          country, ip_country, customer_risk_profile, txn_time, transaction_status, risk_score, risk_level,
          base_rule_score, mcc_risk_points, raw_risk_score, displayed_risk_score,
          priority_multiplier, priority_score, triggered_rules, processing_status, source_type
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      txn.ip_country,
      txn.customer_risk_profile,
      txn.timestamp,
      txn.status || "success",
      result.risk_score,
      result.risk_level,
      result.base_rule_score,
      result.mcc_risk_points,
      result.raw_risk_score,
      result.displayed_risk_score,
      result.priority_multiplier,
      result.priority_score,
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
            ruleSummary || "Alert created by risk engine",
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
    official_risk_score: result.official_risk_score,
    base_rule_score: result.base_rule_score,
    mcc_risk_points: result.mcc_risk_points,
    raw_risk_score: result.raw_risk_score,
    displayed_risk_score: result.displayed_risk_score,
    priority_multiplier: result.priority_multiplier,
    priority_score: result.priority_score,
    mcc: result.mcc,
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
      customer_risk_profile: generated.customer_risk_profile || "low",
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
             m.operating_hours_start, m.operating_hours_end,
             mcr.category_name AS mcc_category_name,
             COALESCE(mcr.risk_level, 'LOW') AS mcc_risk_level
      FROM transactions t
      LEFT JOIN merchants m ON t.merchant_id = m.merchant_id
      LEFT JOIN merchant_category_risk mcr ON mcr.is_active = 1 AND mcr.mcc_code = m.mcc_code
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
               m.operating_hours_start, m.operating_hours_end,
               mcr.category_name AS mcc_category_name,
               COALESCE(mcr.risk_level, 'LOW') AS mcc_risk_level
        FROM transactions t
        LEFT JOIN merchants m ON t.merchant_id = m.merchant_id
        LEFT JOIN merchant_category_risk mcr ON mcr.is_active = 1 AND mcr.mcc_code = m.mcc_code
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
    "a.read_at IS NOT NULL, COALESCE(a.priority_score, a.risk_score, 0) DESC, a.created_at DESC";

  const sql =
    status === "all"
      ? `
        SELECT a.*, a.alert_id AS id, m.merchant_name,
               t.amount, t.currency, t.transaction_type, t.ip_address, t.country,
               m.mcc_code, mcr.category_name AS mcc_category_name,
               COALESCE(mcr.risk_level, 'LOW') AS mcc_risk_level
        FROM alerts a
        LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
        LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
        LEFT JOIN merchant_category_risk mcr ON mcr.is_active = 1 AND mcr.mcc_code = m.mcc_code
        ORDER BY ${orderByRisk}
        LIMIT 200
      `
      : `
        SELECT a.*, a.alert_id AS id, m.merchant_name,
               t.amount, t.currency, t.transaction_type, t.ip_address, t.country,
               m.mcc_code, mcr.category_name AS mcc_category_name,
               COALESCE(mcr.risk_level, 'LOW') AS mcc_risk_level
        FROM alerts a
        LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
        LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
        LEFT JOIN merchant_category_risk mcr ON mcr.is_active = 1 AND mcr.mcc_code = m.mcc_code
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

function generateMaskedReference(prefix) {
  return `${prefix}-***${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function generateGatewayReference() {
  return `GW-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

async function getMerchantImportProfile(merchantId) {
  const merchants = await query(
    `
      SELECT merchant_id, merchant_name, business_category, mcc_code,
             merchant_average_amount, merchant_max_transaction_amount,
             operating_hours_start, operating_hours_end,
             risk_level, merchant_risk_score, country, has_physical_location
      FROM merchants
      WHERE merchant_id = ?
      LIMIT 1
    `,
    [merchantId]
  );
  return merchants[0] || null;
}

exports.uploadTransactions = async (req, res) => {
  const rows = req.body?.transactions;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "The upload contains no transaction rows" });
  }

  if (rows.length > 500) {
    return res.status(400).json({ message: "A maximum of 500 transactions is allowed per upload" });
  }

  const importSourceType = String(req.body?.source_type || "").trim().toLowerCase() === "manual"
    ? "manual"
    : "excel_upload";
  const merchantProfileCache = new Map();
  const results = [];

  for (let index = 0; index < rows.length; index++) {
    const row = normalizeImportRow(rows[index]);
    const transactionId = row.transaction_id || null;

    try {
      let merchantProfile = null;
      if (row.merchant_id) {
        if (!merchantProfileCache.has(row.merchant_id)) {
          merchantProfileCache.set(row.merchant_id, await getMerchantImportProfile(row.merchant_id));
        }
        merchantProfile = merchantProfileCache.get(row.merchant_id);
        if (!merchantProfile) {
          throw new Error("merchant_id does not exist");
        }
      }

      const payload = {
        ...row,
        timestamp: row.timestamp || row.txn_time || row.transaction_time,
        currency: row.currency,
        transaction_type: row.transaction_type,
        customer_risk_profile: row.customer_risk_profile || "low",
        merchant_average_amount:
          Number(merchantProfile?.merchant_average_amount) > 0
            ? Number(merchantProfile.merchant_average_amount)
            : null,
        merchant_max_transaction_amount:
          Number(merchantProfile?.merchant_max_transaction_amount) > 0
            ? Number(merchantProfile.merchant_max_transaction_amount)
            : null,
        merchant_risk_score: Number.isInteger(Number(merchantProfile?.merchant_risk_score))
          ? Number(merchantProfile.merchant_risk_score)
          : 0,
        merchant_name: merchantProfile?.merchant_name || row.merchant_name || row.merchant_id,
        business_category: merchantProfile?.business_category || null,
        mcc_code: merchantProfile?.mcc_code || null,
        operating_hours_start: merchantProfile?.operating_hours_start || null,
        operating_hours_end: merchantProfile?.operating_hours_end || null,
        merchant_risk_level: merchantProfile?.risk_level || null,
        merchant_country: merchantProfile?.country || "Singapore",
        has_physical_location: merchantProfile?.has_physical_location,
        country: row.country || merchantProfile?.country || "Singapore",
        masked_payment_ref: row.masked_payment_ref || generateMaskedReference("PAY"),
        payment_gateway_ref: row.payment_gateway_ref || generateGatewayReference(),
        card_bin: row.card_bin || null,
        masked_card_number: row.masked_card_number || null,
        card_presence: row.card_presence || null,
        source_type: importSourceType,
      };

      const processed = await processTransaction(payload, req, {
        requirePaymentMethod: true,
        requireTerminalForFaceToFace: true,
        requireIpForOnline: true,
        allowedSourceTypes: ["excel_upload", "manual"],
      });
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
    const placeholders = SUPPORTED_RULE_TYPES.map(() => "?").join(", ");
    const rules = await query(
      `
        SELECT rule_id, rule_name, rule_type, description, threshold_value,
               threshold_count, time_window_minutes, time_window_seconds, points, is_active,
               created_at, updated_at
        FROM compliance_rules
        WHERE rule_type IN (${placeholders})
        ORDER BY is_active DESC, rule_type ASC, rule_name ASC
      `,
      SUPPORTED_RULE_TYPES
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
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return number;
}

function optionalInteger(value, fieldName) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${fieldName} must be a non-negative whole number`);
  }
  return number;
}

function normalizeRulePayload(body = {}) {
  const ruleName = String(body.rule_name || "").trim();
  const ruleType = String(body.rule_type || "").trim();
  const description = String(body.description || "").trim();
  const timeWindowSeconds = optionalInteger(body.time_window_seconds, "Time window in seconds");

  if (!ruleName) throw new Error("Rule name is required");
  if (ruleName.length > 100) throw new Error("Rule name must be 100 characters or fewer");
  if (!isSupportedRuleType(ruleType)) {
    throw new Error(`Unsupported rule type. Supported types: ${SUPPORTED_RULE_TYPES.join(", ")}`);
  }

  return {
    rule_name: ruleName,
    rule_type: ruleType || null,
    description: description || null,
    threshold_value: optionalDecimal(body.threshold_value, "Threshold value"),
    threshold_count: optionalInteger(body.threshold_count, "Threshold count"),
    time_window_seconds: timeWindowSeconds,
    time_window_minutes: timeWindowSeconds === null ? null : Math.ceil(timeWindowSeconds / 60),
    points: optionalInteger(body.points ?? 0, "Points") ?? 0,
    is_active: body.is_active ? 1 : 0,
  };
}

async function ensureUniqueRuleType(ruleType, excludingRuleId = null) {
  const values = [ruleType];
  let sql = "SELECT rule_id FROM compliance_rules WHERE rule_type = ?";
  if (excludingRuleId !== null) {
    sql += " AND rule_id <> ?";
    values.push(excludingRuleId);
  }
  sql += " LIMIT 1";

  const rows = await query(sql, values);
  if (rows.length) {
    throw new Error("A rule with this rule type already exists. Edit the existing rule instead.");
  }
}

exports.createComplianceRule = async (req, res) => {
  try {
    const rule = normalizeRulePayload(req.body);
    await ensureUniqueRuleType(rule.rule_type);

    const result = await query(
      `
        INSERT INTO compliance_rules
          (
            rule_name, rule_type, description, threshold_value,
            threshold_count, time_window_minutes, time_window_seconds, points, is_active,
            created_by, updated_by
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        rule.rule_name,
        rule.rule_type,
        rule.description,
        rule.threshold_value,
        rule.threshold_count,
        rule.time_window_minutes,
        rule.time_window_seconds,
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
    await ensureUniqueRuleType(rule.rule_type, ruleId);

    const result = await query(
      `
        UPDATE compliance_rules
        SET rule_name = ?, rule_type = ?, description = ?,
            threshold_value = ?, threshold_count = ?, time_window_minutes = ?,
            time_window_seconds = ?, points = ?, is_active = ?, updated_by = ?, updated_at = NOW()
        WHERE rule_id = ?
      `,
      [
        rule.rule_name,
        rule.rule_type,
        rule.description,
        rule.threshold_value,
        rule.threshold_count,
        rule.time_window_minutes,
        rule.time_window_seconds,
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

    const result = await query(
      `
        UPDATE compliance_rules
        SET is_active = 0, updated_by = ?, updated_at = NOW()
        WHERE rule_id = ?
      `,
      [req.user.id, ruleId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Rule not found" });
    }

    res.json({ message: "Rule deactivated successfully" });
  } catch (err) {
    console.error("deleteComplianceRule error:", err);
    res.status(500).json({ message: "Unable to deactivate rule" });
  }
};

exports.getMccRiskProfiles = async (req, res) => {
  try {
    const profiles = await getMerchantCategoryProfiles();
    res.json(profiles);
  } catch (err) {
    console.error("getMccRiskProfiles error:", err);
    res.status(500).json({ message: "Unable to load MCC risk profiles" });
  }
};

exports.updateMccRiskProfile = async (req, res) => {
  try {
    const riskId = Number(req.params.id);
    if (!Number.isInteger(riskId) || riskId <= 0) {
      return res.status(400).json({ message: "Invalid MCC risk profile ID" });
    }

    await updateMerchantCategoryProfile(riskId, req.body);
    res.json({ message: "MCC risk profile updated successfully" });
  } catch (err) {
    console.error("updateMccRiskProfile error:", err);
    res.status(400).json({ message: err.message || "Unable to update MCC risk profile" });
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
    const parsed = typeof alert.triggered_rules === "string"
      ? JSON.parse(alert.triggered_rules)
      : alert.triggered_rules;
    if (Array.isArray(parsed)) triggeredRules = formatTriggeredRules(parsed);
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
