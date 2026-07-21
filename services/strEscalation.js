function workflowError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function display(value, fallback = "Not recorded") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function formatTriggeredRules(value) {
  if (!value) return "No triggered rules recorded.";

  let rules = value;
  if (typeof value === "string") {
    try {
      rules = JSON.parse(value);
    } catch {
      return value;
    }
  }

  if (!Array.isArray(rules)) return JSON.stringify(rules, null, 2);
  if (rules.length === 0) return "No triggered rules recorded.";

  return rules.map((rule, index) => {
    if (typeof rule !== "object" || rule === null) {
      return `${index + 1}. ${display(rule)}`;
    }
    const name = rule.rule_name || rule.name || rule.rule || rule.rule_type;
    const detail = rule.description || rule.reason || rule.evidence;
    return `${index + 1}. ${display(name, "Triggered rule")}${detail ? ` - ${detail}` : ""}`;
  }).join("\n");
}

function formatCaseHistory(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return "No previous analyst actions recorded.";
  }

  return actions.map((action, index) => [
    `${index + 1}. ${display(action.action_type).replaceAll("_", " ")}`,
    `Status: ${display(action.status_after_action)}`,
    `Remarks: ${display(action.remarks)}`,
    `Recorded: ${display(action.created_at)}`,
  ].join(" | ")).join("\n");
}

function buildStrNarrative(context, actions, analystRemarks) {
  return `Suspicious Transaction Report Draft

CASE SUMMARY
Alert ID: ${display(context.alert_id)}
Transaction ID: ${display(context.transaction_id)}
Alert risk level: ${display(context.risk_level)}
Alert risk score: ${display(context.risk_score)}
Priority: ${display(context.priority)}
Alert message: ${display(context.message)}

TRIGGERED RULES
${formatTriggeredRules(context.triggered_rules)}

TRANSACTION DETAILS
Amount: ${display(context.currency, "SGD")} ${display(context.amount)}
Transaction type: ${display(context.transaction_type)}
Payment method: ${display(context.payment_method)}
Payment reference: ${display(context.masked_payment_ref || context.masked_card_number)}
Terminal ID: ${display(context.terminal_id)}
IP address: ${display(context.ip_address)}
Transaction country: ${display(context.transaction_country)}
Transaction time: ${display(context.txn_time)}
Transaction status: ${display(context.transaction_status)}

MERCHANT PROFILE
Merchant ID: ${display(context.merchant_id)}
Merchant name: ${display(context.merchant_name)}
Business category: ${display(context.business_category)}
MCC code: ${display(context.mcc_code)}
Merchant risk level: ${display(context.merchant_risk_level)}
Merchant risk score: ${display(context.merchant_risk_score)}
Merchant average amount: ${display(context.merchant_average_amount)}
Merchant country: ${display(context.merchant_country)}
Merchant status: ${display(context.merchant_status)}
Operating hours: ${display(context.operating_hours_start)} to ${display(context.operating_hours_end)}

RFI AND INVESTIGATION CONTEXT
RFI reference: ${display(context.rfi_reference_no, "No RFI linked")}
RFI status: ${display(context.rfi_status)}
Requested documents: ${display(context.requested_documents)}
Request message: ${display(context.request_message)}
Analyst RFI remarks: ${display(context.additional_remarks)}
Merchant response: ${display(context.response_message, "No merchant response recorded")}
Response attachment: ${display(context.response_attachment)}
RFI sent at: ${display(context.rfi_sent_at)}
RFI due at: ${display(context.rfi_due_at)}
RFI responded at: ${display(context.rfi_responded_at)}

ANALYST ASSESSMENT
${display(analystRemarks, "No additional escalation remarks provided.")}

CASE ACTIVITY BEFORE ESCALATION
${formatCaseHistory(actions)}

RECOMMENDATION
Complete and verify this STR draft using the recorded risk indicators and investigation context. The alert remains pending until the analyst submits the completed draft for STRO review.`;
}

