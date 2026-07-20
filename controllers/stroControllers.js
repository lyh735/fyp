const db = require("../config/db");

/**
 * Show STR drafts submitted for STRO review.
 */
exports.showDashboard = (req, res) => {
  const sql = `
    SELECT
      s.str_id,
      s.alert_id,
      s.str_reference_number,
      s.narrative_text,
      s.status,
      s.generated_at,
      s.updated_at,
      s.stro_feedback,
      s.stro_reviewed_at,

      a.transaction_id,
      a.merchant_id,
      a.risk_score,
      a.risk_level,
      a.priority,
      a.message,

      m.merchant_name,

      t.amount,
      t.currency,
      t.country

    FROM str_reports s

    LEFT JOIN alerts a
      ON s.alert_id = a.alert_id

    LEFT JOIN merchants m
      ON a.merchant_id = m.merchant_id

    LEFT JOIN transactions t
      ON a.transaction_id = t.transaction_id

    WHERE s.status IN (
      'pending_stro_review',
      'feedback_required',
      'approved_by_stro'
    )

    ORDER BY
      CASE
        WHEN s.status = 'pending_stro_review' THEN 1
        WHEN s.status = 'feedback_required' THEN 2
        WHEN s.status = 'approved_by_stro' THEN 3
        ELSE 4
      END,
      s.updated_at DESC
  `;

  db.query(sql, (err, drafts) => {
    if (err) {
      console.error(
        "Error loading STRO dashboard:",
        err
      );

      return res.status(500).send(
        "Error loading STRO dashboard: " +
        err.message
      );
    }

    return res.render("stroDashboard", {
      drafts,
      user: req.session?.user || null
    });
  });
};

/**
 * View one STR draft.
 */
exports.viewDraft = (req, res) => {
  const strId = req.params.strId;

  const sql = `
    SELECT
      s.*,

      a.transaction_id,
      a.merchant_id,
      a.risk_score,
      a.risk_level,
      a.priority,
      a.message,
      CAST(a.triggered_rules AS CHAR) AS triggered_rules,
      a.created_at AS alert_created_at,

      m.merchant_name,
      m.mcc_code,

      t.amount,
      t.currency,
      t.country,
      t.ip_address

    FROM str_reports s

    LEFT JOIN alerts a
      ON s.alert_id = a.alert_id

    LEFT JOIN merchants m
      ON a.merchant_id = m.merchant_id

    LEFT JOIN transactions t
      ON a.transaction_id = t.transaction_id

    WHERE s.str_id = ?
    LIMIT 1
  `;

  db.query(sql, [strId], (err, results) => {
    if (err) {
      console.error(
        "Error loading STR draft:",
        err
      );

      return res.status(500).send(
        "Error loading STR draft: " +
        err.message
      );
    }

    if (results.length === 0) {
      return res.status(404).send(
        "STR draft not found"
      );
    }

    const draft = results[0];

    let triggeredRules = [];

    try {
      if (Array.isArray(draft.triggered_rules)) {
        triggeredRules = draft.triggered_rules;
      } else if (draft.triggered_rules) {
        const parsedRules = JSON.parse(
          draft.triggered_rules
        );

        triggeredRules =
          Array.isArray(parsedRules)
            ? parsedRules
            : [String(draft.triggered_rules)];
      }
    } catch (parseError) {
      triggeredRules = draft.triggered_rules
        ? [String(draft.triggered_rules)]
        : [];
    }

    return res.render("stroReviewDraft", {
      draft,
      triggeredRules,
      reviewed: req.query.reviewed === "1",
      user: req.session?.user || null
    });
  });
};

/**
 * STRO reviewer can:
 * 1. Send feedback to the analyst
 * 2. Approve the STR draft
 */
exports.reviewDraft = (req, res) => {
  const strId = req.params.strId;

  const {
    decision,
    stro_feedback
  } = req.body;

  const allowedDecisions = [
    "send_feedback",
    "approve"
  ];

  if (!allowedDecisions.includes(decision)) {
    return res.status(400).send(
      "Invalid STRO review action"
    );
  }

  if (
    decision === "send_feedback" &&
    (!stro_feedback ||
      stro_feedback.trim() === "")
  ) {
    return res.status(400).send(
      "Feedback is required before returning the STR draft to the analyst"
    );
  }

  const reviewerId = Number(
    req.session?.user?.userId ||
    req.session?.user?.user_id ||
    1
  );

  if (
    !Number.isInteger(reviewerId) ||
    reviewerId <= 0
  ) {
    return res.status(401).send(
      "A valid STRO reviewer account is required"
    );
  }

  const newStatus =
    decision === "approve"
      ? "approved_by_stro"
      : "feedback_required";

  const feedback =
    stro_feedback &&
    stro_feedback.trim() !== ""
      ? stro_feedback.trim()
      : null;

  const sql = `
    UPDATE str_reports
    SET
      status = ?,
      stro_reviewed_by = ?,
      stro_feedback = ?,
      stro_reviewed_at = NOW(),
      approved_at = CASE
        WHEN ? = 'approved_by_stro'
        THEN NOW()
        ELSE approved_at
      END,
      updated_at = NOW()
    WHERE str_id = ?
      AND status = 'pending_stro_review'
  `;

  db.query(
    sql,
    [
      newStatus,
      reviewerId,
      feedback,
      newStatus,
      strId
    ],
    (err, result) => {
      if (err) {
        console.error(
          "Error reviewing STR draft:",
          err
        );

        return res.status(500).send(
          "Error reviewing STR draft: " +
          err.message
        );
      }

      if (result.affectedRows === 0) {
        return res.status(400).send(
          "This STR draft is not currently pending STRO review"
        );
      }

      return res.redirect(
        `/stro/drafts/${strId}?reviewed=1`
      );
    }
  );
};