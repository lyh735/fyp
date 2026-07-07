const { query } = require("../services/dbQuery");
const { ensureDefaultMccCodes } = require("../services/schema");

exports.getMccCodes = async (req, res) => {
  try {
    await ensureDefaultMccCodes(req.user.id);
    const rows = await query(
      `SELECT mcc_code, description, is_active, created_at, updated_at
       FROM mcc_codes
       ORDER BY mcc_code ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Unable to load MCC codes" });
  }
};

exports.createMccCode = async (req, res) => {
  const mccCode = String(req.body.mcc_code || "").trim();
  const description = String(req.body.description || "").trim();

  if (!mccCode || !description) {
    return res.status(400).json({ message: "MCC code and description are required" });
  }

  try {
    await query(
      `INSERT INTO mcc_codes (mcc_code, description, is_active, created_by, updated_by)
       VALUES (?, ?, 1, ?, ?)`,
      [mccCode, description, req.user.id, req.user.id]
    );
    res.json({ message: "MCC code added successfully" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "MCC code already exists" });
    }
    res.status(500).json({ message: "Unable to add MCC code" });
  }
};

exports.deleteMccCode = async (req, res) => {
  try {
    const result = await query("DELETE FROM mcc_codes WHERE mcc_code = ?", [req.params.code]);
    if (!result.affectedRows) return res.status(404).json({ message: "MCC code not found" });
    res.json({ message: "MCC code deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Unable to delete MCC code" });
  }
};
