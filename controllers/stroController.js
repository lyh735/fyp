const db = require("../config/db");
const { generateStrDraft } = require("../services/strDrafting");

function query(sql, values = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, values, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

const alertSelect = `
  SELECT a.alert_id AS id, a.alert_id, a.transaction_id, a.merchant_id,
         a.risk_score, a.risk_level, a.triggered_rules, a.status, a.priority,
         a.message, a.created_at, a.reviewed_at, a.escalated_at,
         m.merchant_name, m.business_category,
         t.amount, t.currency, t.transaction_type, t.payment_method,
         t.masked_card_number, t.ip_address, t.country, t.txn_time,
         reviewer.name AS escalated_by,
         r.rfi_id, r.reference_no AS rfi_reference_no, r.status AS rfi_status,
         r.sent_at AS rfi_sent_at, r.due_at AS rfi_due_at,
         r.responded_at AS rfi_responded_at, r.response_message,
         r.response_attachment,
         r.additional_remarks AS analyst_remarks,
         (
           SELECT s.status
           FROM str_reports s
           WHERE s.alert_id = a.alert_id
           ORDER BY s.updated_at DESC, s.str_id DESC
           LIMIT 1
         ) AS str_status,
         (
           SELECT s.approved_at
           FROM str_reports s
           WHERE s.alert_id = a.alert_id
           ORDER BY s.updated_at DESC, s.str_id DESC
           LIMIT 1
         ) AS str_approved_at,
         (
           SELECT s.rejected_at
           FROM str_reports s
           WHERE s.alert_id = a.alert_id
           ORDER BY s.updated_at DESC, s.str_id DESC
           LIMIT 1
         ) AS str_rejected_at,
         (
           SELECT ca.remarks
           FROM case_actions ca
           WHERE ca.alert_id = a.alert_id
             AND ca.action_type IN ('escalate', 'escalate_to_stro')
           ORDER BY ca.created_at DESC, ca.action_id DESC
           LIMIT 1
         ) AS escalation_report
  FROM alerts a
  LEFT JOIN transactions t ON t.transaction_id = a.transaction_id
  LEFT JOIN merchants m ON m.merchant_id = a.merchant_id
  LEFT JOIN users reviewer ON reviewer.user_id = a.reviewed_by
  LEFT JOIN rfi_requests r ON r.alert_id = a.alert_id
`;

exports.getStroOutcomes = async (req, res) => {
  try {
    const outcomes = await query(`${alertSelect}
      WHERE a.escalated_at IS NOT NULL
      ORDER BY a.escalated_at DESC, a.created_at DESC
      LIMIT 200`);

    res.json(outcomes.map((outcome) => ({
      id: outcome.id,
      alert_id: outcome.alert_id,
      transaction_id: outcome.transaction_id,
      merchant_id: outcome.merchant_id,
      merchant_name: outcome.merchant_name,
      amount: outcome.amount,
      currency: outcome.currency,
      risk_score: outcome.risk_score,
      risk_level: outcome.risk_level,
      priority: outcome.priority,
      escalated_at: outcome.escalated_at,
      str_status: outcome.str_status,
      str_approved_at: outcome.str_approved_at,
      str_rejected_at: outcome.str_rejected_at,
    })));
  } catch (err) {
    console.error("Unable to load STRO outcomes:", err);
    res.status(500).json({ message: "Unable to load STRO outcomes" });
  }
};

exports.getEscalatedAlerts = async (req, res) => {
  try {
    const alerts = await query(`${alertSelect}
      WHERE a.status IN ('Escalated', 'Escalated to STRO')
      ORDER BY a.escalated_at DESC, a.created_at DESC
      LIMIT 200`);
    res.json(alerts);
  } catch (err) {
    console.error("Unable to load STRO alerts:", err);
    res.status(500).json({ message: "Unable to load escalated alerts" });
  }
};

exports.getEscalatedAlert = async (req, res) => {
  try {
    const alerts = await query(`${alertSelect}
      WHERE a.alert_id = ?
        AND a.status IN ('Escalated', 'Escalated to STRO')
      LIMIT 1`, [req.params.id]);

    if (!alerts.length) {
      return res.status(404).json({ message: "Escalated alert not found" });
    }
    const alert = alerts[0];
    alert.case_history = await query(`
      SELECT ca.action_id, ca.action_type, ca.status_after_action, ca.remarks,
             ca.created_at, u.name AS actor_name
      FROM case_actions ca
      LEFT JOIN users u ON u.user_id = ca.user_id
      WHERE ca.alert_id = ?
      ORDER BY ca.created_at DESC, ca.action_id DESC
    `, [alert.alert_id]);
    res.json(alert);
  } catch (err) {
    console.error("Unable to load STRO alert:", err);
    res.status(500).json({ message: "Unable to load escalated alert" });
  }
};

async function loadEscalatedAlert(alertId) {
  const alerts = await query(`${alertSelect}
    WHERE a.alert_id = ?
      AND a.status IN ('Escalated', 'Escalated to STRO')
    LIMIT 1`, [alertId]);
  return alerts[0] || null;
}

async function loadLatestDraft(alertId) {
  const drafts = await query(`
    SELECT s.str_id, s.alert_id, s.generated_by, s.approved_by,
           s.str_reference_number, s.narrative_text, s.status,
           s.generated_at, s.updated_at, s.approved_at, s.rejected_at,
           u.name AS generated_by_name
    FROM str_reports s
    LEFT JOIN users u ON u.user_id = s.generated_by
    WHERE s.alert_id = ?
    ORDER BY s.updated_at DESC, s.str_id DESC
    LIMIT 1
  `, [alertId]);
  return drafts[0] || null;
}

exports.getStrDraft = async (req, res) => {
  try {
    const alert = await loadEscalatedAlert(req.params.id);
    if (!alert) {
      return res.status(404).json({ message: "Escalated alert not found" });
    }

    const draft = await loadLatestDraft(alert.alert_id);
    res.json({ alert, draft });
  } catch (err) {
    console.error("Unable to load STR draft:", err);
    res.status(500).json({ message: "Unable to load STR draft" });
  }
};

exports.generateStrDraftForAlert = async (req, res) => {
  try {
    const alert = await loadEscalatedAlert(req.params.id);
    if (!alert) {
      return res.status(404).json({ message: "Escalated alert not found" });
    }

    if (alert.status !== "Escalated to STRO") {
      return res.status(400).json({
        message: "STR draft can only be generated for escalated cases."
      });
    }

    const result = await generateStrDraft(alert);
    const existing = await loadLatestDraft(alert.alert_id);
    let draftId;

    if (existing) {
      await query(`
        UPDATE str_reports
        SET narrative_text = ?, generated_by = ?, status = 'draft', updated_at = NOW()
        WHERE str_id = ?
      `, [result.narrative, req.user.id || req.user.user_id, existing.str_id]);
      draftId = existing.str_id;
    } else {
      const insert = await query(`
        INSERT INTO str_reports (alert_id, generated_by, narrative_text, status)
        VALUES (?, ?, ?, 'draft')
      `, [alert.alert_id, req.user.id || req.user.user_id, result.narrative]);
      draftId = insert.insertId;
    }

    await query(`
      INSERT INTO case_actions (alert_id, user_id, action_type, status_after_action, remarks)
      VALUES (?, ?, 'str_draft_generated', ?, ?)
    `, [
      alert.alert_id,
      req.user.id || req.user.user_id,
      alert.status,
      result.aiUsed ? "AI-assisted STR draft generated" : result.note
    ]);

    const draft = await loadLatestDraft(alert.alert_id);
    res.json({ draft: { ...draft, str_id: draftId }, ai_used: result.aiUsed, note: result.note });
  } catch (err) {
    console.error("Unable to generate STR draft:", err);
    res.status(500).json({ message: "Unable to generate STR draft" });
  }
};

exports.saveStrDraft = async (req, res) => {
  try {
    const narrative = String(req.body.narrative_text || "").trim();
    if (!narrative) {
      return res.status(400).json({ message: "Narrative text is required" });
    }

    const drafts = await query(`
      SELECT str_id, alert_id, status
      FROM str_reports
      WHERE str_id = ?
      LIMIT 1
    `, [req.params.id]);

    if (!drafts.length) {
      return res.status(404).json({ message: "STR draft not found" });
    }

    if (drafts[0].status !== "draft") {
      return res.status(400).json({ message: "Only draft STR reports can be edited" });
    }

    await query(`
      UPDATE str_reports
      SET narrative_text = ?, updated_at = NOW()
      WHERE str_id = ?
    `, [narrative, req.params.id]);

    await query(`
      INSERT INTO case_actions (alert_id, user_id, action_type, status_after_action, remarks)
      VALUES (?, ?, 'str_draft_updated', 'draft', 'STR draft narrative updated')
    `, [drafts[0].alert_id, req.user.id || req.user.user_id]);

    const updated = await query(`
      SELECT str_id, alert_id, narrative_text, status, generated_at, updated_at
      FROM str_reports
      WHERE str_id = ?
      LIMIT 1
    `, [req.params.id]);

    res.json({ draft: updated[0], message: "STR draft saved" });
  } catch (err) {
    console.error("Unable to save STR draft:", err);
    res.status(500).json({ message: "Unable to save STR draft" });
  }
};
