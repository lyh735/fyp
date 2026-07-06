const OpenAI = require("openai");

function parseRules(value) {
  if (!value) return [];

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = [value];
    }
  }

  if (!Array.isArray(parsed)) parsed = [parsed];

  return parsed.map((item) => {
    if (item && typeof item === "object") {
      return `+${Number(item.points || 0)} ${
        item.rule_name || item.rule || item.message || "Risk rule"
      }`;
    }
    return String(item);
  });
}

function formatDate(value) {
  if (!value) return "not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
}

function formatAmount(alert) {
  if (alert.amount == null) return "not recorded";
  return `${alert.currency || "SGD"} ${Number(alert.amount).toFixed(2)}`;
}

function buildCaseContext(alert) {
  const rules = parseRules(alert.triggered_rules);
  return {
    alert_id: alert.alert_id,
    transaction_id: alert.transaction_id,
    merchant_id: alert.merchant_id,
    merchant_name: alert.merchant_name || alert.merchant_id,
    business_category: alert.business_category,
    amount: formatAmount(alert),
    transaction_type: alert.transaction_type,
    payment_method: alert.payment_method,
    masked_card_number: alert.masked_card_number,
    ip_address: alert.ip_address,
    transaction_country: alert.country,
    transaction_time: formatDate(alert.txn_time),
    alert_created_at: formatDate(alert.created_at),
    risk_score: alert.risk_score,
    risk_level: alert.risk_level,
    priority: alert.priority,
    triggered_rules: rules,
    escalation_report: alert.escalation_report || alert.message || "",
    analyst_remarks: alert.analyst_remarks || "",
    merchant_response: alert.response_message || "",
    rfi_reference_no: alert.rfi_reference_no || "",
    rfi_status: alert.rfi_status || "",
    rfi_sent_at: formatDate(alert.rfi_sent_at),
    rfi_responded_at: formatDate(alert.rfi_responded_at)
  };
}

function buildFallbackDraft(alert) {
  const context = buildCaseContext(alert);
  const rules = context.triggered_rules.length
    ? context.triggered_rules.map((rule) => `- ${rule}`).join("\n")
    : "- No triggered rule details were recorded.";

  const rfiText = context.rfi_reference_no
    ? `An RFI (${context.rfi_reference_no}) was issued with status "${context.rfi_status || "not recorded"}". Merchant response: ${context.merchant_response || "no merchant response recorded."}`
    : "No linked RFI response was recorded for this alert.";

  return `Suspicious Transaction Report Draft

Alert ${context.alert_id} relates to transaction ${context.transaction_id} for merchant ${context.merchant_name} (${context.merchant_id}). The transaction amount was ${context.amount}, processed by ${context.payment_method || "an unrecorded payment method"} as a ${context.transaction_type || "transaction type not recorded"} transaction on ${context.transaction_time}. The apparent transaction country was ${context.transaction_country || "not recorded"}.

The case was escalated because the system assessed the transaction as ${context.risk_level || "unclassified"} risk with a score of ${context.risk_score ?? "not recorded"} and priority ${context.priority || "not recorded"}. Triggered risk indicators:
${rules}

Officer escalation notes:
${context.escalation_report || "No escalation notes were recorded."}

Analyst/RFI information:
${context.analyst_remarks || "No analyst remarks were recorded."}
${rfiText}

Draft suspicion narrative:
Based on the available case information, this transaction should be reviewed for possible suspicious activity because it matched one or more risk indicators, including the rules listed above. The STRO should verify whether the merchant activity, transaction country, payment method, and customer behaviour are consistent with the merchant profile and any response received through RFI before final submission.

Recommended next checks:
- Confirm merchant profile and expected transaction activity.
- Review linked transaction history for repeated or structured activity.
- Validate any merchant explanation or supporting documents.
- Confirm whether the transaction should be filed externally as an STR after officer review.`;
}

function extractResponseText(response) {
  if (response.output_text) return response.output_text.trim();
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function generateStrDraft(alert) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      narrative: buildFallbackDraft(alert),
      aiUsed: false,
      note: "OPENAI_API_KEY is not configured, so a structured non-AI draft was created."
    };
  }

  const client = new OpenAI({ apiKey });
  const context = buildCaseContext(alert);
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You draft Suspicious Transaction Report narratives for a Singapore compliance monitoring system. Use only the provided facts, do not invent names or evidence, and mark gaps clearly as not recorded. Write in a concise formal compliance style."
      },
      {
        role: "user",
        content:
          "Create an editable STR draft with these sections: Case summary, Transaction details, Risk indicators, RFI/analyst information, Suspicion rationale, Recommended reviewer checks. Do not claim a report has been submitted.\n\nCase data:\n" +
          JSON.stringify(context, null, 2)
      }
    ]
  });

  const narrative = extractResponseText(response);
  return {
    narrative: narrative || buildFallbackDraft(alert),
    aiUsed: Boolean(narrative),
    note: narrative ? "AI draft generated from the escalated alert data." : "AI returned no text, so a structured draft was created."
  };
}

module.exports = {
  buildCaseContext,
  buildFallbackDraft,
  generateStrDraft
};
