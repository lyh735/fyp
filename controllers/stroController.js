const db = require("../config/db");

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
         latest_str.str_id,
         latest_str.generated_by AS str_generated_by,
         latest_str.str_reference_number,
         latest_str.status AS str_status,
         latest_str.approved_at AS str_approved_at,
         latest_str.rejected_at AS str_rejected_at,
         latest_str.stro_feedback,
         latest_str.stro_reviewed_at,
         latest_str.updated_at AS str_updated_at,
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
  LEFT JOIN str_reports latest_str ON latest_str.str_id = (
    SELECT s.str_id
    FROM str_reports s
    WHERE s.alert_id = a.alert_id
    ORDER BY s.updated_at DESC, s.str_id DESC
    LIMIT 1
  )
`;

exports.getNotificationSummary = async (req, res) => {
  try {
    const role = String(req.user?.role || "").trim().toLowerCase();

    if (role === "stro") {
      const rows = await query(`
        SELECT COUNT(*) AS notification_count
        FROM str_reports
        WHERE status = 'pending_stro_review'
      `);

      return res.json({
        role,
        type: "pending_stro_review",
        count: Number(rows[0]?.notification_count || 0),
      });
    }

    if (role === "analyst") {
      const analystId = Number(req.user?.id || req.user?.user_id);
      if (!Number.isInteger(analystId) || analystId <= 0) {
        return res.status(401).json({ message: "A valid analyst account is required" });
      }

      const rows = await query(`
        SELECT COUNT(*) AS notification_count
        FROM str_reports
        WHERE status = 'feedback_required'
          AND generated_by = ?
      `, [analystId]);

      return res.json({
        role,
        type: "feedback_required",
        count: Number(rows[0]?.notification_count || 0),
      });
    }

    return res.status(403).json({ message: "Forbidden" });
  } catch (err) {
    console.error("Unable to load STR notifications:", err);
    return res.status(500).json({ message: "Unable to load STR notifications" });
  }
};

exports.getStroOutcomes = async (req, res) => {
  try {
    const analystId = Number(req.user?.id || req.user?.user_id);
    if (!Number.isInteger(analystId) || analystId <= 0) {
      return res.status(401).json({ message: "A valid analyst account is required" });
    }

    const outcomes = await query(`${alertSelect}
      WHERE a.escalated_at IS NOT NULL
        AND latest_str.generated_by = ?
      ORDER BY a.escalated_at DESC, a.created_at DESC
      LIMIT 200`, [analystId]);

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
      str_id: outcome.str_id,
      str_reference_number: outcome.str_reference_number,
      str_status: outcome.str_status,
      str_approved_at: outcome.str_approved_at,
      str_rejected_at: outcome.str_rejected_at,
      stro_feedback: outcome.stro_feedback,
      stro_reviewed_at: outcome.stro_reviewed_at,
      str_updated_at: outcome.str_updated_at,
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
