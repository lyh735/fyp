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
         r.response_file_name, r.response_stored_name,
         r.additional_remarks AS analyst_remarks,
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
