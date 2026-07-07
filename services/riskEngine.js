const net = require("net");
const { getRiskLevel, getTransactionStatus } = require("./riskScoring");

const FAILED_ATTEMPT_STATUSES = Object.freeze(["failed", "declined"]);
const SUCCESS_STATUSES = Object.freeze(["success", "completed"]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isFailedAttemptStatus(value) {
  return FAILED_ATTEMPT_STATUSES.includes(normalizeStatus(value));
}

function isSuccessStatus(value) {
  return SUCCESS_STATUSES.includes(normalizeStatus(value));
}

function hasInvalidIp(txn) {
  if (txn.transaction_type !== "online") return false;
  return !txn.ip_address || net.isIP(txn.ip_address) === 0;
}

function normalizeCountry(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasIpCountryMismatch(txn, context = {}) {
  if (txn.transaction_type !== "online") return false;
  if (!context.ipCountryVerified) return false;

  const submittedCountry = normalizeCountry(txn.country);
  const ipCountry = normalizeCountry(txn.ip_country);
  return Boolean(submittedCountry && ipCountry && submittedCountry !== ipCountry);
}

function parseTimeToMinutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isOutsideMerchantOperatingHours(timestamp, merchant = {}, transactionType) {
  if (transactionType !== "face_to_face") return false;
  if (Number(merchant.has_physical_location) !== 1) return false;
  if (!merchant.operating_hours_start || !merchant.operating_hours_end) return false;

  const txnTime = new Date(timestamp);
  if (Number.isNaN(txnTime.getTime())) return false;

  const txnMinutes = txnTime.getHours() * 60 + txnTime.getMinutes();
  const startMinutes = parseTimeToMinutes(merchant.operating_hours_start);
  const endMinutes = parseTimeToMinutes(merchant.operating_hours_end);
  if (startMinutes === null || endMinutes === null) return false;

  if (startMinutes <= endMinutes) {
    return txnMinutes < startMinutes || txnMinutes > endMinutes;
  }

  return txnMinutes > endMinutes && txnMinutes < startMinutes;
}

function addTriggeredRule(triggeredRules, rule, message, evidence = {}, pointsOverride = null) {
  if (!rule) return 0;
  const points = Math.max(0, Number(pointsOverride === null ? rule.points : pointsOverride) || 0);

  triggeredRules.push({
    rule_id: rule.rule_id,
    rule_type: rule.rule_type,
    rule_name: rule.rule_name,
    points,
    message,
    evidence,
  });

  return points;
}

function configuredNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function evaluateTransaction(txn, context = {}) {
  let risk_score = 0;
  const triggered_rules = [];
  const merchant = context.merchant || {};
  const rules = context.rules || {};
  const paymentIdentifier = context.paymentIdentifier || null;

  const merchantRule = rules.merchant_profile;
  const merchantCategoryRisk = context.merchantCategoryRisk;
  if (merchantRule && merchantCategoryRisk && Number(merchantCategoryRisk.points) > 0) {
    risk_score += addTriggeredRule(
      triggered_rules,
      merchantRule,
      `Merchant category risk matched: ${merchantCategoryRisk.category_name}`,
      {
        merchant_mcc: merchant.mcc_code || null,
        matched_mcc: merchantCategoryRisk.mcc_code || null,
        matched_business_category: merchantCategoryRisk.category_name || null,
        category_keyword: merchantCategoryRisk.category_keyword || null,
      },
      Number(merchantCategoryRisk.points)
    );
  }

  const merchantAverageAmount = Number(merchant.merchant_average_amount) || 0;
  const amountRule = rules.amount_multiplier;
  const amountMultiplier = configuredNumber(amountRule?.threshold_value, 0);
  if (
    amountRule &&
    merchantAverageAmount > 0 &&
    amountMultiplier > 0 &&
    Number(txn.amount) > merchantAverageAmount * amountMultiplier
  ) {
    risk_score += addTriggeredRule(
      triggered_rules,
      amountRule,
      "Transaction amount exceeded the configured merchant-average multiplier",
      {
        actual_amount: Number(txn.amount),
        merchant_average_amount: merchantAverageAmount,
        configured_multiplier: amountMultiplier,
        trigger_amount: merchantAverageAmount * amountMultiplier,
      }
    );
  }

  const velocityRule = rules.velocity;
  const velocityThreshold = Number(velocityRule?.threshold_count || 0);
  if (velocityRule && velocityThreshold > 0 && Number(context.velocityCount || 0) >= velocityThreshold) {
    risk_score += addTriggeredRule(triggered_rules, velocityRule, "High transaction velocity for the same payment identifier", {
      actual_count: Number(context.velocityCount || 0),
      required_count: velocityThreshold,
      window_seconds: Number(velocityRule.time_window_seconds || 0),
      payment_identifier_type: paymentIdentifier?.type || null,
    });
  }

  const smallRule = rules.velocity_small_amount;
  const smallThreshold = Number(smallRule?.threshold_count || 0);
  if (smallRule && smallThreshold > 0 && Number(context.smallTransactionCount || 0) >= smallThreshold) {
    risk_score += addTriggeredRule(triggered_rules, smallRule, "Repeated small-value payment-testing pattern detected", {
      actual_count: Number(context.smallTransactionCount || 0),
      required_count: smallThreshold,
      amount_below: Number(smallRule.threshold_value || 0),
      window_seconds: Number(smallRule.time_window_seconds || 0),
      payment_identifier_type: paymentIdentifier?.type || null,
    });
  }

  const largeRule = rules.large_amount_frequency;
  const largeThreshold = Number(largeRule?.threshold_count || 0);
  if (largeRule && largeThreshold > 0 && Number(context.largeTransactionCount || 0) >= largeThreshold) {
    risk_score += addTriggeredRule(triggered_rules, largeRule, "Repeated unusually large transactions detected", {
      actual_count: Number(context.largeTransactionCount || 0),
      required_count: largeThreshold,
      configured_multiplier: Number(largeRule.threshold_value || 0),
      merchant_average_amount: merchantAverageAmount || null,
      window_seconds: Number(largeRule.time_window_seconds || 0),
      payment_identifier_type: paymentIdentifier?.type || null,
    });
  }

  const failedRule = rules.failed_attempt_velocity;
  const failedThreshold = Number(failedRule?.threshold_count || 0);
  if (
    failedRule &&
    failedThreshold > 0 &&
    isFailedAttemptStatus(txn.status) &&
    Number(context.failedAttemptCount || 0) >= failedThreshold
  ) {
    risk_score += addTriggeredRule(triggered_rules, failedRule, "Repeated failed or declined payment attempts detected", {
      actual_count: Number(context.failedAttemptCount || 0),
      required_count: failedThreshold,
      window_seconds: Number(failedRule.time_window_seconds || 0),
      current_status: normalizeStatus(txn.status),
      counted_statuses: FAILED_ATTEMPT_STATUSES,
      payment_identifier_type: paymentIdentifier?.type || null,
    });
  }

  const failureThenSuccessRule = rules.failure_then_success;
  const failureThenSuccessThreshold = Number(failureThenSuccessRule?.threshold_count || 0);
  if (
    failureThenSuccessRule &&
    failureThenSuccessThreshold > 0 &&
    isSuccessStatus(txn.status) &&
    Number(context.previousFailureCount || 0) >= failureThenSuccessThreshold
  ) {
    risk_score += addTriggeredRule(triggered_rules, failureThenSuccessRule, "Failed attempts were followed by a successful payment", {
      previous_failure_count: Number(context.previousFailureCount || 0),
      required_failure_count: failureThenSuccessThreshold,
      window_seconds: Number(failureThenSuccessRule.time_window_seconds || 0),
      payment_identifier_type: paymentIdentifier?.type || null,
    });
  }

  const duplicateRule = rules.duplicate_transaction;
  if (duplicateRule && Number(context.duplicatePatternCount || 0) > 0) {
    risk_score += addTriggeredRule(triggered_rules, duplicateRule, "Possible duplicate successful transaction detected", {
      matching_previous_transactions: Number(context.duplicatePatternCount || 0),
      previous_transaction_id: context.previousDuplicateTransaction?.transaction_id || null,
      previous_transaction_time: context.previousDuplicateTransaction?.txn_time || null,
      actual_amount: Number(txn.amount),
      currency: txn.currency,
      window_seconds: Number(duplicateRule.time_window_seconds || 0),
      payment_identifier_type: paymentIdentifier?.type || null,
    });
  }

  const timeRule = rules.time;
  if (timeRule && isOutsideMerchantOperatingHours(txn.timestamp, merchant, txn.transaction_type)) {
    risk_score += addTriggeredRule(triggered_rules, timeRule, "Face-to-face transaction occurred outside merchant operating hours", {
      transaction_time: txn.timestamp,
      operating_hours_start: merchant.operating_hours_start,
      operating_hours_end: merchant.operating_hours_end,
      timezone_assumption: "Asia/Singapore",
    });
  }

  const customerRule = rules.customer_risk;
  if (customerRule && txn.customer_risk_profile === "high") {
    risk_score += addTriggeredRule(triggered_rules, customerRule, "Customer profile is marked as high risk", {
      customer_risk_profile: txn.customer_risk_profile,
    });
  }

  const dataQualityRule = rules.data_quality;
  if (dataQualityRule && context.missingRequiredInfo) {
    risk_score += addTriggeredRule(triggered_rules, dataQualityRule, "Transaction is missing useful monitoring references", {
      missing_monitoring_identifiers: ["masked_card_number", "masked_payment_ref", "terminal_id", "payment_gateway_ref"],
    });
  }

  const ipRule = rules.ip_validation;
  if (ipRule && hasInvalidIp(txn)) {
    risk_score += addTriggeredRule(triggered_rules, ipRule, "Online transaction has missing or invalid IP information", {
      ip_address: txn.ip_address || null,
      transaction_type: txn.transaction_type,
    });
  }

  const mismatchRule = rules.ip_country_mismatch;
  if (mismatchRule && hasIpCountryMismatch(txn, context)) {
    risk_score += addTriggeredRule(triggered_rules, mismatchRule, "Verified IP country does not match transaction country", {
      transaction_country: txn.country,
      ip_country: txn.ip_country,
      ip_country_verified: Boolean(context.ipCountryVerified),
    });
  }

  const risk_level = getRiskLevel(risk_score);
  const status = getTransactionStatus(risk_level);

  return {
    risk_score,
    risk_level,
    status,
    triggered_rules,
    alert_required: risk_level !== "Low",
    alert_status: risk_level !== "Low" ? "Pending" : null,
  };
}

module.exports = {
  evaluateTransaction,
  hasInvalidIp,
  hasIpCountryMismatch,
  isOutsideMerchantOperatingHours,
  isFailedAttemptStatus,
  isSuccessStatus,
};
