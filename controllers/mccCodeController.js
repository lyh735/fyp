const { query } = require("../services/dbQuery");

function normalizeMccCode(value) {
  return String(value || "").trim().slice(0, 20);
}

function normalizeDescription(value) {
  return String(value || "").trim().slice(0, 150);
}

exports.getMccCodes = async (req, res) => {
  try {
    const rows = await query(
      `SELECT mcc_code,
              category_name AS description,
              is_active,
              created_at,
              updated_at
       FROM merchant_category_risk
       WHERE mcc_code IS NOT NULL
         AND mcc_code <> ''
       ORDER BY mcc_code ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Unable to load MCC risk profiles" });
  }
};

exports.createMccCode = async (req, res) => {
  const mccCode = normalizeMccCode(req.body.mcc_code);
  const description = normalizeDescription(req.body.description);

  if (!mccCode || !description) {
    return res.status(400).json({ message: "MCC code and description are required" });
  }

  try {
    await query(
      `INSERT INTO merchant_category_risk
         (mcc_code, category_name, risk_level, risk_points, is_active)
       VALUES (?, ?, 'LOW', 0, 1)
       ON DUPLICATE KEY UPDATE
         category_name = VALUES(category_name),
         is_active = 1,
         updated_at = NOW()`,
      [mccCode, description]
    );
    res.json({ message: "MCC risk profile added successfully" });
  } catch (err) {
    res.status(500).json({ message: "Unable to add MCC risk profile" });
  }
};

exports.deleteMccCode = async (req, res) => {
  try {
    const result = await query(
      "UPDATE merchant_category_risk SET is_active = 0, updated_at = NOW() WHERE mcc_code = ?",
      [req.params.code]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "MCC risk profile not found" });
    res.json({ message: "MCC risk profile deactivated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Unable to deactivate MCC risk profile" });
  }
};
