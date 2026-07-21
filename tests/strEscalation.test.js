const assert = require("assert");
const {
  buildCompletedStrNarrative,
  buildStrNarrative,
} = require("../services/strEscalation");

const narrative = buildStrNarrative({
  alert_id: 42,
  transaction_id: "TX-100",
  merchant_id: "M-20",
  risk_level: "High",
  risk_score: 85,
  priority: "Urgent",
  message: "Unusual transaction pattern",
  triggered_rules: JSON.stringify([
    { rule_name: "Velocity spike", evidence: "Five transactions in ten minutes" },
  ]),
  amount: "12500.00",
  currency: "SGD",
  transaction_type: "online",
  payment_method: "card",
  transaction_country: "Singapore",
  merchant_name: "Example Merchant",
  business_category: "Retail",
  mcc_code: "5999",
  merchant_risk_level: "Medium",
  merchant_risk_score: 45,
  rfi_reference_no: "RFI-42",
  rfi_status: "Responded",
  requested_documents: "Invoices",
  response_message: "Documents supplied by merchant",
}, [{
  action_type: "review_started",
  status_after_action: "Pending Review",
  remarks: "Initial investigation opened",
  created_at: "2026-07-21T10:00:00.000Z",
}], "Escalated after the merchant response did not explain the transaction pattern.");

const expectedContext = [
  "Alert ID: 42",
  "Transaction ID: TX-100",
  "Velocity spike - Five transactions in ten minutes",
  "Merchant name: Example Merchant",
  "RFI reference: RFI-42",
  "Merchant response: Documents supplied by merchant",
  "Escalated after the merchant response did not explain the transaction pattern.",
  "review started",
  "alert remains pending until the analyst submits the completed draft",
];

for (const expected of expectedContext) {
  assert.ok(narrative.includes(expected), `Narrative should include: ${expected}`);
}

const fallbackNarrative = buildStrNarrative({}, [], "");
assert.ok(fallbackNarrative.includes("No triggered rules recorded."));
assert.ok(fallbackNarrative.includes("No merchant response recorded"));
assert.ok(fallbackNarrative.includes("No previous analyst actions recorded."));

const completedNarrative = buildCompletedStrNarrative({
  reporting_entity_name: "Example Bank",
  merchant_name: "Example Merchant",
  transaction_id: "TX-100",
  risk_indicators: ["Velocity spike", "Unusual amount"],
  recommended_action: "File STR",
  narrative_text: "The analyst completed and verified this narrative.",
});
assert.ok(completedNarrative.includes("Reporting entity: Example Bank"));
assert.ok(completedNarrative.includes("Risk indicators: Velocity spike, Unusual amount"));
assert.ok(completedNarrative.includes("Recommended action: File STR"));
assert.ok(completedNarrative.includes("The analyst completed and verified this narrative."));

console.log("3 STR drafting workflow tests passed");