const STR_FORM_SECTIONS = [
  ["REPORTING ENTITY", [
    ["Reporting entity", "reporting_entity_name"],
    ["Entity type", "reporting_entity_type"],
    ["UEN", "uen"],
    ["Business address", "business_address"],
    ["Compliance officer", "compliance_officer_name"],
    ["Compliance email", "compliance_email"],
    ["Compliance contact", "compliance_contact_number"],
  ]],
  ["SUBJECT / MERCHANT", [
    ["Subject name", "subject_name"],
    ["Merchant name", "merchant_name"],
    ["Merchant ID", "merchant_id"],
    ["Business type", "business_type"],
    ["Identification number", "identification_number"],
    ["Account number", "account_number"],
    ["Nationality", "nationality"],
    ["Subject address", "subject_address"],
    ["Subject contact", "subject_contact_number"],
  ]],
  ["TRANSACTION", [
    ["Transaction ID", "transaction_id"],
    ["Amount", "transaction_amount"],
    ["Currency", "currency"],
    ["Date/time", "transaction_datetime"],
    ["Payment method", "payment_method"],
    ["Channel", "transaction_channel"],
    ["Status", "transaction_status"],
    ["Originating country", "originating_country"],
    ["Destination country", "destination_country"],
    ["Source of funds", "source_of_funds"],
    ["Destination of funds", "destination_of_funds"],
  ]],
  ["INVESTIGATION", [
    ["Detection method", "detection_method"],
    ["Risk level", "risk_level"],
    ["Risk score", "risk_score"],
    ["Risk indicators", "risk_indicators"],
    ["Other risk indicators", "other_risk_indicators"],
    ["Investigation findings", "investigation_findings"],
    ["Supporting documents", "supporting_documents"],
    ["Other supporting evidence", "other_supporting_evidence"],
    ["Other actions taken", "other_actions_taken"],
  ]],
  ["RECOMMENDATION", [
    ["Recommended action", "recommended_action"],
    ["Recommendation remarks", "recommendation_remarks"],
    ["Escalated to", "escalated_to"],
  ]],
];

function buildCompletedStrNarrative(draftData) {
  const data = draftData || {};
  const sections = STR_FORM_SECTIONS.map(([heading, fields]) => {
    const lines = fields.map(([label, key]) => {
      const value = Array.isArray(data[key]) ? data[key].join(", ") : data[key];
      return `${label}: ${display(value)}`;
    });
    return `${heading}\n${lines.join("\n")}`;
  });

  return `Suspicious Transaction Report Draft

${sections.join("\n\n")}

STR NARRATIVE
${display(data.narrative_text, "No narrative provided.")}`;
}

