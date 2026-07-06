const net = require("net");
const { getRiskLevel, getTransactionStatus } = require("./riskScoring");

function hasInvalidIp(txn) {
  if (txn.transaction_type !== "online") return false;
  return !txn.ip_address || net.isIP(txn.ip_address) === 0;
}

function normalizeCountry(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function hasIpCountryMismatch(txn) {
  if (txn.transaction_type !== "online") return false;

  const submittedCountry = normalizeCountry(txn.country);
  const ipCountry = normalizeCountry(txn.ip_country);

  return Boolean(submittedCountry && ipCountry && submittedCountry !== ipCountry);
}

function isOutsideMerchantOperatingHours(timestamp, merchant = {}, transactionType) {
  if (transactionType !== "face_to_face") return false;
  if (Number(merchant.has_physical_location) !== 1) return false;
  if (!merchant.operating_hours_start || !merchant.operating_hours_end) return false;

  const txnTime = new Date(timestamp);
  if (Number.isNaN(txnTime.getTime())) return false;

  const txnMinutes = txnTime.getHours() * 60 + txnTime.getMinutes();
  const [startHour, startMin] = String(merchant.operating_hours_start)
    .split(":")
    .map(Number);
  const [endHour, endMin] = String(merchant.operating_hours_end)
    .split(":")
    .map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return false;

  if (startMinutes <= endMinutes) {
    return txnMinutes < startMinutes || txnMinutes > endMinutes;
  }

  return txnMinutes > endMinutes && txnMinutes < startMinutes;
}

function addTriggeredRule(triggeredRules, rule, message, evidence = {}, pointsOverride = null) {
  if (!rule) return 0;

  const points = Number(pointsOverride === null ? rule.points : pointsOverride) || 0;

  triggeredRules.push({
    rule_id: rule.rule_id,
    rule_type: rule.rule_type,
    rule_name: rule.rule_name,
    rule: rule.rule_name,
    points,
    message,
    evidence,
  });

  return points;
}

function evaluateTransaction(txn, context = {}) {
  let risk_score = 0;
  const triggered_rules = [];
  const merchant = context.merchant || {};
  const rules = context.rules || {};

  const merchantRule = rules.merchant_profile;
  const merchantCategoryRisk = context.merchantCategoryRisk;
  if (merchantRule && merchantCategoryRisk && Number(merchantCategoryRisk.points) > 0) {
    risk_score += addTriggeredRule(
      triggered_rules,
      merchantRule,
      `Merchant category risk matched: ${merchantCategoryRisk.category_name}`,
      {
        mcc_code: merchantCategoryRisk.mcc_code || merchant.mcc_code || null,
        business_category: merchant.business_category || null,
        matched_category: merchantCategoryRisk.category_name,
      },
      Number(merchantCategoryRisk.points)
    );
  }

  const merchantAverageAmount = Number(merchant.merchant_average_amount) || 0;
  const amountRule = rules.amount_multiplier;
  const amountMultiplier = Number(amountRule?.threshold_value || 0);

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
        transaction_amount: Number(txn.amount),
        merchant_average_amount: merchantAverageAmount,
        configured_multiplier: amountMultiplier,
        trigger_amount: merchantAverageAmount * amountMultiplier,
      }
    );
  }

  const velocityRule = rules.velocity;
  if (
    velocityRule &&
    Number(context.velocityCount || 0) >= Number(velocityRule.threshold_count || 0)
  ) {
    risk_score += addTriggeredRule(
      triggered_rules,
      velocityRule,
      "High transaction velocity detected for the same payment identifier",
      {
        actual_count: Number(context.velocityCount || 0),
        required_count: Number(velocityRule.threshold_count || 0),
        window_seconds: Number(velocityRule.time_window_seconds || 0),
      }
    );
  }

  const smallRule = rules.velocity_small_amount;
  if (
    smallRule &&
    Number(context.smallTransactionCount || 0) >= Number(smallRule.threshold_count || 0)
  ) {
    risk_score += addTriggeredRule(
      triggered_rules,
      smallRule,
      "Repeated small transactions detected for the same payment identifier",
      {
        actual_count: Number(context.smallTransactionCount || 0),
        required_count: Number(smallRule.threshold_count || 0),
        amount_limit: Number(smallRule.threshold_value || 0),
        window_seconds: Number(smallRule.time_window_seconds || 0),
      }
    );
  }

  const largeRule = rules.large_amount_frequency;
  if (
    largeRule &&
    Number(context.largeTransactionCount || 0) >= Number(largeRule.threshold_count || 0)
  ) {
    risk_score += addTriggeredRule(
      triggered_rules,
      largeRule,
      "Frequent unusually large transactions detected for the same payment identifier",
      {
        actual_count: Number(context.largeTransactionCount || 0),
        required_count: Number(largeRule.threshold_count || 0),
        merchant_average_multiplier: Number(largeRule.threshold_value || 0),
        window_seconds: Number(largeRule.time_window_seconds || 0),
      }
    );
  }

  const cancellationRule = rules.cancellation_velocity;
  if (
    cancellationRule &&
    Number(context.cancelledTransactionCount || 0) >=
      Number(cancellationRule.threshold_count || 0)
  ) {
    risk_score += addTriggeredRule(
      triggered_rules,
      cancellationRule,
      "Repeated failed, cancelled, or voided transactions detected",
      {
        actual_count: Number(context.cancelledTransactionCount || 0),
        required_count: Number(cancellationRule.threshold_count || 0),
        window_seconds: Number(cancellationRule.time_window_seconds || 0),
      }
    );
  }

  const failureThenSuccessRule = rules.failure_then_success;
  if (
    failureThenSuccessRule &&
    ["success", "completed"].includes(String(txn.status || "").toLowerCase()) &&
    Number(context.previousFailureCount || 0) >=
      Number(failureThenSuccessRule.threshold_count || 0)
  ) {
    risk_score += addTriggeredRule(
      triggered_rules,
      failureThenSuccessRule,
      "Successful transaction followed several recent failed attempts",
      {
        previous_failure_count: Number(context.previousFailureCount || 0),
        required_failure_count: Number(failureThenSuccessRule.threshold_count || 0),
        window_seconds: Number(failureThenSuccessRule.time_window_seconds || 0),
      }
    );
  }

  const duplicateRule = rules.duplicate_transaction;
  if (duplicateRule && Number(context.duplicatePatternCount || 0) > 0) {
    risk_score += addTriggeredRule(
      triggered_rules,
      duplicateRule,
      "A possible duplicate or replayed payment pattern was detected",
      {
        matching_previous_transactions: Number(context.duplicatePatternCount || 0),
        window_seconds: Number(duplicateRule.time_window_seconds || 0),
      }
    );
  }

  const timeRule = rules.time;
  if (
    timeRule &&
    isOutsideMerchantOperatingHours(txn.timestamp, merchant, txn.transaction_type)
  ) {
    risk_score += addTriggeredRule(
      triggered_rules,
      timeRule,
      "Face-to-face transaction occurred outside the merchant's operating hours",
      {
        transaction_time: txn.timestamp,
        operating_hours_start: merchant.operating_hours_start,
        operating_hours_end: merchant.operating_hours_end,
      }
    );
  }

  const customerRule = rules.customer_risk;
  if (customerRule && txn.customer_risk_profile === "high") {
    risk_score += addTriggeredRule(
      triggered_rules,
      customerRule,
      "Customer profile is marked as high risk",
      { customer_risk_profile: txn.customer_risk_profile }
    );
  }

  const dataQualityRule = rules.data_quality;
  if (dataQualityRule && context.missingRequiredInfo) {
    risk_score += addTriggeredRule(
      triggered_rules,
      dataQualityRule,
      "Transaction is missing useful identifying references"
    );
  }

  const ipRule = rules.ip_validation;
  if (ipRule && hasInvalidIp(txn)) {
    risk_score += addTriggeredRule(
      triggered_rules,
      ipRule,
      "Online transaction has a missing or invalid IP address",
      { ip_address: txn.ip_address || null }
    );
  }

  const jurisdictionRule = rules.high_risk_jurisdiction;
  if (jurisdictionRule && context.highRiskJurisdiction) {
    risk_score += addTriggeredRule(
      triggered_rules,
      jurisdictionRule,
      "Transaction originated from a configured high-risk jurisdiction",
      {
        country: txn.country,
        matched_country: context.highRiskJurisdiction.country_name,
        risk_level: context.highRiskJurisdiction.risk_level,
        reason: context.highRiskJurisdiction.reason || null,
      }
    );
  }

  const mismatchRule = rules.ip_country_mismatch;
  if (mismatchRule && hasIpCountryMismatch(txn)) {
    risk_score += addTriggeredRule(
      triggered_rules,
      mismatchRule,
      "Submitted transaction country does not match the recorded IP country",
      {
        submitted_country: txn.country,
        ip_country: txn.ip_country,
      }
    );
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
};
