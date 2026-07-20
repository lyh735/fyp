const db = require("../config/db");

exports.showAlertsPage = (req, res) => {

  const sql = `
    SELECT a.*, a.alert_id AS id, COALESCE(a.message, a.triggered_rules) AS reason,
           m.merchant_name, m.mcc_code, t.amount, t.currency, t.ip_address, t.country,
           mcr.category_name AS mcc_category_name,
           COALESCE(mcr.risk_level, 'LOW') AS mcc_risk_level
    FROM alerts a
    LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
    LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
    LEFT JOIN merchant_category_risk mcr ON mcr.is_active = 1 AND mcr.mcc_code = m.mcc_code
    ORDER BY COALESCE(a.priority_score, a.risk_score, 0) DESC, a.created_at DESC
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
           m.merchant_name, t.amount, t.currency, t.ip_address, t.country, t.terminal_id,
           m.mcc_code, m.merchant_risk_score,
           mcr.category_name AS mcc_category_name,
           COALESCE(mcr.risk_level, 'LOW') AS mcc_risk_level,
           u.name AS officer_name
    FROM alerts a
    LEFT JOIN transactions t ON a.transaction_id = t.transaction_id
    LEFT JOIN merchants m ON a.merchant_id = m.merchant_id
    LEFT JOIN merchant_category_risk mcr ON mcr.is_active = 1 AND mcr.mcc_code = m.mcc_code
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
      alert: results[0],
      canTakeAction: String(req.user?.role || "").trim().toLowerCase() === "analyst"
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

    if (["close_case", "escalate_to_stro"].includes(action_type) && alert.status !== "Pending") {
      const actionLabel = action_type === "close_case" ? "dismissed" : "escalated";
      return res.status(400).send(`Only pending alerts can be ${actionLabel}`);
    }

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

exports.handleStrDraftSubmission = (req, res) => {
  const alertIdInput =
    req.params?.alertId ||
    req.body?.alert_id ||
    req.body?.alertId ||
    req.body?.id;

  const draftIdInput =
    req.body?.str_id ||
    req.body?.draft_id ||
    req.body?.strId ||
    req.params?.strId;

  const submitAction = String(
    req.body?.submit_action || "save_draft"
  ).trim();

  const generatedBy = Number(
    req.user?.user_id ||
    req.user?.id ||
    1
  );

  console.log("STR submission:", {
    alertIdInput,
    draftIdInput,
    submitAction,
    generatedBy
  });

  const narrativeText = String(
    req.body?.narrative_text ||
    req.body?.narrative ||
    req.body?.str_narrative ||
    "Draft updated from form submission."
  ).trim();

  const desiredStatus = submitAction === "submit_approval" ? "pending_stro_review" : "draft";

  const continueSubmission = (alertId) => {
    if (!Number.isInteger(alertId) || alertId <= 0) {
      return res.status(400).send("Alert ID is required");
    }

    const selectSql = `
      SELECT str_id, status
      FROM str_reports
      WHERE alert_id = ?
      ORDER BY updated_at DESC, str_id DESC
      LIMIT 1
    `;

    db.query(selectSql, [alertId], (err, rows) => {
      if (err) {
        console.error("Error looking up STR draft for update:", err.message);
        return res.status(500).send("Error saving STR draft: " + err.message);
      }

      const existingDraft = rows[0];
      const saveSql = existingDraft
        ? `
            UPDATE str_reports
            SET narrative_text = ?, status = ?, updated_at = NOW()
            WHERE str_id = ?
          `
        : `
            INSERT INTO str_reports
            (alert_id, generated_by, narrative_text, status)
            VALUES (?, ?, ?, ?)
          `;

      const saveValues = existingDraft
        ? [narrativeText || "Draft updated from form submission.", desiredStatus, existingDraft.str_id]
        : [alertId, generatedBy, narrativeText || "Draft updated from form submission.", desiredStatus];

      db.query(saveSql, saveValues, (saveErr, saveResult) => {
        if (saveErr) {
          console.error("Error saving STR draft:", saveErr.message);
          return res.status(500).send("Error saving STR draft: " + saveErr.message);
        }

        const strId = existingDraft ? existingDraft.str_id : saveResult.insertId;
        return res.redirect(`/api/officer/str/view/${strId}`);
      });
    });
  };

  const resolvedAlertId = Number(alertIdInput);

  if (Number.isInteger(resolvedAlertId) && resolvedAlertId > 0) {
    return continueSubmission(resolvedAlertId);
  }

  const draftId = Number(draftIdInput);
  if (Number.isInteger(draftId) && draftId > 0) {
    return db.query(
      "SELECT alert_id FROM str_reports WHERE str_id = ? LIMIT 1",
      [draftId],
      (err, rows) => {
        if (err) {
          console.error("Error resolving draft alert id:", err.message);
          return res.status(500).send("Error resolving draft alert id: " + err.message);
        }

        if (!rows || rows.length === 0) {
          return res.status(400).send("Alert ID is required");
        }

        return continueSubmission(Number(rows[0].alert_id));
      }
    );
  }

  return res.status(400).send("Alert ID is required");
};

exports.generateSTRDraft = (req, res) => {
  const alertId = Number(req.params.alertId);
  const generatedBy = Number(req.user?.user_id || req.user?.id);

  if (!Number.isInteger(alertId) || alertId <= 0) {
    return res.status(400).send("Alert ID is required");
  }

  if (!Number.isInteger(generatedBy) || generatedBy <= 0) {
    return res.status(401).send(
      "Authenticated user id is required to generate an STR draft"
    );
  }

  const alertSql = `
    SELECT * FROM alerts
    WHERE alert_id = ?
  `;

  db.query(alertSql, [alertId], (err, results) => {
    if (err) {
      console.error("Error fetching alert:", err.message);
      return res.send("Error fetching alert: " + err.message);
    }

    if (results.length === 0) {
      return res.send("Alert not found");
    }

    const alert = results[0];

    const strReference = "STR-" + new Date().getFullYear() + "-" + Date.now();

    const narrativeText = `
Suspicious Transaction Report Draft

Transaction ID: ${alert.transaction_id || "N/A"}
Merchant ID: ${alert.merchant_id || "N/A"}
Risk Level: ${alert.risk_level || "N/A"}
Risk Score: ${alert.risk_score || "N/A"}

Reason for Suspicion:
This transaction was flagged by the AML monitoring system due to a ${alert.risk_level || "suspicious"} risk rating with a risk score of ${alert.risk_score || "N/A"}.

Triggered Rule(s):
${alert.triggered_rules || "No triggered rules recorded."}

Alert Message:
${alert.message || "No alert message recorded."}

Compliance Assessment:
Based on the risk indicators, this transaction appears unusual and may require further investigation by the compliance officer. The case is recommended for STR review before submission to STRO.

Recommended Action:
Prepare STR draft and escalate for approval.
`;


    const insertSql = `
      INSERT INTO str_reports
      (alert_id, generated_by, str_reference_number, narrative_text, status)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
  insertSql,
  [
    Number(alert.alert_id),
    generatedBy,
    strReference,
    narrativeText,
    "draft"
  ],
    
      (err, result) => {
        if (err) {
          console.error("Error generating STR draft:", err.message);
          return res.send("Error generating STR draft: " + err.message);
        }

        res.redirect("/api/officer/str/view/" + result.insertId);
      }
    );
  });
};

