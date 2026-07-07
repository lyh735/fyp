const db = require("../config/db");

function query(sql, values = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, values, (err, results) => (err ? reject(err) : resolve(results)));
  });
}

const EDITABLE_FIELDS = [
  "merchant_name",
  "business_category",
  "mcc_code",
  "merchant_average_amount",
  "merchant_risk_score",
  "operating_hours_start",
  "operating_hours_end",
  "risk_level",
  "country",
  "has_physical_location",
  "status",
];

function optionalText(value, maxLength) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return String(value).trim().slice(0, maxLength);
}

function normalizeMerchant(body) {
  const merchantName = optionalText(body.merchant_name, 100);
  const averageAmount = body.merchant_average_amount === "" || body.merchant_average_amount == null
    ? null
    : Number(body.merchant_average_amount);
  const riskScore = body.merchant_risk_score === "" || body.merchant_risk_score == null
    ? 0
    : Number(body.merchant_risk_score);

  if (!merchantName) throw new Error("Merchant name is required");
  if (averageAmount !== null && (!Number.isFinite(averageAmount) || averageAmount < 0)) {
    throw new Error("Average amount must be a non-negative number");
  }
  if (!Number.isInteger(riskScore) || riskScore < 0 || riskScore > 100) {
    throw new Error("Risk score must be a whole number from 0 to 100");
  }

  return {
    merchant_name: merchantName,
    business_category: optionalText(body.business_category, 100),
    mcc_code: optionalText(body.mcc_code, 20),
    merchant_average_amount: averageAmount,
    merchant_risk_score: riskScore,
    operating_hours_start: optionalText(body.operating_hours_start, 8),
    operating_hours_end: optionalText(body.operating_hours_end, 8),
    risk_level: optionalText(body.risk_level, 20),
    country: optionalText(body.country, 50) || "Singapore",
    has_physical_location: body.has_physical_location === true || body.has_physical_location === 1 || body.has_physical_location === "1" ? 1 : 0,
    status: optionalText(body.status, 30),
  };
}

exports.getMerchants = async (req, res) => {
  try {
    const merchants = await query(
      `SELECT m.*,
              COUNT(t.transaction_id) AS transaction_count,
              COALESCE(SUM(t.amount), 0) AS total_transaction_amount,
              MAX(COALESCE(t.txn_time, t.created_at)) AS last_transaction_at
       FROM merchants m
       LEFT JOIN transactions t ON t.merchant_id = m.merchant_id
       GROUP BY m.merchant_id
       ORDER BY m.merchant_name ASC`
    );
    res.json(merchants);
  } catch (err) {
    console.error("Unable to load merchants:", err);
    res.status(500).json({ message: "Unable to load merchants" });
  }
};

exports.getMerchantProfile = async (req, res) => {
  try {
    const merchants = await query(
      `SELECT m.*, creator.name AS created_by_name, updater.name AS updated_by_name
       FROM merchants m
       LEFT JOIN users creator ON creator.user_id = m.created_by
       LEFT JOIN users updater ON updater.user_id = m.updated_by
       WHERE m.merchant_id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!merchants.length) return res.status(404).json({ message: "Merchant not found" });

    const transactions = await query(
      `SELECT transaction_id, merchant_id, masked_payment_ref,
              masked_card_number, card_presence, terminal_id,
              payment_method, transaction_type, amount, currency, ip_address,
              country, txn_time, transaction_status, risk_score, risk_level,
              triggered_rules, processing_status, source_type, created_at
       FROM transactions
       WHERE merchant_id = ?
       ORDER BY COALESCE(txn_time, created_at) DESC`,
      [req.params.id]
    );

    res.json({ merchant: merchants[0], transactions });
  } catch (err) {
    console.error("Unable to load merchant profile:", err);
    res.status(500).json({ message: "Unable to load merchant profile" });
  }
};

exports.updateMerchantProfile = async (req, res) => {
  let normalized;
  try {
    normalized = normalizeMerchant(req.body || {});
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  try {
    const existing = await query("SELECT * FROM merchants WHERE merchant_id = ? LIMIT 1", [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: "Merchant not found" });

    if (normalized.mcc_code) {
      const mccRows = await query(
        "SELECT mcc_code FROM mcc_codes WHERE mcc_code = ? AND is_active = 1 LIMIT 1",
        [normalized.mcc_code]
      );
      if (!mccRows.length) {
        return res.status(400).json({ message: "MCC code is not a recognized, active code" });
      }
    }

    const values = EDITABLE_FIELDS.map((field) => normalized[field]);
    const result = await query(
      `UPDATE merchants SET
         merchant_name = ?, business_category = ?, mcc_code = ?,
         merchant_average_amount = ?, merchant_risk_score = ?,
         operating_hours_start = ?, operating_hours_end = ?, risk_level = ?,
         country = ?, has_physical_location = ?, status = ?,
         updated_by = ?, updated_at = NOW()
       WHERE merchant_id = ?`,
      [...values, req.user.id, req.params.id]
    );

    if (!result.affectedRows) return res.status(404).json({ message: "Merchant not found" });

    const updated = await query("SELECT * FROM merchants WHERE merchant_id = ? LIMIT 1", [req.params.id]);
    res.json({ message: "Merchant profile updated successfully", merchant: updated[0] });
  } catch (err) {
    console.error("Unable to update merchant profile:", err);
    res.status(500).json({ message: "Unable to update merchant profile" });
  }
};

exports.getMerchantTerminals = async (req, res) => {
  try {
    const terminals = await query(
      `SELECT terminal_id, merchant_id, label, status, created_at
       FROM terminals
       WHERE merchant_id = ?
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(terminals);
  } catch (err) {
    res.status(500).json({ message: "Unable to load terminals" });
  }
};

exports.createTerminal = async (req, res) => {
  const label = optionalText(req.body.label, 100) || "New terminal";

  try {
    const merchant = await query("SELECT merchant_id FROM merchants WHERE merchant_id = ? LIMIT 1", [req.params.id]);
    if (!merchant.length) return res.status(404).json({ message: "Merchant not found" });

    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const terminalId = `${req.params.id}-T${suffix}`;

    await query(
      `INSERT INTO terminals (terminal_id, merchant_id, label, status, created_by, updated_by)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      [terminalId, req.params.id, label, req.user.id, req.user.id]
    );

    const created = await query("SELECT * FROM terminals WHERE terminal_id = ? LIMIT 1", [terminalId]);
    res.json({ message: "Terminal added successfully", terminal: created[0] });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Terminal ID collision, please try again" });
    }
    res.status(500).json({ message: "Unable to add terminal" });
  }
};

exports.deleteTerminal = async (req, res) => {
  try {
    const result = await query(
      "DELETE FROM terminals WHERE terminal_id = ? AND merchant_id = ?",
      [req.params.terminalId, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Terminal not found" });
    res.json({ message: "Terminal deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Unable to delete terminal" });
  }
};
