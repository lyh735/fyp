const db = require("../config/db");

exports.showAlertsPage = (req, res) => {
  const sql = "SELECT * FROM alerts ORDER BY created_at DESC";

  db.query(sql, (err, alerts) => {
    if (err) {
      console.error(err);
      return res.send("Error loading alerts");
    }

    res.render("officerAlerts", { alerts });
  });
};

exports.takeActionPage = (req, res) => {
  const { alert_id, officer_name, action_type, remarks } = req.body;

  let newStatus = "Pending";

  if (action_type === "review") newStatus = "Reviewed";
  if (action_type === "dismiss") newStatus = "Dismissed";
  if (action_type === "escalate") newStatus = "Escalated";

  const updateAlertSql = "UPDATE alerts SET status = ? WHERE alert_id = ?";
  const insertActionSql = `
    INSERT INTO officer_actions 
    (alert_id, officer_name, action_type, remarks)
    VALUES (?, ?, ?, ?)
  `;
  const insertAuditSql = `
    INSERT INTO audit_logs
    (officer_name, action, details)
    VALUES (?, ?, ?)
  `;

  db.query(updateAlertSql, [newStatus, alert_id], (err) => {
    if (err) return res.send("Error updating alert");

    db.query(
      insertActionSql,
      [alert_id, officer_name, action_type, remarks],
      (err) => {
        if (err) return res.send("Error saving officer action");

        const details = `${officer_name} ${action_type} alert ID ${alert_id}. Remarks: ${remarks || "None"}`;

        db.query(insertAuditSql, [officer_name, action_type, details], (err) => {
          if (err) return res.send("Error saving audit log");

          res.redirect("/officer/alerts");
        });
      }
    );
  });
};

exports.showAuditLogsPage = (req, res) => {
  const sql = "SELECT * FROM audit_logs ORDER BY created_at DESC";

  db.query(sql, (err, logs) => {
    if (err) return res.send("Error loading audit logs");

    res.render("auditLogs", { logs });
  });
};

exports.showReportPage = (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) AS total_alerts,
      SUM(status = 'Pending') AS pending_alerts,
      SUM(status = 'Reviewed') AS reviewed_alerts,
      SUM(status = 'Dismissed') AS dismissed_alerts,
      SUM(status = 'Escalated') AS escalated_alerts
    FROM alerts
  `;

  db.query(sql, (err, result) => {
    if (err) return res.send("Error loading report");

    res.render("officerReport", { report: result[0] });
  });
};