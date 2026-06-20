const db = require("../config/db");

exports.showAlertsPage = (req, res) => {

  const sql = `
    SELECT a.*, a.alert_id AS id, COALESCE(a.message, a.triggered_rules) AS reason,
           m.merchant_name, t.amount, t.currency, t.ip_address, t.country
    FROM alerts a
    LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
    LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
    ORDER BY a.created_at DESC
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


  const sql = `
    SELECT a.*, a.alert_id AS id, COALESCE(a.message, a.triggered_rules) AS reason,
           m.merchant_name, t.amount, t.currency, t.ip_address, t.country,
           u.name AS officer_name
    FROM alerts a
    LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
    LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
    LEFT JOIN users u ON a.reviewed_by = u.user_id
    WHERE a.alert_id = ?
    LIMIT 1
  `;

  db.query(sql, [alertId], (err, results) => {

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

  const sql = `
    SELECT a.*, a.alert_id AS id, m.merchant_name, t.amount, t.currency
    FROM alerts a
    LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
    LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
    WHERE a.alert_id = ?
    LIMIT 1
  `;

  db.query(sql, [alertId], (err, results) => {

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
  const selectAlertSql = "SELECT * FROM alerts WHERE alert_id = ? LIMIT 1";
  
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

    const findOfficerSql = "SELECT user_id FROM users WHERE name = ? LIMIT 1";
    const updateAlertSql = `
      UPDATE alerts
      SET status = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE alert_id = ?
    `;

    const insertActionSql = `
      INSERT INTO officer_actions
      (
        alert_id,
        officer_id,
        action_type,
        remarks
      )
      VALUES (?, ?, ?, ?)
    `;

    const insertAuditSql = `
      INSERT INTO audit_logs
      (
        user_id,
        event_type,
        table_name,
        record_id,
        message,
        new_value
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(findOfficerSql, [officer_name], (err, officers) => {

      if (err) {
        console.error(err);
        return res.status(500).send("Error finding officer");
      }

      if (officers.length === 0) {
        return res.status(400).send("Officer name must match an existing user account");
      }

      const officerId = officers[0].user_id;

      db.query(updateAlertSql, [newStatus, officerId, alert_id], (err) => {

        if (err) {
          console.error(err);
          return res.status(500).send("Error updating alert");
        }

      db.query(
        insertActionSql,
        [
          alert_id,
          officerId,
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
              officerId,
              eventType,
              "alerts",
              String(alert_id),
              message,
              action_type
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

  });

};

exports.showAuditLogsPage = (req, res) => {

  const sql = `
    SELECT al.audit_id AS log_id, al.*, u.name AS officer_name,
           al.new_value AS action, al.message AS details
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.user_id
    ORDER BY al.created_at DESC
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

      SUM(status = 'Pending' OR status = 'Pending Review' OR status = 'open')
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
