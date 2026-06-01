const db = require("../config/db");

exports.showAlertsPage = (req, res) => {

  const sql = `
    SELECT * FROM alerts
    ORDER BY created_at DESC
  `;

  db.query(sql, (err, alerts) => {

    if (err) {
      console.error(err);
      return res.send("Error loading alerts");
    }

    res.render("officerAlerts", { alerts });

  });

};

exports.showAlertDetails = (req, res) => {

  const alertId = req.params.id;


  const sql = "SELECT * FROM alerts WHERE id = ? OR alert_id = ? LIMIT 1";

  db.query(sql, [alertId, alertId], (err, results) => {

    if (err) {
      console.error(err);
      return res.send("Database error");
    }

    if (results.length === 0) {
      return res.send("Alert not found");
    }

    res.render("alertDetails", {
      alert: results[0]
    });

  });

};

exports.showAlertActionPage = (req, res) => {

  const alertId = req.params.id;

  const sql = "SELECT * FROM alerts WHERE id = ? OR alert_id = ? LIMIT 1";

  db.query(sql, [alertId, alertId], (err, results) => {

    if (err) {
      console.error(err);
      return res.send("Database error");
    }

    if (results.length === 0) {
      return res.send("Alert not found");
    }

    res.render("alertAction", {
      alert: results[0]
    });

  });

};

exports.takeActionPage = (req, res) => {

  const {
    alert_id,
    officer_name,
    action_type,
    remarks
  } = req.body;

  // First, fetch the alert details
  const selectAlertSql = "SELECT * FROM alerts WHERE id = ? LIMIT 1";
  
  db.query(selectAlertSql, [alert_id], (err, alerts) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching alert");
    }

    if (alerts.length === 0) {
      return res.status(404).send("Alert not found");
    }

    const alert = alerts[0];
    let newStatus = "Pending Review";

    if (action_type === "review") {
      newStatus = "Reviewed";
    }

    if (action_type === "dismiss") {
      newStatus = "Dismissed";
    }

    if (action_type === "escalate") {
      newStatus = "Escalated";
    }

    const updateAlertSql = `
      UPDATE alerts
      SET status = ?, reviewed_at = NOW()
      WHERE id = ?
    `;

    const insertActionSql = `
      INSERT INTO officer_actions
      (
        alert_id,
        officer_name,
        action_type,
        remarks
      )
      VALUES (?, ?, ?, ?)
    `;

    const insertAuditSql = `
      INSERT INTO audit_logs
      (
        event_type,
        transaction_id,
        merchant_id,
        message,
        officer_name,
        action,
        details
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(updateAlertSql, [newStatus, alert_id], (err) => {

      if (err) {
        console.error(err);
        return res.status(500).send("Error updating alert");
      }

      db.query(
        insertActionSql,
        [
          alert_id,
          officer_name,
          action_type,
          remarks
        ],
        (err) => {

          if (err) {
            console.error(err);
            return res.status(500).send("Error saving officer action");
          }

          const details = `
Officer ${officer_name} performed ${action_type}
on alert database ID ${alert_id}.
Remarks: ${remarks || "None"}
`;

          const eventType =
            action_type === "escalate"
              ? "Compliance Escalation"
              : action_type === "dismiss"
              ? "Alert Dismissal"
              : "Alert Review";

          const message = details;

          db.query(
            insertAuditSql,
            [
              eventType,
              alert.transaction_id,
              alert.merchant_id,
              message,
              officer_name,
              action_type,
              details
            ],
            (err) => {

              if (err) {
                console.error(err);
                return res.status(500).send("Error saving audit log");
              }

              res.redirect(
                `/api/officer/action-success/${alert_id}?action=${action_type}`
              );

            }
          );

        }
      );

    });

  });

};

exports.showAuditLogsPage = (req, res) => {

  const sql = `
    SELECT * FROM audit_logs
    ORDER BY created_at DESC
  `;

  db.query(sql, (err, logs) => {

    if (err) {
      console.error(err);
      return res.send("Error loading audit logs");
    }

    res.render("auditLogs", { logs });

  });

};

exports.showReportPage = (req, res) => {

  const sql = `
    SELECT
      COUNT(*) AS total_alerts,

      SUM(status = 'Pending Review')
      AS pending_alerts,

      SUM(status = 'Reviewed')
      AS reviewed_alerts,

      SUM(status = 'Dismissed')
      AS dismissed_alerts,

      SUM(status = 'Escalated')
      AS escalated_alerts

    FROM alerts
  `;

  db.query(sql, (err, result) => {

    if (err) {
      console.error(err);
      return res.send("Error loading report");
    }

    res.render("officerReport", {
      report: result[0]
    });

  });

};

exports.showActionSuccessPage = (req, res) => {

  const alertId = req.params.id;
  const action = req.query.action;

  res.render("actionSuccess", {
    alertId,
    action
  });

};