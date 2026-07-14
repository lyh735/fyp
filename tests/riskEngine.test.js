const assert = require("assert");
const { evaluateTransaction } = require("../services/riskEngine");
const { SUPPORTED_RULE_TYPES } = require("../services/complianceRuleService");
const { getRiskLevel } = require("../services/riskScoring");

function rule(rule_type, overrides = {}) {
  return {
    rule_id: overrides.rule_id || 1,
    rule_type,
    rule_name: overrides.rule_name || rule_type,
    points: overrides.points ?? 10,
    threshold_value: overrides.threshold_value ?? null,
    threshold_count: overrides.threshold_count ?? null,
    time_window_seconds: overrides.time_window_seconds ?? null,
  };
}

const baseTxn = {
  transaction_id: "T1",
  merchant_id: "M1",
  amount: 100,
  currency: "SGD",
  transaction_type: "online",
  ip_address: "103.18.1.1",
  country: "Singapore",
  timestamp: "2026-05-12 10:00:00",
  customer_risk_profile: "high",
  status: "success",
  masked_card_number: "411111******1111",
};

const minimartMerchant = {
  merchant_id: "MINI1",
  mcc_code: "5411",
  business_category: "minimart",
  merchant_average_amount: 20,
  has_physical_location: 1,
  operating_hours_start: "00:00:00",
  operating_hours_end: "00:00:00",
};

const minimartMcc = {
  mcc_code: "5411",
  category_name: "Grocery stores",
  risk_level: "LOW",
  risk_points: 0,
  expected_min_amount: 2,
  expected_max_amount: 300,
  velocity_count: 8,
  velocity_window_seconds: 300,
  use_priority_multiplier: 1,
  priority_multiplier: 3,
};

const moneyServicesMcc = {
  mcc_code: "6051",
  category_name: "Money services / money orders",
  risk_level: "HIGH",
  risk_points: 15,
  expected_max_amount: 10000,
  velocity_count: 5,
  velocity_window_seconds: 300,
  use_priority_multiplier: 1,
  priority_multiplier: 3,
};

function evaluate(overrides = {}) {
  return evaluateTransaction(
    { ...baseTxn, ...(overrides.txn || {}) },
    {
      merchant: { ...minimartMerchant, ...(overrides.merchant || {}) },
      merchantCategoryRisk: overrides.merchantCategoryRisk ?? minimartMcc,
      paymentIdentifier: { type: "masked_card_number", value: baseTxn.masked_card_number },
      rules: overrides.rules || {},
      ...overrides.context,
    }
  );
}

function triggeredRule(result, ruleType) {
  return result.triggered_rules.find((item) => item.rule_type === ruleType);
}

