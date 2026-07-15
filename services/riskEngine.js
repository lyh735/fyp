const net = require("net");
const { getRiskLevel, getTransactionStatus } = require("./riskScoring");

const FAILED_ATTEMPT_STATUSES = Object.freeze(["failed", "declined"]);
const SUCCESS_STATUSES = Object.freeze(["success", "completed"]);
const ALERT_RISK_LEVELS = Object.freeze(["Medium", "High", "Critical"]);
const HIGH_PRIORITY_MCC_LEVELS = Object.freeze(["HIGH", "VERY_HIGH"]);

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
  if (startMinutes === endMinutes) return false;

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

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getRule(rules, ...types) {
  for (const type of types) {
    if (rules[type]) return rules[type];
  }
  return null;
}

function resolveAmountThreshold(txn, merchant, mccProfile, rule, defaultMultiplier = 3) {
  const amount = Number(txn.amount) || 0;
  const merchantAverage = positiveNumber(merchant.merchant_average_amount);
  const merchantConfiguredMaximum = getMerchantConfiguredMaximum(merchant);
  const mccExpectedMax = positiveNumber(mccProfile?.expected_max_amount);
  const configuredThreshold = positiveNumber(rule?.threshold_value);

  if (merchantConfiguredMaximum) {
    return {
      thresholdUsed: merchantConfiguredMaximum,
      thresholdSource: "MERCHANT",
      merchantAverage,
      merchantConfiguredMaximum,
      mccExpectedMax,
      multiplier: null,
      currentAmount: amount,
    };
  }

  if (mccExpectedMax) {
    return {
      thresholdUsed: mccExpectedMax,
      thresholdSource: "MCC",
      merchantAverage,
      merchantConfiguredMaximum,
      mccExpectedMax,
      multiplier: null,
      currentAmount: amount,
    };
  }

  return {
    thresholdUsed: configuredThreshold || 0,
    thresholdSource: "GENERAL",
    merchantAverage,
    merchantConfiguredMaximum,
    mccExpectedMax,
    multiplier: null,
    currentAmount: amount,
  };
}

function resolveVelocityThreshold(rule, mccProfile, fallbackCount) {
  return Number(rule?.threshold_count || 0) || Number(mccProfile?.velocity_count || 0) || fallbackCount;
}

function resolveWindowSeconds(rule, mccProfile, fallbackSeconds) {
  return Number(rule?.time_window_seconds || 0) || Number(mccProfile?.velocity_window_seconds || 0) || fallbackSeconds;
}

function isHighRiskMcc(mccProfile) {
  return HIGH_PRIORITY_MCC_LEVELS.includes(String(mccProfile?.risk_level || "").trim().toUpperCase());
}

function rulePoints(rule) {
  return Math.max(0, Number(rule?.points || 0));
}

function getMerchantConfiguredMaximum(merchant = {}) {
  return (
    positiveNumber(merchant.merchant_max_transaction_amount) ||
    positiveNumber(merchant.configured_max_amount) ||
    positiveNumber(merchant.expected_max_amount) ||
    positiveNumber(merchant.max_transaction_amount) ||
    null
  );
}

function selectHighestObservation(observations) {
  return observations
    .filter(Boolean)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return Number(b.evidence?.thresholdUsed || 0) - Number(a.evidence?.thresholdUsed || 0);
    })[0] || null;
}

function sameTransactionSetAndWindow(a, b) {
  if (!a || !b) return false;
  return (
    Number(a.evidence?.actual_count || 0) === Number(b.evidence?.actual_count || 0) &&
    Number(a.evidence?.window_seconds || 0) === Number(b.evidence?.window_seconds || 0) &&
    String(a.evidence?.payment_identifier_type || "") === String(b.evidence?.payment_identifier_type || "")
  );
}

