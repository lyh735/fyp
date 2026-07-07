const assert = require("assert");
const { evaluateTransaction } = require("../services/riskEngine");
const { SUPPORTED_RULE_TYPES } = require("../services/complianceRuleService");
const { getRiskLevel } = require("../services/riskScoring");

function rule(rule_type, overrides = {}) {
  return {
    rule_id: overrides.rule_id || Object.keys(overrides).length + 1,
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
  customer_risk_profile: "low",
  status: "success",
  masked_card_number: "411111******1111",
};

const merchant = {
  merchant_id: "M1",
  mcc_code: "5812",
  business_category: "restaurant",
  merchant_average_amount: 50,
  has_physical_location: 1,
  operating_hours_start: "09:00:00",
  operating_hours_end: "22:00:00",
  merchant_risk_score: 80,
};

function evaluate(overrides = {}) {
  return evaluateTransaction(
    { ...baseTxn, ...(overrides.txn || {}) },
    {
      merchant: { ...merchant, ...(overrides.merchant || {}) },
      rules: overrides.rules || {},
      merchantCategoryRisk: overrides.merchantCategoryRisk,
      paymentIdentifier: { type: "masked_card_number", value: baseTxn.masked_card_number },
      ...overrides.context,
    }
  );
}

function hasRule(result, type) {
  return result.triggered_rules.some((item) => item.rule_type === type);
}

const tests = [
  ["changing rule points changes risk score", () => {
    const low = evaluate({ rules: { amount_multiplier: rule("amount_multiplier", { points: 7, threshold_value: 2 }) }, txn: { amount: 200 } });
    const high = evaluate({ rules: { amount_multiplier: rule("amount_multiplier", { points: 31, threshold_value: 2 }) }, txn: { amount: 200 } });
    assert.strictEqual(low.risk_score, 7);
    assert.strictEqual(high.risk_score, 31);
  }],
  ["inactive or missing rules do not trigger", () => {
    assert.strictEqual(evaluate({ rules: {}, txn: { amount: 10000 } }).risk_score, 0);
  }],
  ["missing rule configuration does not trigger", () => {
    const result = evaluate({ rules: { velocity: rule("velocity", { points: 25, threshold_count: null }) }, context: { velocityCount: 99 } });
    assert.strictEqual(result.risk_score, 0);
  }],
  ["MCC/category points are added and merchant_risk_score is not double-counted", () => {
    const result = evaluate({
      rules: { merchant_profile: rule("merchant_profile", { points: 999 }) },
      merchantCategoryRisk: { mcc_code: "5812", category_name: "Restaurants", points: 5 },
    });
    assert.strictEqual(result.risk_score, 5);
    assert.strictEqual(result.triggered_rules[0].evidence.matched_mcc, "5812");
  }],
  ["amount multiplier uses configured multiplier and skips missing average", () => {
    assert.strictEqual(evaluate({ rules: { amount_multiplier: rule("amount_multiplier", { points: 25, threshold_value: 3 }) }, txn: { amount: 151 } }).risk_score, 25);
    assert.strictEqual(evaluate({ rules: { amount_multiplier: rule("amount_multiplier", { points: 25, threshold_value: 3 }) }, merchant: { merchant_average_amount: null }, txn: { amount: 9999 } }).risk_score, 0);
  }],
  ["velocity uses configured count/window and payment identifier evidence", () => {
    const result = evaluate({ rules: { velocity: rule("velocity", { points: 25, threshold_count: 2, time_window_seconds: 30 }) }, context: { velocityCount: 2 } });
    assert.strictEqual(result.risk_score, 25);
    assert.strictEqual(result.triggered_rules[0].evidence.window_seconds, 30);
    assert.strictEqual(result.triggered_rules[0].evidence.payment_identifier_type, "masked_card_number");
  }],
  ["velocity stays below threshold when configured count is not reached", () => {
    const result = evaluate({ rules: { velocity: rule("velocity", { points: 25, threshold_count: 6, time_window_seconds: 60 }) }, context: { velocityCount: 5 } });
    assert.strictEqual(result.risk_score, 0);
  }],
  ["velocity is based on payment identifier context rather than merchant only", () => {
    const result = evaluate({
      rules: { velocity: rule("velocity", { points: 25, threshold_count: 2, time_window_seconds: 60 }) },
      context: { velocityCount: 2, paymentIdentifier: { type: "payment_gateway_ref", value: "GW-1" } },
    });
    assert.strictEqual(result.triggered_rules[0].evidence.payment_identifier_type, "payment_gateway_ref");
  }],
  ["small and large repeated transaction rules work", () => {
    const result = evaluate({
      rules: {
        velocity_small_amount: rule("velocity_small_amount", { points: 20, threshold_value: 10, threshold_count: 5, time_window_seconds: 300 }),
        large_amount_frequency: rule("large_amount_frequency", { points: 30, threshold_value: 3, threshold_count: 3, time_window_seconds: 1800 }),
      },
      context: { smallTransactionCount: 5, largeTransactionCount: 3 },
    });
    assert.strictEqual(result.risk_score, 50);
  }],
  ["failed attempts count failed or declined but not cancellations or voids", () => {
    const failed = evaluate({ rules: { failed_attempt_velocity: rule("failed_attempt_velocity", { points: 15, threshold_count: 3, time_window_seconds: 600 }) }, txn: { status: "declined" }, context: { failedAttemptCount: 3 } });
    const cancelled = evaluate({ rules: { failed_attempt_velocity: rule("failed_attempt_velocity", { points: 15, threshold_count: 3 }) }, txn: { status: "cancelled" }, context: { failedAttemptCount: 3 } });
    assert.strictEqual(failed.risk_score, 15);
    assert.strictEqual(cancelled.risk_score, 0);
  }],
  ["failure followed by success works and does not trigger failed velocity on success", () => {
    const result = evaluate({
      rules: {
        failed_attempt_velocity: rule("failed_attempt_velocity", { points: 15, threshold_count: 3 }),
        failure_then_success: rule("failure_then_success", { points: 30, threshold_count: 3, time_window_seconds: 600 }),
      },
      txn: { status: "success" },
      context: { failedAttemptCount: 3, previousFailureCount: 3 },
    });
    assert.strictEqual(result.risk_score, 30);
    assert.strictEqual(hasRule(result, "failed_attempt_velocity"), false);
  }],
  ["duplicate requires previous successful transaction context and failed retry is separate", () => {
    const duplicate = evaluate({
      rules: { duplicate_transaction: rule("duplicate_transaction", { points: 25, time_window_seconds: 60 }) },
      context: { duplicatePatternCount: 1, previousDuplicateTransaction: { transaction_id: "T0", txn_time: "2026-05-12 09:59:50" } },
    });
    const retry = evaluate({ rules: { duplicate_transaction: rule("duplicate_transaction", { points: 25 }) }, context: { duplicatePatternCount: 0 } });
    assert.strictEqual(duplicate.risk_score, 25);
    assert.strictEqual(retry.risk_score, 0);
  }],
  ["duplicate evidence includes previous transaction details", () => {
    const result = evaluate({
      rules: { duplicate_transaction: rule("duplicate_transaction", { points: 25, time_window_seconds: 60 }) },
      context: { duplicatePatternCount: 1, previousDuplicateTransaction: { transaction_id: "T0", txn_time: "2026-05-12 09:59:50" } },
    });
    assert.strictEqual(result.triggered_rules[0].evidence.previous_transaction_id, "T0");
  }],
  ["outside operating hours only applies where appropriate", () => {
    const outside = evaluate({ rules: { time: rule("time", { points: 10 }) }, txn: { transaction_type: "face_to_face", timestamp: "2026-05-12 02:15:00" } });
    const online = evaluate({ rules: { time: rule("time", { points: 10 }) }, txn: { transaction_type: "online", timestamp: "2026-05-12 02:15:00" } });
    assert.strictEqual(outside.risk_score, 10);
    assert.strictEqual(online.risk_score, 0);
  }],
  ["customer risk is independent from amount", () => {
    const highAmountLowCustomer = evaluate({ rules: { customer_risk: rule("customer_risk", { points: 15 }) }, txn: { amount: 9999, customer_risk_profile: "low" } });
    const lowAmountHighCustomer = evaluate({ rules: { customer_risk: rule("customer_risk", { points: 15 }) }, txn: { amount: 5, customer_risk_profile: "high" } });
    assert.strictEqual(highAmountLowCustomer.risk_score, 0);
    assert.strictEqual(lowAmountHighCustomer.risk_score, 15);
  }],
  ["data-quality scores missing monitoring references", () => {
    const result = evaluate({ rules: { data_quality: rule("data_quality", { points: 10 }) }, context: { missingRequiredInfo: true } });
    assert.strictEqual(result.risk_score, 10);
  }],
  ["data-quality does not score when monitoring references exist", () => {
    const result = evaluate({ rules: { data_quality: rule("data_quality", { points: 10 }) }, context: { missingRequiredInfo: false } });
    assert.strictEqual(result.risk_score, 0);
  }],
  ["online IP validation applies only to online transactions", () => {
    const online = evaluate({ rules: { ip_validation: rule("ip_validation", { points: 10 }) }, txn: { transaction_type: "online", ip_address: null } });
    const face = evaluate({ rules: { ip_validation: rule("ip_validation", { points: 10 }) }, txn: { transaction_type: "face_to_face", ip_address: null } });
    assert.strictEqual(online.risk_score, 10);
    assert.strictEqual(face.risk_score, 0);
  }],
  ["IP-country mismatch remains inactive unless rule and verification are present", () => {
    const inactive = evaluate({ txn: { ip_country: "Malaysia" }, context: { ipCountryVerified: true } });
    const unverified = evaluate({ rules: { ip_country_mismatch: rule("ip_country_mismatch", { points: 20 }) }, txn: { ip_country: "Malaysia" }, context: { ipCountryVerified: false } });
    const verified = evaluate({ rules: { ip_country_mismatch: rule("ip_country_mismatch", { points: 20 }) }, txn: { ip_country: "Malaysia" }, context: { ipCountryVerified: true } });
    assert.strictEqual(inactive.risk_score, 0);
    assert.strictEqual(unverified.risk_score, 0);
    assert.strictEqual(verified.risk_score, 20);
  }],
  ["IP-country mismatch does not run for face-to-face transactions", () => {
    const result = evaluate({
      rules: { ip_country_mismatch: rule("ip_country_mismatch", { points: 20 }) },
      txn: { transaction_type: "face_to_face", ip_country: "Malaysia" },
      context: { ipCountryVerified: true },
    });
    assert.strictEqual(result.risk_score, 0);
  }],
  ["merchant profile rule can apply zero-point normal categories", () => {
    const result = evaluate({
      rules: { merchant_profile: rule("merchant_profile", { points: 999 }) },
      merchantCategoryRisk: { mcc_code: "5411", category_name: "Grocery stores", points: 0 },
    });
    assert.strictEqual(result.risk_score, 0);
    assert.strictEqual(result.triggered_rules.length, 0);
  }],
  ["combined score can reach Critical without changing risk bands", () => {
    const result = evaluate({
      rules: {
        amount_multiplier: rule("amount_multiplier", { points: 40, threshold_value: 2 }),
        velocity: rule("velocity", { points: 50, threshold_count: 2, time_window_seconds: 60 }),
      },
      txn: { amount: 200 },
      context: { velocityCount: 2 },
    });
    assert.strictEqual(result.risk_score, 90);
    assert.strictEqual(result.risk_level, "Critical");
  }],
  ["high-risk jurisdiction is not a supported rule type", () => {
    assert.strictEqual(SUPPORTED_RULE_TYPES.includes("high_risk_jurisdiction"), false);
  }],
  ["structured evidence is returned", () => {
    const result = evaluate({ rules: { data_quality: rule("data_quality", { points: 10 }) }, context: { missingRequiredInfo: true } });
    assert.strictEqual(typeof result.triggered_rules[0], "object");
    assert.ok(result.triggered_rules[0].evidence);
  }],
  ["risk level boundaries are unchanged", () => {
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
