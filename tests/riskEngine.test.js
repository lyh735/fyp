const assert = require("assert");
const { evaluateTransaction } = require("../services/riskEngine");

function rule(ruleType, points, extra = {}) {
  return {
    rule_id: Math.floor(Math.random() * 10000),
    rule_type: ruleType,
    rule_name: ruleType,
    points,
    is_active: true,
    ...extra,
  };
}

const baseTransaction = {
  transaction_id: "TEST-1",
  merchant_id: "M-1",
  amount: 400,
  currency: "SGD",
  transaction_type: "online",
  timestamp: "2026-07-06 12:00:00",
  status: "success",
  customer_risk_profile: "low",
  country: "Singapore",
  ip_country: "Singapore",
  ip_address: "103.1.1.1",
};

const merchant = {
  merchant_average_amount: 100,
  has_physical_location: 1,
  operating_hours_start: "09:00:00",
  operating_hours_end: "18:00:00",
};

{
  const result = evaluateTransaction(baseTransaction, {
    merchant,
    rules: {
      amount_multiplier: rule("amount_multiplier", 30, { threshold_value: 3 }),
    },
  });

  assert.strictEqual(result.risk_score, 30);
  assert.strictEqual(result.risk_level, "Medium");
  assert.strictEqual(result.triggered_rules[0].rule_type, "amount_multiplier");
}

{
  const result = evaluateTransaction(baseTransaction, {
    merchant,
    rules: {
      amount_multiplier: rule("amount_multiplier", 10, { threshold_value: 3 }),
    },
  });

  assert.strictEqual(result.risk_score, 10);
  assert.strictEqual(result.risk_level, "Low");
}

{
  const result = evaluateTransaction(baseTransaction, {
    merchant,
    rules: {},
  });

  assert.strictEqual(result.risk_score, 0);
  assert.strictEqual(result.triggered_rules.length, 0);
}

{
  const result = evaluateTransaction(baseTransaction, {
    merchant,
    rules: {
      velocity: rule("velocity", 25, {
        threshold_count: 6,
        time_window_seconds: 60,
      }),
    },
    velocityCount: 6,
  });

  assert.strictEqual(result.risk_score, 25);
  assert.strictEqual(result.triggered_rules[0].evidence.actual_count, 6);
}

{
  const result = evaluateTransaction(
    {
      ...baseTransaction,
      country: "Singapore",
      ip_country: "Malaysia",
    },
    {
      merchant,
      rules: {
        ip_country_mismatch: rule("ip_country_mismatch", 20),
      },
    }
  );

  assert.strictEqual(result.risk_score, 20);
}

console.log("All risk engine tests passed.");
