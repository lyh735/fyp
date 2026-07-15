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
  "merchant_max_transaction_amount",
  "merchant_risk_score",
  "operating_hours_start",
  "operating_hours_end",
  "risk_level",
  "country",
  "has_physical_location",
  "status",
];

const ACTIVE_STATUSES = new Set(["active", "inactive"]);

function optionalText(value, maxLength) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return String(value).trim().slice(0, maxLength);
}

function normalizeTime(value, label) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(11, 19);
  }

  const raw = optionalText(value, 40);
  if (!raw) return null;

  const isoMatch = raw.match(/T(\d{2}:\d{2}:\d{2})/);
  const timeCandidate = isoMatch ? isoMatch[1] : raw;

  const match = timeCandidate.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`${label} must be in HH:MM or HH:MM:SS format`);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || "0");
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`${label} is not a valid time`);
  }

  return `${match[1]}:${match[2]}:${String(seconds).padStart(2, "0")}`;
}

function normalizePhysicalLocation(value, required = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) throw new Error("Has physical location is required");
    return 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "yes", "y", "true"].includes(normalized)) return 1;
  if (["0", "no", "n", "false"].includes(normalized)) return 0;
  throw new Error("Has physical location must be Yes/No or 1/0");
}

function normalizeStatus(value, required = false) {
  const normalized = optionalText(value, 30)?.toLowerCase() || null;
  if (!normalized) {
    if (required) throw new Error("Status is required");
    return null;
  }
  if (!ACTIVE_STATUSES.has(normalized)) {
    throw new Error("Status must be active or inactive");
  }
  return normalized;
}

function normalizeMerchant(body, options = {}) {
  const { requireMerchantId = false, requireCoreFields = false } = options;
  const merchantId = optionalText(body.merchant_id, 50);
  const merchantName = optionalText(body.merchant_name, 100);
  const businessCategory = optionalText(body.business_category, 100);
  const mccCode = optionalText(body.mcc_code, 20);
  const averageAmount = body.merchant_average_amount === "" || body.merchant_average_amount == null
    ? null
    : Number(body.merchant_average_amount);
  const maxTransactionAmount = body.merchant_max_transaction_amount === "" || body.merchant_max_transaction_amount == null
    ? null
    : Number(body.merchant_max_transaction_amount);
  const riskScore = body.merchant_risk_score === "" || body.merchant_risk_score == null
    ? 0
    : Number(body.merchant_risk_score);
  const operatingHoursStart = normalizeTime(body.operating_hours_start, "Operating start time");
  const operatingHoursEnd = normalizeTime(body.operating_hours_end, "Operating end time");
  const country = optionalText(body.country, 50);
  const status = normalizeStatus(body.status, requireCoreFields);
  const hasPhysicalLocation = normalizePhysicalLocation(body.has_physical_location, requireCoreFields);

  if (requireMerchantId && !merchantId) throw new Error("Merchant ID is required");
  if (!merchantName) throw new Error("Merchant name is required");
  if (requireCoreFields && !businessCategory) throw new Error("Business category is required");
  if (requireCoreFields && !mccCode) throw new Error("MCC code is required");
  if (requireCoreFields && !operatingHoursStart) throw new Error("Operating start time is required");
  if (requireCoreFields && !operatingHoursEnd) throw new Error("Operating end time is required");
  if (requireCoreFields && !country) throw new Error("Country is required");
  if (operatingHoursStart && operatingHoursEnd && operatingHoursStart >= operatingHoursEnd) {
    throw new Error("Operating start time must be before end time; overnight hours are not supported");
  }
  if (averageAmount !== null && (!Number.isFinite(averageAmount) || averageAmount < 0)) {
    throw new Error("Average amount must be a non-negative number");
  }
  if (maxTransactionAmount !== null && (!Number.isFinite(maxTransactionAmount) || maxTransactionAmount < 0)) {
    throw new Error("Maximum transaction amount must be a non-negative number");
  }
  if (!Number.isInteger(riskScore) || riskScore < 0 || riskScore > 100) {
    throw new Error("Risk score must be a whole number from 0 to 100");
  }

  return {
    merchant_id: merchantId,
    merchant_name: merchantName,
    business_category: businessCategory,
    mcc_code: mccCode,
    merchant_average_amount: averageAmount,
    merchant_max_transaction_amount: maxTransactionAmount,
    merchant_risk_score: riskScore,
    operating_hours_start: operatingHoursStart,
    operating_hours_end: operatingHoursEnd,
    risk_level: optionalText(body.risk_level, 20),
    country: country || "Singapore",
    has_physical_location: hasPhysicalLocation,
    status,
  };
}

function normalizeImportRow(row) {
  return Object.entries(row || {}).reduce((normalized, [key, value]) => {
    const normalizedKey = String(key)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (normalizedKey) normalized[normalizedKey] = value;
    return normalized;
  }, {});
}

async function getActiveMccCode(mccCode) {
  if (!mccCode) return null;
  const rows = await query(
    "SELECT mcc_code FROM mcc_codes WHERE mcc_code = ? AND is_active = 1 LIMIT 1",
    [mccCode]
  );
  return rows[0] || null;
}

async function merchantExists(merchantId) {
  const rows = await query("SELECT merchant_id FROM merchants WHERE merchant_id = ? LIMIT 1", [merchantId]);
  return Boolean(rows.length);
}

