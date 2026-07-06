const { query } = require("./dbQuery");

const SUPPORTED_RULE_TYPES = Object.freeze([
  "merchant_profile",
  "amount_multiplier",
  "velocity",
  "velocity_small_amount",
  "large_amount_frequency",
  "cancellation_velocity",
  "failure_then_success",
  "duplicate_transaction",
  "time",
  "customer_risk",
  "data_quality",
  "ip_validation",
  "high_risk_jurisdiction",
  "ip_country_mismatch",
]);

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
    threshold_value: toNullableNumber(row.threshold_value),
    threshold_count: toNullableNumber(row.threshold_count),
    time_window_seconds:
      seconds !== null ? seconds : minutes !== null ? minutes * 60 : null,
    points: Number(row.points || 0),
    is_active: Number(row.is_active) === 1,
  };
}

async function getActiveRulesByType() {
  const rows = await query(`
    SELECT
      rule_id,
      rule_name,
      rule_type,
      description,
      threshold_value,
      threshold_count,
      time_window_minutes,
      time_window_seconds,
      points,
      is_active,
      created_at,
      updated_at
    FROM compliance_rules
    WHERE is_active = 1
    ORDER BY rule_id ASC
  `);

  return rows.reduce((ruleMap, row) => {
    if (!row.rule_type || !SUPPORTED_RULE_TYPES.includes(row.rule_type)) {
      return ruleMap;
    }

    ruleMap[row.rule_type] = normalizeRule(row);
    return ruleMap;
  }, {});
}

async function getMerchantCategoryRisk(merchant = {}) {
  const mccCode = String(merchant.mcc_code || "").trim();
  const businessCategory = String(merchant.business_category || "").trim().toLowerCase();

  const rows = await query(
    `
      SELECT risk_id, mcc_code, category_keyword, category_name, points
      FROM merchant_category_risk
      WHERE is_active = 1
        AND (
          (mcc_code IS NOT NULL AND mcc_code <> '' AND mcc_code = ?)
          OR
          (
            category_keyword IS NOT NULL
            AND category_keyword <> ''
            AND ? <> ''
            AND ? LIKE CONCAT('%', LOWER(category_keyword), '%')
          )
        )
      ORDER BY
        CASE WHEN mcc_code = ? THEN 0 ELSE 1 END,
        points DESC,
        risk_id ASC
      LIMIT 1
    `,
    [mccCode, businessCategory, businessCategory, mccCode]
  );

  return rows[0] || null;
}

async function getHighRiskJurisdiction(country) {
  const normalizedCountry = String(country || "").trim();
  if (!normalizedCountry) return null;

  const rows = await query(
    `
      SELECT jurisdiction_id, country_code, country_name, risk_level, reason
      FROM high_risk_jurisdictions
      WHERE is_active = 1
        AND (
          UPPER(country_code) = UPPER(?)
          OR LOWER(country_name) = LOWER(?)
        )
      LIMIT 1
    `,
    [normalizedCountry, normalizedCountry]
  );

  return rows[0] || null;
}

module.exports = {
  SUPPORTED_RULE_TYPES,
  getActiveRulesByType,
  getMerchantCategoryRisk,
  getHighRiskJurisdiction,
};