const tests = [
  ["Test 1 - normal minimart transaction has no MCC-only score or alert", () => {
    const result = evaluate();
    assert.strictEqual(result.baseRuleScore, 0);
    assert.strictEqual(result.mccRiskPoints, 0);
    assert.strictEqual(result.officialRiskScore, 0);
    assert.strictEqual(result.risk_score, 0);
    assert.strictEqual(result.alert_required, false);
    assert.strictEqual(result.priorityMultiplier, 1);
  }],

  ["Test 2 - suspicious minimart scores only behavioural rule points", () => {
    const result = evaluate({
      txn: { amount: 400 },
      rules: {
        large_transaction: rule("large_transaction", { points: 25, threshold_value: 3 }),
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 2, time_window_seconds: 60 }),
      },
      context: { velocityCount: 2 },
    });
    assert.strictEqual(result.baseRuleScore, 50);
    assert.strictEqual(result.mccRiskPoints, 0);
    assert.strictEqual(result.officialRiskScore, 50);
    assert.strictEqual(result.priorityMultiplier, 1);
  }],

  ["Test 3 - suspicious money services uses additive MCC and optional priority", () => {
    const result = evaluate({
      txn: { amount: 6000 },
      merchant: { merchant_id: "MS1", mcc_code: "6051", business_category: "money services", merchant_average_amount: 1000, merchant_max_transaction_amount: 3000 },
      merchantCategoryRisk: moneyServicesMcc,
      rules: {
        large_transaction: rule("large_transaction", { points: 25, threshold_value: 3 }),
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 2, time_window_seconds: 60 }),
        merchant_category_risk: rule("merchant_category_risk", { points: 0 }),
      },
      context: { velocityCount: 2 },
    });
    assert.strictEqual(result.baseRuleScore, 50);
    assert.strictEqual(result.mccRiskPoints, 15);
    assert.strictEqual(result.officialRiskScore, 65);
    assert.strictEqual(result.risk_level, "High");
    assert.strictEqual(result.priorityMultiplier, 3);
    assert.strictEqual(result.priorityScore, 195);
  }],

  ["Test 4 - normal high-risk MCC transaction does not alert by itself", () => {
    const result = evaluate({
      merchant: { merchant_id: "MS1", mcc_code: "6051", business_category: "money services", merchant_average_amount: 1000 },
      merchantCategoryRisk: moneyServicesMcc,
      rules: { merchant_category_risk: rule("merchant_category_risk", { points: 0 }) },
    });
    assert.strictEqual(result.baseRuleScore, 0);
    assert.strictEqual(result.mccRiskPoints, 0);
    assert.strictEqual(result.officialRiskScore, 0);
    assert.strictEqual(result.alert_required, false);
    assert.strictEqual(result.priorityMultiplier, 1);
  }],

  ["Test 5 - disabled multiplier leaves official score and alert unchanged", () => {
    const enabled = evaluate({
      txn: { amount: 6000 },
      merchant: { merchant_id: "MS1", mcc_code: "6051", merchant_average_amount: 1000, merchant_max_transaction_amount: 3000 },
      merchantCategoryRisk: moneyServicesMcc,
      rules: {
        large_transaction: rule("large_transaction", { points: 25, threshold_value: 3 }),
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 2 }),
      },
      context: { velocityCount: 2 },
    });
    const disabled = evaluate({
      txn: { amount: 6000 },
      merchant: { merchant_id: "MS1", mcc_code: "6051", merchant_average_amount: 1000, merchant_max_transaction_amount: 3000 },
      merchantCategoryRisk: { ...moneyServicesMcc, use_priority_multiplier: 0 },
      rules: {
        large_transaction: rule("large_transaction", { points: 25, threshold_value: 3 }),
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 2 }),
      },
      context: { velocityCount: 2 },
    });
    assert.strictEqual(disabled.officialRiskScore, enabled.officialRiskScore);
    assert.strictEqual(disabled.risk_level, enabled.risk_level);
    assert.strictEqual(disabled.alert_required, enabled.alert_required);
    assert.strictEqual(disabled.priorityMultiplier, 1);
    assert.strictEqual(disabled.priorityScore, disabled.officialRiskScore);
  }],

  ["Test 6 - highest amount candidate scores once", () => {
    const result = evaluate({
      txn: { amount: 600 },
      rules: {
        large_transaction: rule("large_transaction", { points: 25, threshold_value: 3 }),
        merchant_average_deviation: rule("merchant_average_deviation", { points: 25, threshold_value: 5 }),
      },
    });
    assert.strictEqual(result.baseRuleScore, 25);
    assert.strictEqual(result.triggered_rules.filter((item) => ["large_transaction", "merchant_average_deviation"].includes(item.rule_type)).length, 1);
    assert.strictEqual(result.triggered_rules[0].evidence.matchedAmountTiers.length, 2);
    assert.strictEqual(result.triggered_rules[0].evidence.amountTierPolicy, "highest_applicable_amount_points_only");
  }],

  ["Test 7 - merchant maximum is preferred and MCC fallback is used", () => {
    const merchantThreshold = evaluate({
      txn: { amount: 100 },
      merchant: { merchant_average_amount: 20, merchant_max_transaction_amount: 80 },
      rules: { large_transaction: rule("large_transaction", { points: 25, threshold_value: 3 }) },
    });
    const mccThreshold = evaluate({
      txn: { amount: 350 },
      merchant: { merchant_average_amount: null },
      rules: { large_transaction: rule("large_transaction", { points: 25, threshold_value: 3 }) },
    });
    assert.strictEqual(merchantThreshold.triggered_rules[0].evidence.thresholdSource, "MERCHANT");
    assert.strictEqual(mccThreshold.triggered_rules[0].evidence.thresholdSource, "MCC");
  }],

  ["merchant-specific maximum is used before MCC expected maximum", () => {
    const result = evaluate({
      txn: { amount: 450 },
      merchant: { merchant_average_amount: 100, merchant_max_transaction_amount: 400 },
      merchantCategoryRisk: { ...minimartMcc, expected_max_amount: 300 },
      rules: { large_transaction: rule("large_transaction", { points: 25, threshold_value: 999 }) },
    });
    const amountRule = triggeredRule(result, "large_transaction");
    assert.ok(amountRule);
    assert.strictEqual(amountRule.evidence.thresholdSource, "MERCHANT");
    assert.strictEqual(amountRule.evidence.thresholdUsed, 400);
    assert.strictEqual(amountRule.evidence.merchantConfiguredMaximum, 400);
    assert.strictEqual(amountRule.evidence.mccExpectedMaximum, 300);
  }],

  ["merchant maximum missing uses MCC expected maximum", () => {
    const result = evaluate({
      txn: { amount: 350 },
      merchant: { merchant_average_amount: 100, merchant_max_transaction_amount: null },
      merchantCategoryRisk: { ...minimartMcc, expected_max_amount: 300 },
      rules: { large_transaction: rule("large_transaction", { points: 25, threshold_value: 999 }) },
    });
    const amountRule = triggeredRule(result, "large_transaction");
    assert.ok(amountRule);
    assert.strictEqual(amountRule.evidence.thresholdSource, "MCC");
    assert.strictEqual(amountRule.evidence.thresholdUsed, 300);
  }],

  ["merchant and MCC maximum missing uses general rule threshold", () => {
    const result = evaluate({
      txn: { amount: 700 },
      merchant: { merchant_average_amount: null, merchant_max_transaction_amount: null },
      merchantCategoryRisk: { ...minimartMcc, expected_max_amount: null },
      rules: { large_transaction: rule("large_transaction", { points: 25, threshold_value: 500 }) },
    });
    const amountRule = triggeredRule(result, "large_transaction");
    assert.ok(amountRule);
    assert.strictEqual(amountRule.evidence.thresholdSource, "GENERAL");
    assert.strictEqual(amountRule.evidence.thresholdUsed, 500);
  }],

  ["merchant average deviation and maximum threshold do not double-count", () => {
    const result = evaluate({
      txn: { amount: 600 },
      merchant: { merchant_average_amount: 100, merchant_max_transaction_amount: 400 },
      merchantCategoryRisk: { ...minimartMcc, expected_max_amount: 300 },
      rules: {
        large_transaction: rule("large_transaction", { points: 25, threshold_value: 500 }),
        merchant_average_deviation: rule("merchant_average_deviation", { points: 25, threshold_value: 5 }),
      },
    });
    assert.strictEqual(result.baseRuleScore, 25);
    assert.strictEqual(result.triggered_rules.filter((item) => ["large_transaction", "merchant_average_deviation"].includes(item.rule_type)).length, 1);
    assert.strictEqual(result.triggered_rules[0].rule_type, "merchant_average_deviation");
    assert.strictEqual(result.triggered_rules[0].evidence.matchedAmountTiers.length, 2);
  }],

  ["Test 8 - alert ordering uses priority score then newest first", () => {
    const alerts = [
      { alert_id: 1, priority_score: 60, created_at: "2026-05-12T10:00:00Z" },
      { alert_id: 2, priority_score: 180, created_at: "2026-05-12T09:00:00Z" },
      { alert_id: 3, priority_score: 180, created_at: "2026-05-12T11:00:00Z" },
    ];
    alerts.sort((a, b) => {
      const scoreDiff = (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    assert.deepStrictEqual(alerts.map((alert) => alert.alert_id), [3, 2, 1]);
  }],

  ["velocity plus repeated-small same set applies only higher score and preserves evidence", () => {
    const result = evaluate({
      txn: { amount: 5 },
      rules: {
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 5, time_window_seconds: 300 }),
        repeated_small_transactions: rule("repeated_small_transactions", { points: 20, threshold_value: 10, threshold_count: 5, time_window_seconds: 300 }),
      },
      context: { velocityCount: 5, smallTransactionCount: 5 },
    });
    assert.strictEqual(result.baseRuleScore, 25);
    assert.strictEqual(result.triggered_rules.length, 1);
    assert.strictEqual(result.triggered_rules[0].rule_type, "transaction_velocity");
    assert.strictEqual(result.triggered_rules[0].evidence.supportingObservations[0].rule_type, "repeated_small_transactions");
  }],

  ["velocity plus frequent-large same set applies only higher score and preserves evidence", () => {
    const result = evaluate({
      txn: { amount: 500 },
      rules: {
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 3, time_window_seconds: 60 }),
        frequent_large_transactions: rule("frequent_large_transactions", { points: 30, threshold_value: 3, threshold_count: 3, time_window_seconds: 60 }),
      },
      context: { velocityCount: 3, largeTransactionCount: 3 },
    });
    assert.strictEqual(result.baseRuleScore, 30);
    assert.strictEqual(result.triggered_rules.length, 1);
    assert.strictEqual(result.triggered_rules[0].rule_type, "frequent_large_transactions");
    assert.strictEqual(result.triggered_rules[0].evidence.supportingObservations[0].rule_type, "transaction_velocity");
  }],

  ["failed transactions trigger failed velocity only when general velocity count excludes them", () => {
    const result = evaluate({
      txn: { status: "DECLINED" },
      rules: {
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 3, time_window_seconds: 60 }),
        failed_attempt_velocity: rule("failed_attempt_velocity", { points: 15, threshold_count: 3, time_window_seconds: 600 }),
      },
      context: { velocityCount: 0, failedAttemptCount: 3 },
    });
    assert.strictEqual(result.baseRuleScore, 15);
    assert.ok(!triggeredRule(result, "transaction_velocity"));
    assert.ok(triggeredRule(result, "failed_attempt_velocity"));
  }],

  ["successful transactions trigger general velocity only", () => {
    const result = evaluate({
      txn: { status: "SUCCESS" },
      rules: {
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 3, time_window_seconds: 60 }),
        failed_attempt_velocity: rule("failed_attempt_velocity", { points: 15, threshold_count: 3, time_window_seconds: 600 }),
      },
      context: { velocityCount: 3, failedAttemptCount: 3 },
    });
    assert.strictEqual(result.baseRuleScore, 25);
    assert.ok(triggeredRule(result, "transaction_velocity"));
    assert.ok(!triggeredRule(result, "failed_attempt_velocity"));
  }],

  ["failure followed by success scores 30 and keeps failed-attempt evidence without stacking", () => {
    const result = evaluate({
      txn: { status: "SUCCESS" },
      rules: {
        failed_attempt_velocity: rule("failed_attempt_velocity", { points: 15, threshold_count: 3, time_window_seconds: 600 }),
        failure_then_success: rule("failure_then_success", { points: 30, threshold_count: 3, time_window_seconds: 600 }),
      },
      context: { failedAttemptCount: 3, previousFailureCount: 3 },
    });
    assert.strictEqual(result.baseRuleScore, 30);
    assert.ok(triggeredRule(result, "failure_then_success"));
    assert.ok(!triggeredRule(result, "failed_attempt_velocity"));
    assert.strictEqual(triggeredRule(result, "failure_then_success").evidence.supportingObservations[0].rule_type, "failed_attempt_velocity");
  }],

  ["customer risk rule is ignored by merchant-focused engine", () => {
    const result = evaluate({
      rules: {
        customer_risk: rule("customer_risk", { points: 99 }),
      },
    });
    assert.strictEqual(result.baseRuleScore, 0);
    assert.strictEqual(result.triggered_rules.length, 0);
    assert.strictEqual(SUPPORTED_RULE_TYPES.includes("customer_risk"), false);
  }],

  ["IP-country mismatch does not score when inactive or absent from active rules", () => {
    const result = evaluate({
      txn: { transaction_type: "online", country: "Singapore", ip_country: "Malaysia" },
      context: { ipCountryVerified: true },
      rules: {},
    });
    assert.strictEqual(result.baseRuleScore, 0);
    assert.ok(!triggeredRule(result, "ip_country_mismatch"));
  }],

  ["duplicate successful transaction scores when previous matching transaction exists", () => {
    const result = evaluate({
      txn: { status: "completed", amount: 100, currency: "SGD" },
      rules: {
        duplicate_payment_identifier: rule("duplicate_payment_identifier", { points: 25, threshold_count: 1, time_window_seconds: 60 }),
      },
      context: {
        duplicatePatternCount: 1,
        previousDuplicateTransaction: { transaction_id: "T0", txn_time: "2026-05-12 09:59:30" },
      },
    });
    assert.strictEqual(result.baseRuleScore, 25);
    assert.strictEqual(triggeredRule(result, "duplicate_payment_identifier").evidence.previous_transaction_id, "T0");
  }],

  ["daily count and short-term velocity both score when windows are distinct", () => {
    const result = evaluate({
      rules: {
        transaction_velocity: rule("transaction_velocity", { points: 25, threshold_count: 3, time_window_seconds: 60 }),
        daily_transaction_count_spike: rule("daily_transaction_count_spike", { points: 15, threshold_count: 100 }),
      },
      context: {
        velocityCount: 3,
        dailyTransactionCount: 150,
        dailyCountThreshold: 100,
        dailyCountThresholdSource: "MERCHANT",
      },
    });
    assert.strictEqual(result.baseRuleScore, 40);
    assert.ok(triggeredRule(result, "transaction_velocity"));
    assert.ok(triggeredRule(result, "daily_transaction_count_spike"));
  }],

  ["daily count spike uses merchant historical threshold", () => {
    const result = evaluate({
      rules: {
        daily_transaction_count_spike: rule("daily_transaction_count_spike", { points: 15, threshold_count: 50 }),
      },
      context: {
        dailyTransactionCount: 21,
        dailyCountThreshold: 20,
        dailyCountThresholdSource: "MERCHANT",
      },
    });
    const spike = triggeredRule(result, "daily_transaction_count_spike");
    assert.strictEqual(result.baseRuleScore, 15);
    assert.strictEqual(spike.evidence.thresholdUsed, 20);
    assert.strictEqual(spike.evidence.thresholdSource, "MERCHANT");
  }],

  ["daily count spike uses MCC fallback threshold", () => {
    const result = evaluate({
      rules: {
        daily_transaction_count_spike: rule("daily_transaction_count_spike", { points: 15, threshold_count: 50 }),
      },
      context: {
        dailyTransactionCount: 31,
        dailyCountThreshold: 30,
        dailyCountThresholdSource: "MCC",
      },
    });
    const spike = triggeredRule(result, "daily_transaction_count_spike");
    assert.strictEqual(result.baseRuleScore, 15);
    assert.strictEqual(spike.evidence.thresholdUsed, 30);
    assert.strictEqual(spike.evidence.thresholdSource, "MCC");
  }],

  ["daily count spike uses general fallback threshold", () => {
    const result = evaluate({
      rules: {
        daily_transaction_count_spike: rule("daily_transaction_count_spike", { points: 15, threshold_count: 50 }),
      },
      context: {
        dailyTransactionCount: 51,
        dailyCountThreshold: 50,
        dailyCountThresholdSource: "GENERAL",
      },
    });
    const spike = triggeredRule(result, "daily_transaction_count_spike");
    assert.strictEqual(result.baseRuleScore, 15);
    assert.strictEqual(spike.evidence.thresholdUsed, 50);
    assert.strictEqual(spike.evidence.thresholdSource, "GENERAL");
  }],

  ["daily value and frequent-large both score when windows are distinct", () => {
    const result = evaluate({
      txn: { amount: 500 },
      rules: {
        frequent_large_transactions: rule("frequent_large_transactions", { points: 30, threshold_value: 3, threshold_count: 3, time_window_seconds: 60 }),
        daily_transaction_value_spike: rule("daily_transaction_value_spike", { points: 20, threshold_value: 10000 }),
      },
      context: {
        largeTransactionCount: 3,
        dailyTransactionValue: 15000,
        dailyValueThreshold: 10000,
        dailyValueThresholdSource: "MERCHANT",
      },
    });
    assert.strictEqual(result.baseRuleScore, 50);
    assert.ok(triggeredRule(result, "frequent_large_transactions"));
    assert.ok(triggeredRule(result, "daily_transaction_value_spike"));
  }],

  ["daily value spike uses merchant historical threshold", () => {
    const result = evaluate({
      rules: {
        daily_transaction_value_spike: rule("daily_transaction_value_spike", { points: 20, threshold_value: 25000 }),
      },
      context: {
        dailyTransactionValue: 12001,
        dailyValueThreshold: 12000,
        dailyValueThresholdSource: "MERCHANT",
      },
    });
    const spike = triggeredRule(result, "daily_transaction_value_spike");
    assert.strictEqual(result.baseRuleScore, 20);
    assert.strictEqual(spike.evidence.thresholdUsed, 12000);
    assert.strictEqual(spike.evidence.thresholdSource, "MERCHANT");
  }],

  ["daily value spike uses MCC fallback threshold", () => {
    const result = evaluate({
      rules: {
        daily_transaction_value_spike: rule("daily_transaction_value_spike", { points: 20, threshold_value: 25000 }),
      },
      context: {
        dailyTransactionValue: 30001,
        dailyValueThreshold: 30000,
        dailyValueThresholdSource: "MCC",
      },
    });
    const spike = triggeredRule(result, "daily_transaction_value_spike");
    assert.strictEqual(result.baseRuleScore, 20);
    assert.strictEqual(spike.evidence.thresholdUsed, 30000);
    assert.strictEqual(spike.evidence.thresholdSource, "MCC");
  }],

  ["daily value spike uses general fallback threshold", () => {
    const result = evaluate({
      rules: {
        daily_transaction_value_spike: rule("daily_transaction_value_spike", { points: 20, threshold_value: 25000 }),
      },
      context: {
        dailyTransactionValue: 25001,
        dailyValueThreshold: 25000,
        dailyValueThresholdSource: "GENERAL",
      },
    });
    const spike = triggeredRule(result, "daily_transaction_value_spike");
    assert.strictEqual(result.baseRuleScore, 20);
    assert.strictEqual(spike.evidence.thresholdUsed, 25000);
    assert.strictEqual(spike.evidence.thresholdSource, "GENERAL");
  }],

  ["repeated identical amounts scores across different payment identifiers", () => {
    const result = evaluate({
      txn: { amount: 9.9 },
      rules: {
        repeated_identical_amounts: rule("repeated_identical_amounts", { points: 15, threshold_count: 4, time_window_seconds: 300 }),
      },
      context: {
        repeatedIdenticalAmountCount: 4,
        repeatedIdenticalDistinctIdentifierCount: 4,
        repeatedIdenticalSameIdentifierCount: 1,
      },
    });
    const identical = triggeredRule(result, "repeated_identical_amounts");
    assert.strictEqual(result.baseRuleScore, 15);
    assert.strictEqual(identical.evidence.distinct_identifier_count, 4);
    assert.strictEqual(identical.evidence.merchant_id, "M1");
  }],

  ["duplicate payment identifier remains separate when repeated identical threshold is not met", () => {
    const result = evaluate({
      txn: { status: "completed", amount: 100, currency: "SGD" },
      rules: {
        duplicate_payment_identifier: rule("duplicate_payment_identifier", { points: 25, threshold_count: 1, time_window_seconds: 60 }),
        repeated_identical_amounts: rule("repeated_identical_amounts", { points: 15, threshold_count: 4, time_window_seconds: 300 }),
      },
      context: {
        duplicatePatternCount: 1,
        previousDuplicateTransaction: { transaction_id: "T0", txn_time: "2026-05-12 09:59:30" },
        repeatedIdenticalAmountCount: 2,
        repeatedIdenticalDistinctIdentifierCount: 1,
      },
    });
    assert.strictEqual(result.baseRuleScore, 25);
    assert.ok(triggeredRule(result, "duplicate_payment_identifier"));
    assert.ok(!triggeredRule(result, "repeated_identical_amounts"));
  }],

  ["repeated identical amount overlap with repeated small keeps only small score", () => {
    const result = evaluate({
      txn: { amount: 5 },
      rules: {
        repeated_small_transactions: rule("repeated_small_transactions", { points: 20, threshold_value: 10, threshold_count: 4, time_window_seconds: 300 }),
        repeated_identical_amounts: rule("repeated_identical_amounts", { points: 15, threshold_count: 4, time_window_seconds: 300 }),
      },
      context: {
        smallTransactionCount: 4,
        repeatedIdenticalAmountCount: 4,
        repeatedIdenticalDistinctIdentifierCount: 4,
      },
    });
    const small = triggeredRule(result, "repeated_small_transactions");
    assert.strictEqual(result.baseRuleScore, 20);
    assert.ok(small);
    assert.ok(!triggeredRule(result, "repeated_identical_amounts"));
    assert.strictEqual(small.evidence.supportingObservations[0].rule_type, "repeated_identical_amounts");
  }],

  ["repeated identical same-identifier overlap is suppressed by duplicate payment identifier", () => {
    const result = evaluate({
      txn: { status: "completed", amount: 100, currency: "SGD" },
      rules: {
        duplicate_payment_identifier: rule("duplicate_payment_identifier", { points: 25, threshold_count: 1, time_window_seconds: 60 }),
        repeated_identical_amounts: rule("repeated_identical_amounts", { points: 15, threshold_count: 4, time_window_seconds: 300 }),
      },
      context: {
        duplicatePatternCount: 1,
        previousDuplicateTransaction: { transaction_id: "T0", txn_time: "2026-05-12 09:59:30" },
        repeatedIdenticalAmountCount: 4,
        repeatedIdenticalDistinctIdentifierCount: 1,
        repeatedIdenticalSameIdentifierCount: 4,
      },
    });
    const duplicate = triggeredRule(result, "duplicate_payment_identifier");
    assert.strictEqual(result.baseRuleScore, 25);
    assert.ok(duplicate);
    assert.ok(!triggeredRule(result, "repeated_identical_amounts"));
    assert.strictEqual(duplicate.evidence.supportingObservations[0].rule_type, "repeated_identical_amounts");
  }],

  ["MCC remains added once only", () => {
    const result = evaluate({
      merchant: { merchant_id: "MS1", mcc_code: "6051", merchant_average_amount: 1000 },
      merchantCategoryRisk: moneyServicesMcc,
      rules: {
        transaction_velocity: rule("transaction_velocity", { points: 45, threshold_count: 3, time_window_seconds: 60 }),
        merchant_category_risk: rule("merchant_category_risk", { points: 999 }),
      },
      context: { velocityCount: 3 },
    });
    assert.strictEqual(result.baseRuleScore, 45);
    assert.strictEqual(result.mccRiskPoints, 15);
    assert.strictEqual(result.officialRiskScore, 60);
    assert.strictEqual(result.triggered_rules.filter((item) => item.rule_type === "merchant_category_risk").length, 1);
  }],

  ["priority multiplier remains separate from official risk", () => {
    const result = evaluate({
      merchant: { merchant_id: "MS1", mcc_code: "6051", merchant_average_amount: 1000 },
      merchantCategoryRisk: moneyServicesMcc,
      rules: {
        transaction_velocity: rule("transaction_velocity", { points: 45, threshold_count: 3, time_window_seconds: 60 }),
      },
      context: { velocityCount: 3 },
    });
    assert.strictEqual(result.officialRiskScore, 60);
    assert.strictEqual(result.risk_level, "High");
    assert.strictEqual(result.priorityMultiplier, 3);
    assert.strictEqual(result.priorityScore, 180);
    assert.strictEqual(result.risk_score, 60);
  }],

  ["required rules exclude high-risk jurisdiction and cancellation velocity", () => {
    assert.strictEqual(SUPPORTED_RULE_TYPES.includes("high_risk_jurisdiction"), false);
    assert.strictEqual(SUPPORTED_RULE_TYPES.includes("cancellation_velocity"), false);
  }],

  ["risk level boundaries remain the existing project ranges", () => {
    assert.deepStrictEqual([0, 29, 30, 59, 60, 89, 90].map(getRiskLevel), ["Low", "Low", "Medium", "Medium", "High", "High", "Critical"]);
  }],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

console.log(`${passed} risk engine tests passed`);