async function validateMerchantReferenceData(merchant) {
  if (!merchant.mcc_code) return;
  const mccCode = await getActiveMccCode(merchant.mcc_code);
  if (!mccCode) {
    throw new Error("MCC code is not a recognized, active code");
  }
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
    console.error("Unable to load merchant details:", err);
    res.status(500).json({ message: "Unable to load merchant details" });
  }
};

exports.createMerchant = async (req, res) => {
  let normalized;
  try {
    normalized = normalizeMerchant(req.body || {}, {
      requireMerchantId: true,
      requireCoreFields: true,
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  try {
    await validateMerchantReferenceData(normalized);
    if (await merchantExists(normalized.merchant_id)) {
      return res.status(409).json({ message: "Merchant ID already exists" });
    }

    await query(
      `INSERT INTO merchants (
         merchant_id, merchant_name, business_category, mcc_code,
         merchant_average_amount, merchant_max_transaction_amount,
         merchant_risk_score, operating_hours_start,
         operating_hours_end, risk_level, country, has_physical_location,
         status, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalized.merchant_id,
        normalized.merchant_name,
        normalized.business_category,
        normalized.mcc_code,
        normalized.merchant_average_amount,
        normalized.merchant_max_transaction_amount,
        normalized.merchant_risk_score,
        normalized.operating_hours_start,
        normalized.operating_hours_end,
        normalized.risk_level,
        normalized.country,
        normalized.has_physical_location,
        normalized.status,
        req.user.id,
        req.user.id,
      ]
    );

    const created = await query("SELECT * FROM merchants WHERE merchant_id = ? LIMIT 1", [normalized.merchant_id]);
    res.status(201).json({ message: "Merchant created successfully", merchant: created[0] });
  } catch (err) {
    console.error("Unable to create merchant:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Merchant ID already exists" });
    }
    res.status(500).json({ message: "Unable to create merchant" });
  }
};

exports.updateMerchantProfile = async (req, res) => {
  let normalized;
  try {
    normalized = normalizeMerchant(req.body || {}, { requireCoreFields: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  try {
    const existing = await query("SELECT * FROM merchants WHERE merchant_id = ? LIMIT 1", [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: "Merchant not found" });

    await validateMerchantReferenceData(normalized);

    const values = EDITABLE_FIELDS.map((field) => normalized[field]);
    const result = await query(
      `UPDATE merchants SET
         merchant_name = ?, business_category = ?, mcc_code = ?,
         merchant_average_amount = ?, merchant_max_transaction_amount = ?,
         merchant_risk_score = ?,
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
    console.error("Unable to update merchant details:", err);
    res.status(500).json({ message: "Unable to update merchant details" });
  }
};

exports.uploadMerchants = async (req, res) => {
  const rows = req.body?.merchants;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "The upload contains no merchant rows" });
  }
  if (rows.length > 500) {
    return res.status(400).json({ message: "A maximum of 500 merchants is allowed per upload" });
  }

  const seenMerchantIds = new Set();
  const mccCache = new Map();
  const results = [];

  for (let index = 0; index < rows.length; index++) {
    const row = normalizeImportRow(rows[index]);
    const merchantId = optionalText(row.merchant_id, 50);

    try {
      const normalized = normalizeMerchant(row, {
        requireMerchantId: true,
        requireCoreFields: true,
      });

      if (seenMerchantIds.has(normalized.merchant_id)) {
        throw new Error("duplicate merchant_id in this upload");
      }
      seenMerchantIds.add(normalized.merchant_id);

      if (!mccCache.has(normalized.mcc_code)) {
        mccCache.set(normalized.mcc_code, await getActiveMccCode(normalized.mcc_code));
      }
      if (!mccCache.get(normalized.mcc_code)) {
        throw new Error("MCC code is not a recognized, active code");
      }
      if (await merchantExists(normalized.merchant_id)) {
        throw new Error("merchant_id already exists");
      }

      await query(
        `INSERT INTO merchants (
           merchant_id, merchant_name, business_category, mcc_code,
           merchant_average_amount, merchant_max_transaction_amount,
           merchant_risk_score, operating_hours_start,
           operating_hours_end, risk_level, country, has_physical_location,
           status, created_by, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized.merchant_id,
          normalized.merchant_name,
          normalized.business_category,
          normalized.mcc_code,
          normalized.merchant_average_amount,
          normalized.merchant_max_transaction_amount,
          normalized.merchant_risk_score,
          normalized.operating_hours_start,
          normalized.operating_hours_end,
          normalized.risk_level,
          normalized.country,
          normalized.has_physical_location,
          normalized.status,
          req.user.id,
          req.user.id,
        ]
      );

      results.push({
        row: index + 2,
        merchant_id: normalized.merchant_id,
        status: "processed",
      });
    } catch (err) {
      results.push({
        row: index + 2,
        merchant_id: merchantId,
        status: "failed",
        errors: [err.message || "Unable to process merchant"],
      });
    }
  }

  const succeeded = results.filter((result) => result.status === "processed").length;
  res.status(succeeded > 0 ? 200 : 422).json({
    message: `Processed ${succeeded} of ${rows.length} merchants`,
    summary: {
      total: rows.length,
      succeeded,
      failed: rows.length - succeeded,
    },
    results,
  });
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