exports.viewSTRDraft = (req, res) => {
  const strId = req.params.strId;


  const sql = `
    SELECT 
      s.*,
      a.transaction_id,
      a.merchant_id,
      a.risk_score,
      a.risk_level,
      CAST(a.triggered_rules AS CHAR) AS triggered_rules,
      a.message
    FROM str_reports s
    LEFT JOIN alerts a 
      ON s.alert_id = a.alert_id
    WHERE s.str_id = ?
  `;


  db.query(sql, [strId], (err, results) => {
    if (err) {
      console.error("Error fetching STR draft:", err.message);
      return res.send("Error fetching STR draft: " + err.message);
    }

    if (results.length === 0) {
      return res.send("STR draft not found");
    }

    const draft = results[0];

    res.render("strDraft", {
      str: draft,
      strDraft: draft,
      alert: {
        alert_id: draft.alert_id,
        transaction_id: draft.transaction_id,
        merchant_id: draft.merchant_id,
        risk_score: draft.risk_score,
        risk_level: draft.risk_level,
        triggered_rules: draft.triggered_rules,
        message: draft.message
      }
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

exports.submitSTRToSTRO = (req, res) => {
  const strId = Number(req.params.strId);

  if (!Number.isInteger(strId) || strId <= 0) {
    return res.status(400).send("STR ID is required");
  }

  const sql = `
    UPDATE str_reports
    SET
      status = 'pending_stro_review',
      updated_at = NOW()
    WHERE str_id = ?
      AND status IN (
        'draft',
        'feedback_required'
      )
  `;

  db.query(sql, [strId], (err, result) => {
    if (err) {
      console.error("Error submitting STR to STRO:", err.message);
      return res.status(500).send(
        "Error submitting STR to STRO: " + err.message
      );
    }

    if (result.affectedRows === 0) {
      return res.status(400).send(
        "This STR draft cannot be submitted in its current status"
      );
    }

    return res.redirect(
      `/api/officer/str/view/${strId}?submitted=1`
    );
  });
};