function mergeOverlappingObservations(observations, overlapPolicy) {
  const selected = selectHighestObservation(observations);
  if (!selected) return null;

  const supportingObservations = observations
    .filter((item) => item && item !== selected)
    .map((item) => ({
      rule_type: item.rule.rule_type,
      rule_name: item.rule.rule_name,
      points_not_added: item.points,
      message: item.message,
      evidence: item.evidence,
    }));

  return {
    ...selected,
    evidence: {
      ...selected.evidence,
      overlapPolicy,
      supportingObservations,
    },
  };
}

function appendSupportingObservation(triggeredRules, preferredRuleTypes, observation, overlapPolicy) {
  const target = triggeredRules.find((item) => preferredRuleTypes.includes(item.rule_type));
  if (!target) return;
  target.evidence = {
    ...target.evidence,
    overlapPolicy: target.evidence?.overlapPolicy || overlapPolicy,
    supportingObservations: [
      ...(target.evidence?.supportingObservations || []),
      observation,
    ],
  };
}

function evaluateTransaction(txn, context = {}) {
  let baseRuleScore = 0;
  const triggered_rules = [];
  const scoredGroups = new Set();
  const merchant = context.merchant || {};
  const rules = context.rules || {};
  const paymentIdentifier = context.paymentIdentifier || null;
  const merchantCategoryRisk = context.merchantCategoryRisk || null;

  function addBaseRule(group, rule, message, evidence = {}, pointsOverride = null) {
    if (group && scoredGroups.has(group)) return 0;
    const added = addTriggeredRule(triggered_rules, rule, message, evidence, pointsOverride);
    if (added > 0) {
      baseRuleScore += added;
      if (group) scoredGroups.add(group);
    }
    return added;
  }

  const amountRule = getRule(rules, "large_transaction", "amount_multiplier");
  const merchantAverageAmount = Number(merchant.merchant_average_amount) || 0;
  const merchantConfiguredMaximum = getMerchantConfiguredMaximum(merchant);
  const amountCandidates = [];
  const amountThreshold = resolveAmountThreshold(txn, merchant, merchantCategoryRisk, amountRule, 3);
  if (amountRule && amountThreshold.thresholdUsed > 0 && Number(txn.amount) > amountThreshold.thresholdUsed) {
    amountCandidates.push({
      rule: amountRule,
      message: "Transaction amount exceeded the applicable merchant or MCC threshold",
      points: rulePoints(amountRule),
      evidence: {
        currentAmount: Number(txn.amount),
        merchantAverage: amountThreshold.merchantAverage,
        merchantConfiguredMaximum: amountThreshold.merchantConfiguredMaximum,
        mccExpectedMaximum: amountThreshold.mccExpectedMax,
        thresholdUsed: amountThreshold.thresholdUsed,
        thresholdSource: amountThreshold.thresholdSource,
        configuredMultiplier: amountThreshold.multiplier,
        matchedSeverityTier: amountThreshold.multiplier
          ? `above_${amountThreshold.multiplier}x_${amountThreshold.thresholdSource.toLowerCase()}_threshold`
          : `above_${amountThreshold.thresholdSource.toLowerCase()}_threshold`,
      },
    });
  }

  const deviationRule = getRule(rules, "merchant_average_deviation");
  const deviationMultiplier = configuredNumber(deviationRule?.threshold_value, 5);
  if (
    deviationRule &&
    merchantAverageAmount > 0 &&
    deviationMultiplier > 0 &&
    Number(txn.amount) > merchantAverageAmount * deviationMultiplier
  ) {
    amountCandidates.push({
      rule: deviationRule,
      message: "Transaction amount significantly deviated from merchant average",
      points: rulePoints(deviationRule),
      evidence: {
      currentAmount: Number(txn.amount),
      merchantAverage: merchantAverageAmount,
      merchantConfiguredMaximum,
      mccExpectedMaximum: positiveNumber(merchantCategoryRisk?.expected_max_amount),
      thresholdUsed: merchantAverageAmount * deviationMultiplier,
      thresholdSource: "MERCHANT",
      configuredMultiplier: deviationMultiplier,
      matchedSeverityTier: `above_${deviationMultiplier}x_merchant_average`,
      },
    });
  }

  const selectedAmount = selectHighestObservation(amountCandidates);
  if (selectedAmount) {
    addBaseRule("amount_anomaly", selectedAmount.rule, selectedAmount.message, {
      ...selectedAmount.evidence,
      amountTierPolicy: "highest_applicable_amount_points_only",
      matchedAmountTiers: amountCandidates.map((candidate) => ({
        rule_type: candidate.rule.rule_type,
        rule_name: candidate.rule.rule_name,
        points: candidate.points,
        thresholdUsed: candidate.evidence.thresholdUsed,
        thresholdSource: candidate.evidence.thresholdSource,
        matchedSeverityTier: candidate.evidence.matchedSeverityTier,
        selected: candidate === selectedAmount,
      })),
    }, selectedAmount.points);
  }

  const velocityRule = getRule(rules, "transaction_velocity", "velocity");
  const velocityThreshold = resolveVelocityThreshold(velocityRule, merchantCategoryRisk, 0);
  const velocityObservations = [];
  if (velocityRule && velocityThreshold > 0 && Number(context.velocityCount || 0) >= velocityThreshold) {
    velocityObservations.push({
      group: "transaction_velocity",
      rule: velocityRule,
      message: "High transaction velocity for the same payment identifier",
      points: rulePoints(velocityRule),
      evidence: {
        actual_count: Number(context.velocityCount || 0),
        required_count: velocityThreshold,
        window_seconds: resolveWindowSeconds(velocityRule, merchantCategoryRisk, 60),
        payment_identifier_type: paymentIdentifier?.type || null,
        excluded_statuses: FAILED_ATTEMPT_STATUSES,
      },
    });
  }

  const smallRule = getRule(rules, "repeated_small_transactions", "velocity_small_amount");
  const smallThreshold = Number(smallRule?.threshold_count || 0);
  if (smallRule && smallThreshold > 0 && Number(context.smallTransactionCount || 0) >= smallThreshold) {
    velocityObservations.push({
      group: "small_transaction_pattern",
      rule: smallRule,
      message: "Repeated small-value payment-testing pattern detected",
      points: rulePoints(smallRule),
      evidence: {
        actual_count: Number(context.smallTransactionCount || 0),
        required_count: smallThreshold,
        amount_below: Number(context.smallAmountLimit || smallRule.threshold_value || merchantCategoryRisk?.expected_min_amount || 0),
        window_seconds: resolveWindowSeconds(smallRule, merchantCategoryRisk, 300),
        payment_identifier_type: paymentIdentifier?.type || null,
      },
    });
  }

  const largeRule = getRule(rules, "frequent_large_transactions", "large_amount_frequency");
  const largeThreshold = Number(largeRule?.threshold_count || 0);
  if (largeRule && largeThreshold > 0 && Number(context.largeTransactionCount || 0) >= largeThreshold) {
    velocityObservations.push({
      group: "frequent_large_transactions",
      rule: largeRule,
      message: "Repeated unusually large transactions detected",
      points: rulePoints(largeRule),
      evidence: {
        actual_count: Number(context.largeTransactionCount || 0),
        required_count: largeThreshold,
        configured_multiplier: Number(largeRule.threshold_value || 0),
        merchant_average_amount: merchantAverageAmount || null,
        mcc_expected_maximum: positiveNumber(merchantCategoryRisk?.expected_max_amount),
        window_seconds: resolveWindowSeconds(largeRule, merchantCategoryRisk, 1800),
        payment_identifier_type: paymentIdentifier?.type || null,
      },
    });
  }

  const velocityObservation = velocityObservations.find((item) => item.group === "transaction_velocity");
  const smallObservation = velocityObservations.find((item) => item.group === "small_transaction_pattern");
  const largeObservation = velocityObservations.find((item) => item.group === "frequent_large_transactions");
  const addedVelocityObservations = new Set();

  if (sameTransactionSetAndWindow(velocityObservation, smallObservation)) {
    const merged = mergeOverlappingObservations(
      [velocityObservation, smallObservation],
      "transaction_velocity_and_repeated_small_same_set_same_window_highest_points_only"
    );
    addBaseRule(merged.group, merged.rule, merged.message, merged.evidence, merged.points);
    addedVelocityObservations.add(velocityObservation);
    addedVelocityObservations.add(smallObservation);
  }

  if (!addedVelocityObservations.has(velocityObservation) && sameTransactionSetAndWindow(velocityObservation, largeObservation)) {
    const merged = mergeOverlappingObservations(
      [velocityObservation, largeObservation],
      "transaction_velocity_and_frequent_large_same_set_same_window_highest_points_only"
    );
    addBaseRule(merged.group, merged.rule, merged.message, merged.evidence, merged.points);
    addedVelocityObservations.add(velocityObservation);
    addedVelocityObservations.add(largeObservation);
  }

  for (const observation of velocityObservations) {
    if (!addedVelocityObservations.has(observation)) {
      addBaseRule(observation.group, observation.rule, observation.message, observation.evidence, observation.points);
    }
  }

  const failedRule = getRule(rules, "failed_attempt_velocity");
  const failedThreshold = Number(failedRule?.threshold_count || 0);
  if (
    failedRule &&
    failedThreshold > 0 &&
    isFailedAttemptStatus(txn.status) &&
    Number(context.failedAttemptCount || 0) >= failedThreshold
  ) {
    addBaseRule("failed_attempt_velocity", failedRule, "Repeated failed or declined payment attempts detected", {
      actual_count: Number(context.failedAttemptCount || 0),
      required_count: failedThreshold,
      window_seconds: Number(failedRule.time_window_seconds || 0),
      current_status: normalizeStatus(txn.status),
      counted_statuses: FAILED_ATTEMPT_STATUSES,
      payment_identifier_type: paymentIdentifier?.type || null,
    });
  }

  const failureThenSuccessRule = getRule(rules, "failure_then_success");
  const failureThenSuccessThreshold = Number(failureThenSuccessRule?.threshold_count || 0);
  if (
    failureThenSuccessRule &&
    failureThenSuccessThreshold > 0 &&
    isSuccessStatus(txn.status) &&
    Number(context.previousFailureCount || 0) >= failureThenSuccessThreshold
  ) {
    addBaseRule("failure_then_success", failureThenSuccessRule, "Failed attempts were followed by a successful payment", {
      previous_failure_count: Number(context.previousFailureCount || 0),
      required_failure_count: failureThenSuccessThreshold,
      window_seconds: Number(failureThenSuccessRule.time_window_seconds || 0),
      payment_identifier_type: paymentIdentifier?.type || null,
      overlapPolicy: "failure_then_success_replaces_failed_attempt_velocity_for_same_failed_sequence",
      supportingObservations: failedRule ? [{
        rule_type: failedRule.rule_type,
        rule_name: failedRule.rule_name,
        points_not_added: rulePoints(failedRule),
        evidence: {
          actual_count: Number(context.previousFailureCount || 0),
          required_count: Number(failedRule.threshold_count || 0),
          window_seconds: Number(failedRule.time_window_seconds || 0),
          counted_statuses: FAILED_ATTEMPT_STATUSES,
          payment_identifier_type: paymentIdentifier?.type || null,
        },
      }] : [],
    });
  }

  const duplicateRule = getRule(rules, "duplicate_payment_identifier", "duplicate_transaction");
  let duplicateScored = false;
  if (duplicateRule && Number(context.duplicatePatternCount || 0) > 0) {
    duplicateScored = addBaseRule("duplicate_payment_identifier", duplicateRule, "Payment identifier was reused where a unique reference was expected", {
      matching_previous_transactions: Number(context.duplicatePatternCount || 0),
      previous_transaction_id: context.previousDuplicateTransaction?.transaction_id || null,
      previous_transaction_time: context.previousDuplicateTransaction?.txn_time || null,
      actual_amount: Number(txn.amount),
      currency: txn.currency,
      window_seconds: Number(duplicateRule.time_window_seconds || 0),
      payment_identifier_type: paymentIdentifier?.type || null,
    }) > 0;
  }

  const identicalRule = getRule(rules, "repeated_identical_amounts");
  const identicalCount = Number(context.repeatedIdenticalAmountCount || 0);
  const identicalThreshold = Number(identicalRule?.threshold_count || 0);
  const distinctIdentifierCount = Number(context.repeatedIdenticalDistinctIdentifierCount || 0);
  const identicalEvidence = {
    actual_count: identicalCount,
    required_count: identicalThreshold,
    amount: Number(txn.amount),
    amount_tolerance: 0.01,
    window_seconds: Number(identicalRule?.time_window_seconds || 0),
    merchant_id: txn.merchant_id || merchant.merchant_id || null,
    distinct_identifier_count: distinctIdentifierCount,
    same_identifier_count: Number(context.repeatedIdenticalSameIdentifierCount || 0),
    payment_identifier_type: paymentIdentifier?.type || null,
  };
  if (
    identicalRule &&
    identicalThreshold > 0 &&
    identicalCount >= identicalThreshold &&
    !smallObservation
  ) {
    if (duplicateScored && distinctIdentifierCount <= 1) {
      appendSupportingObservation(
        triggered_rules,
        ["duplicate_payment_identifier"],
        {
          rule_type: identicalRule.rule_type,
          rule_name: identicalRule.rule_name,
          points_not_added: rulePoints(identicalRule),
          message: "Repeated identical amount pattern uses the same payment identifier as the duplicate rule",
          evidence: identicalEvidence,
        },
        "duplicate_payment_identifier_takes_priority_for_same_identifier_repeats"
      );
    } else {
      addBaseRule("identical_amount_pattern", identicalRule, "Repeated exact or near-identical amounts detected for the same merchant", identicalEvidence);
    }
  } else if (
    identicalRule &&
    identicalThreshold > 0 &&
    identicalCount >= identicalThreshold &&
    smallObservation
  ) {
    appendSupportingObservation(
      triggered_rules,
      ["repeated_small_transactions", "transaction_velocity"],
      {
        rule_type: identicalRule.rule_type,
        rule_name: identicalRule.rule_name,
        points_not_added: rulePoints(identicalRule),
        message: "Repeated identical amount pattern overlaps with repeated small transactions",
        evidence: identicalEvidence,
      },
      "repeated_small_transactions_takes_priority_over_repeated_identical_amounts_for_same_small_set"
    );
  }

  const countSpikeRule = getRule(rules, "daily_transaction_count_spike");
  if (countSpikeRule && Number(context.dailyTransactionCount || 0) > Number(context.dailyCountThreshold || 0) && Number(context.dailyCountThreshold || 0) > 0) {
    addBaseRule("daily_count_spike", countSpikeRule, "Daily transaction count exceeded merchant or MCC baseline", {
      actualDailyCount: Number(context.dailyTransactionCount || 0),
      thresholdUsed: Number(context.dailyCountThreshold || 0),
      thresholdSource: context.dailyCountThresholdSource || "GENERAL",
    });
  }

  const valueSpikeRule = getRule(rules, "daily_transaction_value_spike");
  if (valueSpikeRule && Number(context.dailyTransactionValue || 0) > Number(context.dailyValueThreshold || 0) && Number(context.dailyValueThreshold || 0) > 0) {
    addBaseRule("daily_value_spike", valueSpikeRule, "Daily transaction value exceeded merchant or MCC baseline", {
      actualDailyValue: Number(context.dailyTransactionValue || 0),
      thresholdUsed: Number(context.dailyValueThreshold || 0),
      thresholdSource: context.dailyValueThresholdSource || "GENERAL",
    });
  }

  const timeRule = getRule(rules, "outside_operating_hours", "time");
  if (timeRule && isOutsideMerchantOperatingHours(txn.timestamp, merchant, txn.transaction_type)) {
    addBaseRule("outside_operating_hours", timeRule, "Face-to-face transaction occurred outside merchant operating hours", {
      transaction_time: txn.timestamp,
      operating_hours_start: merchant.operating_hours_start,
      operating_hours_end: merchant.operating_hours_end,
      timezone_assumption: "Asia/Singapore",
    });
  }

  const dataQualityRule = getRule(rules, "data_quality");
  if (dataQualityRule && context.missingRequiredInfo) {
    addBaseRule("data_quality", dataQualityRule, "Transaction is missing useful monitoring references", {
      missing_monitoring_identifiers: ["masked_card_number", "masked_payment_ref", "terminal_id", "payment_gateway_ref"],
    });
  }

  const ipRule = getRule(rules, "ip_validation");
  if (ipRule && hasInvalidIp(txn)) {
    addBaseRule("ip_validation", ipRule, "Online transaction has missing or invalid IP information", {
      ip_address: txn.ip_address || null,
      transaction_type: txn.transaction_type,
    });
  }

  const mismatchRule = getRule(rules, "ip_country_mismatch");
  if (mismatchRule && hasIpCountryMismatch(txn, context)) {
    addBaseRule("ip_country_mismatch", mismatchRule, "Verified IP country does not match transaction country", {
      transaction_country: txn.country,
      ip_country: txn.ip_country,
      ip_country_verified: Boolean(context.ipCountryVerified),
    });
  }

  const hasNonMccSuspiciousRule = triggered_rules.length > 0;
  const mccRiskPoints = hasNonMccSuspiciousRule
    ? Math.max(0, Number(merchantCategoryRisk?.risk_points ?? merchantCategoryRisk?.points ?? 0) || 0)
    : 0;
  const officialRiskScore = baseRuleScore + mccRiskPoints;
  const displayedRiskScore = Math.min(officialRiskScore, 100);
  const risk_level = getRiskLevel(officialRiskScore);
  const status = getTransactionStatus(risk_level);
  const alert_required = ALERT_RISK_LEVELS.includes(risk_level);
  const priorityMultiplier =
    alert_required &&
    hasNonMccSuspiciousRule &&
    isHighRiskMcc(merchantCategoryRisk) &&
    Number(merchantCategoryRisk?.use_priority_multiplier) === 1
      ? Math.max(1, Number(merchantCategoryRisk?.priority_multiplier || 3) || 3)
      : 1;
  const priorityScore = officialRiskScore * priorityMultiplier;

  if (mccRiskPoints > 0) {
    triggered_rules.push({
      rule_id: getRule(rules, "merchant_category_risk", "merchant_profile")?.rule_id || null,
      rule_type: "merchant_category_risk",
      rule_name: "Merchant MCC risk points",
      points: mccRiskPoints,
      message: `MCC risk points applied: ${merchantCategoryRisk.category_name}`,
      evidence: {
        merchantMcc: merchant.mcc_code || null,
        matchedMcc: merchantCategoryRisk.mcc_code || null,
        category: merchantCategoryRisk.category_name || null,
        riskLevel: merchantCategoryRisk.risk_level || null,
        appliedOnce: true,
      },
    });
  }

  return {
    baseRuleScore,
    base_rule_score: baseRuleScore,
    mccRiskPoints,
    mcc_risk_points: mccRiskPoints,
    officialRiskScore,
    official_risk_score: officialRiskScore,
    rawRiskScore: officialRiskScore,
    raw_risk_score: officialRiskScore,
    displayedRiskScore,
    displayed_risk_score: displayedRiskScore,
    priorityMultiplier,
    priority_multiplier: priorityMultiplier,
    priorityScore,
    priority_score: priorityScore,
    mcc: {
      code: merchantCategoryRisk?.mcc_code || merchant.mcc_code || null,
      category: merchantCategoryRisk?.category_name || null,
      riskLevel: merchantCategoryRisk?.risk_level || null,
    },
    risk_score: displayedRiskScore,
    risk_level,
    status,
    triggered_rules,
    triggeredRules: triggered_rules,
    alert_required,
    alert_status: alert_required ? "Pending" : null,
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
