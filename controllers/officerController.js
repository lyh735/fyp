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
    action_type: requestedActionType,
    remarks
  } = req.body;
  const actionAliases = {
    review: "review_started",
    dismiss: "close_case",
    escalate: "escalate_to_stro",
  };
  const action_type = actionAliases[requestedActionType] || requestedActionType;
  const allowedActionTypes = new Set([
    "review_started", "add_remark", "escalate_to_stro",
    "close_case", "reassign_case",
  ]);
  if (!allowedActionTypes.has(action_type)) {
    return res.status(400).send("Unsupported case action");
  }

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
    let newStatus = alert.status;

    if (action_type === "review_started") {
      newStatus = "Pending Review";
    }

    if (action_type === "close_case") {
      newStatus = "Closed";
    }

    if (action_type === "escalate_to_stro") {
      newStatus = "Escalated to STRO";
    }

    const findOfficerSql = `
      SELECT user_id FROM users
      WHERE name = ? AND role = 'analyst' AND status = 'active'
      LIMIT 1
    `;
    const updateAlertSql = `
      UPDATE alerts
      SET status = ?, reviewed_by = ?, reviewed_at = NOW(),
          escalated_at = CASE WHEN ? = 'Escalated to STRO' THEN NOW() ELSE escalated_at END
      WHERE alert_id = ?
    `;

    const insertActionSql = `
      INSERT INTO case_actions
      (
        alert_id,
        user_id,
        action_type,
        status_after_action,
        remarks
      )
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(findOfficerSql, [officer_name], (err, officers) => {

      if (err) {
        console.error(err);
        return res.status(500).send("Error finding officer");
      }

      if (officers.length === 0) {
        return res.status(400).send("Analyst name must match an active analyst account");
      }

      const officerId = officers[0].user_id;

      db.query(updateAlertSql, [newStatus, officerId, newStatus, alert_id], (err) => {

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
          newStatus,
          remarks
        ],
        (err) => {

          if (err) {
            console.error(err);
            return res.status(500).send("Error saving officer action");
          }

          res.redirect(
            `/api/officer/action-success/${alert_id}?action=${action_type}`
          );

        }
      );

      });
    });

  });

};

exports.showAuditLogsPage = (req, res) => {

  const sql = `
    SELECT a.alert_id, a.transaction_id, a.merchant_id,
           a.risk_level, a.status AS current_status, a.created_at AS alert_created_at,
           m.merchant_name,
           ca.action_id, ca.created_at AS action_created_at, ca.action_type,
           ca.status_after_action, ca.remarks,
           u.name AS user_name, u.role AS user_role
    FROM alerts a
    LEFT JOIN merchants m ON m.merchant_id = a.merchant_id
    LEFT JOIN case_actions ca ON ca.alert_id = a.alert_id
    LEFT JOIN users u ON u.user_id = ca.user_id
    ORDER BY a.created_at DESC, ca.created_at ASC, ca.action_id ASC
  `;

  db.query(sql, (err, rows) => {

    if (err) {
      console.error(err);
      return res.send("Error loading audit logs");
    }

    const cases = [];
    const caseMap = new Map();
    for (const row of rows) {
      let auditCase = caseMap.get(row.alert_id);
      if (!auditCase) {
        auditCase = {
          alert_id: row.alert_id,
          transaction_id: row.transaction_id,
          merchant_id: row.merchant_id,
          merchant_name: row.merchant_name,
          risk_level: row.risk_level,
          current_status: row.current_status,
          alert_created_at: row.alert_created_at,
          timeline: [],
        };
        caseMap.set(row.alert_id, auditCase);
        cases.push(auditCase);
      }
      if (row.action_id) {
        auditCase.timeline.push({
          action_id: row.action_id,
          created_at: row.action_created_at,
          user_name: row.user_name,
          role: row.user_role,
          action_type: row.action_type,
          status_after_action: row.status_after_action,
          remarks: row.remarks,
        });
      }
    }

    for (const auditCase of cases) {
      if (!auditCase.timeline.some((item) => item.action_type === "alert_created")) {
        auditCase.timeline.unshift({
          action_id: null,
          created_at: auditCase.alert_created_at,
          user_name: "System",
          role: "system",
          action_type: "alert_created",
          status_after_action: "Pending",
          remarks: "Alert created before case-action tracking was available.",
        });
      }
    }

    res.render("auditLogs", { cases });

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

      SUM(status = 'Dismissed' OR status = 'Closed')
      AS dismissed_alerts,

      SUM(status = 'Escalated' OR status = 'Escalated to STRO')
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
