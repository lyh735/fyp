const RULE_TYPE_ALIASES = Object.freeze({
  merchant_profile: "merchant_category_risk",
  amount_multiplier: "large_transaction",
  velocity: "transaction_velocity",
  velocity_small_amount: "repeated_small_transactions",
  large_amount_frequency: "frequent_large_transactions",
  time: "outside_operating_hours",
  duplicate_transaction: "duplicate_payment_identifier",
});

const SUPPORTED_RULE_TYPES = Object.freeze([
  "large_transaction",
  "transaction_velocity",
  "repeated_small_transactions",
  "frequent_large_transactions",
  "outside_operating_hours",
  "daily_transaction_count_spike",
  "daily_transaction_value_spike",
  "merchant_average_deviation",
  "merchant_category_risk",
  "duplicate_payment_identifier",
  "repeated_identical_amounts",
  "data_quality",
  "ip_validation",
  "ip_country_mismatch",
  ...Object.keys(RULE_TYPE_ALIASES),
]);

function query(sql, values = []) {
  return require("./dbQuery").query(sql, values);
}

function canonicalRuleType(ruleType) {
  const normalized = String(ruleType || "").trim();
  return RULE_TYPE_ALIASES[normalized] || normalized;
}

function isSupportedRuleType(ruleType) {
  return SUPPORTED_RULE_TYPES.includes(String(ruleType || "").trim());
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRule(row) {
  const seconds = toNullableNumber(row.time_window_seconds);
  const minutes = toNullableNumber(row.time_window_minutes);

  return {
    ...row,
    rule_type: canonicalRuleType(row.rule_type),
    stored_rule_type: String(row.rule_type || "").trim(),
    threshold_value: toNullableNumber(row.threshold_value),
    threshold_count: toNullableNumber(row.threshold_count),
    time_window_seconds: seconds !== null ? seconds : minutes !== null ? minutes * 60 : null,
    points: Math.max(0, Number(row.points || 0)),
    is_active: Number(row.is_active) === 1,
  };
}

async function getActiveRulesByType() {
  const rows = await query(`
    SELECT rule_id, rule_name, rule_type, description, threshold_value,
           threshold_count, time_window_minutes, time_window_seconds,
           points, is_active, created_at, updated_at
    FROM compliance_rules
    WHERE is_active = 1
    ORDER BY rule_id ASC
  `);

  return rows.reduce((ruleMap, row) => {
    const ruleType = canonicalRuleType(row.rule_type);
    if (!isSupportedRuleType(ruleType)) return ruleMap;
    if (!ruleMap[ruleType]) ruleMap[ruleType] = normalizeRule(row);
    return ruleMap;
  }, {});
}

async function getMerchantCategoryRisk(merchant = {}) {
  const mccCode = String(merchant.mcc_code || "").trim();
  const businessCategory = String(merchant.business_category || "").trim().toLowerCase();

  const rows = await query(
    `
      SELECT risk_id, mcc_code, category_keyword, category_name,
             COALESCE(risk_points, points, 0) AS risk_points,
             COALESCE(risk_points, points, 0) AS points,
             COALESCE(risk_level, 'LOW') AS risk_level,
             COALESCE(priority_multiplier, 3) AS priority_multiplier,
             COALESCE(use_priority_multiplier, 1) AS use_priority_multiplier,
             expected_min_amount, expected_max_amount,
             expected_daily_count, expected_daily_value,
             velocity_count, velocity_window_seconds, is_active
      FROM merchant_category_risk
      WHERE is_active = 1
        AND (
          (mcc_code IS NOT NULL AND mcc_code <> '' AND mcc_code = ?)
          OR (
            category_keyword IS NOT NULL
            AND category_keyword <> ''
            AND ? <> ''
            AND ? LIKE CONCAT('%', LOWER(category_keyword), '%')
          )
        )
      ORDER BY CASE WHEN mcc_code = ? THEN 0 ELSE 1 END, points DESC, risk_id ASC
      LIMIT 1
    `,
    [mccCode, businessCategory, businessCategory, mccCode]
  );

  return rows[0] || null;
}

async function getMerchantCategoryProfiles() {
  return query(`
    SELECT risk_id, mcc_code, category_keyword, category_name,
           COALESCE(risk_level, 'LOW') AS risk_level,
           COALESCE(risk_points, points, 0) AS risk_points,
           COALESCE(priority_multiplier, 3) AS priority_multiplier,
           COALESCE(use_priority_multiplier, 1) AS use_priority_multiplier,
           expected_min_amount, expected_max_amount,
           expected_daily_count, expected_daily_value,
           velocity_count, velocity_window_seconds, is_active,
           created_at, updated_at
    FROM merchant_category_risk
    ORDER BY is_active DESC, mcc_code IS NULL, mcc_code ASC, category_name ASC
  `);
}

async function updateMerchantCategoryProfile(riskId, profile = {}) {
  const normalizedRiskLevel = String(profile.risk_level || "LOW").trim().toUpperCase();
  if (!["LOW", "MEDIUM", "ELEVATED", "HIGH", "VERY_HIGH"].includes(normalizedRiskLevel)) {
    throw new Error("Unsupported MCC risk level");
  }

  const values = [
    normalizedRiskLevel,
    toNullableNumber(profile.risk_points) ?? 0,
    toNullableNumber(profile.priority_multiplier) ?? 3,
    profile.use_priority_multiplier ? 1 : 0,
    toNullableNumber(profile.expected_min_amount),
    toNullableNumber(profile.expected_max_amount),
    toNullableNumber(profile.expected_daily_count),
    toNullableNumber(profile.expected_daily_value),
    toNullableNumber(profile.velocity_count),
    toNullableNumber(profile.velocity_window_seconds),
    profile.is_active ? 1 : 0,
    riskId,
  ];

  const result = await query(
    `
      UPDATE merchant_category_risk
      SET risk_level = ?, risk_points = ?, points = ?,
          priority_multiplier = ?, use_priority_multiplier = ?,
          expected_min_amount = ?, expected_max_amount = ?,
          expected_daily_count = ?, expected_daily_value = ?,
          velocity_count = ?, velocity_window_seconds = ?,
          is_active = ?, updated_at = NOW()
      WHERE risk_id = ?
    `,
    [
      values[0], values[1], values[1],
      values[2], values[3], values[4], values[5],
      values[6], values[7], values[8], values[9],
      values[10], values[11],
    ]
  );

  if (!result.affectedRows) throw new Error("MCC risk profile not found");
}

module.exports = {
  SUPPORTED_RULE_TYPES,
  RULE_TYPE_ALIASES,
  canonicalRuleType,
  isSupportedRuleType,
  getActiveRulesByType,
  getMerchantCategoryRisk,
  getMerchantCategoryProfiles,
  updateMerchantCategoryProfile,
};