async function submitStrDraftAndEscalate(
  pool,
  { alertId, analystId, analystRemarks, narrativeText, draftData }
) {
  const narrative = String(narrativeText || "").trim();
  if (!narrative) {
    throw workflowError(400, "Complete the STR narrative before escalation");
  }

  const connection = await pool.promise().getConnection();

  try {
    await connection.beginTransaction();

    const [contexts] = await connection.query(`
      SELECT
        a.alert_id, a.transaction_id, a.merchant_id, a.risk_score,
        a.risk_level, a.triggered_rules, a.status, a.priority, a.message,
        t.amount, t.currency, t.transaction_type, t.payment_method,
        t.masked_payment_ref, t.masked_card_number, t.terminal_id,
        t.ip_address, t.country AS transaction_country, t.txn_time,
        t.transaction_status,
        m.merchant_name, m.business_category, m.mcc_code,
        m.merchant_average_amount, m.merchant_risk_score,
        m.operating_hours_start, m.operating_hours_end,
        m.risk_level AS merchant_risk_level,
        m.country AS merchant_country, m.status AS merchant_status,
        r.reference_no AS rfi_reference_no, r.status AS rfi_status,
        r.requested_documents, r.request_message, r.additional_remarks,
        r.response_message, r.response_attachment,
        r.sent_at AS rfi_sent_at, r.due_at AS rfi_due_at,
        r.responded_at AS rfi_responded_at
      FROM alerts a
      LEFT JOIN transactions t ON t.transaction_id = a.transaction_id
      LEFT JOIN merchants m ON m.merchant_id = a.merchant_id
      LEFT JOIN rfi_requests r ON r.alert_id = a.alert_id
      WHERE a.alert_id = ?
      LIMIT 1
      FOR UPDATE
    `, [alertId]);

    if (contexts.length === 0) {
      throw workflowError(404, "Alert not found");
    }

    const context = contexts[0];
    const currentStatus = String(context.status || "").trim().toLowerCase();

    const [drafts] = await connection.query(`
      SELECT str_id, status, str_reference_number, stro_feedback
      FROM str_reports
      WHERE alert_id = ?
      ORDER BY updated_at DESC, str_id DESC
      LIMIT 1
      FOR UPDATE
    `, [alertId]);

    const existingDraft = drafts[0];
    if (existingDraft && !new Set(["draft", "feedback_required"]).has(existingDraft.status)) {
      throw workflowError(409, "This alert already has an STR in the STRO review workflow");
    }

    const isInitialSubmission = new Set(["pending", "pending review"]).has(currentStatus);
    const isFeedbackResubmission = currentStatus === "escalated to stro" &&
      existingDraft &&
      new Set(["draft", "feedback_required"]).has(existingDraft.status) &&
      String(existingDraft.stro_feedback || "").trim() !== "";
    if (!isInitialSubmission && !isFeedbackResubmission) {
      throw workflowError(
        400,
        "Only pending alerts or STR drafts returned by STRO can be submitted"
      );
    }

    const reference = existingDraft?.str_reference_number ||
      `STR-${new Date().getFullYear()}-${alertId}-${Date.now()}`;

    const [alertUpdate] = await connection.query(`
      UPDATE alerts
      SET status = 'Escalated to STRO', reviewed_by = ?, reviewed_at = NOW(),
          escalated_at = COALESCE(escalated_at, NOW())
      WHERE alert_id = ? AND status = ?
    `, [analystId, alertId, context.status]);

    if (alertUpdate.affectedRows !== 1) {
      throw workflowError(409, "Alert status changed before escalation could complete");
    }

    await connection.query(`
      INSERT INTO case_actions
        (alert_id, user_id, action_type, status_after_action, remarks)
      VALUES (?, ?, ?, 'Escalated to STRO', ?)
    `, [
      alertId,
      analystId,
      isFeedbackResubmission ? "str_resubmitted_to_stro" : "escalate_to_stro",
      analystRemarks || null,
    ]);

    let strId;
    if (existingDraft) {
      await connection.query(`
        UPDATE str_reports
        SET generated_by = ?, str_reference_number = ?, narrative_text = ?,
            draft_data = ?,
            status = 'pending_stro_review',
            stro_reviewed_by = NULL, stro_reviewed_at = NULL,
            updated_at = NOW()
        WHERE str_id = ?
      `, [analystId, reference, narrative, JSON.stringify(draftData || {}), existingDraft.str_id]);
      strId = existingDraft.str_id;
    } else {
      const [draftInsert] = await connection.query(`
        INSERT INTO str_reports
          (alert_id, generated_by, str_reference_number, narrative_text, draft_data, status)
        VALUES (?, ?, ?, ?, ?, 'pending_stro_review')
      `, [alertId, analystId, reference, narrative, JSON.stringify(draftData || {})]);
      strId = draftInsert.insertId;
    }

    await connection.commit();
    return { alertId, strId, reference };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  buildCompletedStrNarrative,
  buildStrNarrative,
  submitStrDraftAndEscalate,
};
