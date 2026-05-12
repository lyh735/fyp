const VALID_RISK_PROFILES = ["low", "medium", "high"];
const VALID_TRANSACTION_TYPES = ["online", "face_to_face"];

function toMysqlDateTime(value) {
  const textValue = String(value || "").trim();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const localTimestamp = textValue.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/
  );
  if (localTimestamp) {
    return `${localTimestamp[1]} ${localTimestamp[2]}`;
  }

  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value;
}

function validateTransaction(payload) {
  const errors = [];
  const countryWasDefaulted = !payload.country;

  const requiredFields = [
    "transaction_id",
    "merchant_id",
    "amount",
    "currency",
    "transaction_type",
    "timestamp",
    "customer_risk_profile",
    "merchant_average_amount",
  ];

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  const amount = Number(payload.amount);
  const merchantAverageAmount = Number(payload.merchant_average_amount);
  const transactionType = normalizeText(payload.transaction_type);
  const customerRiskProfile = normalizeText(payload.customer_risk_profile)?.toLowerCase();
  const timestamp = toMysqlDateTime(payload.timestamp);

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push("amount must be greater than 0");
  }

  if (!Number.isFinite(merchantAverageAmount) || merchantAverageAmount <= 0) {
    errors.push("merchant_average_amount must be greater than 0");
  }

  if (customerRiskProfile && !VALID_RISK_PROFILES.includes(customerRiskProfile)) {
    errors.push("customer_risk_profile must be low, medium, or high");
  }

  if (transactionType && !VALID_TRANSACTION_TYPES.includes(transactionType)) {
    errors.push("transaction_type must be online or face_to_face");
  }

  if (transactionType === "online" && !normalizeText(payload.ip_address)) {
    errors.push("ip_address is required for online transactions");
  }

  if (!timestamp) {
    errors.push("timestamp must be valid");
  }

  if (errors.length) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    transaction: {
      transaction_id: normalizeText(payload.transaction_id),
      merchant_id: normalizeText(payload.merchant_id),
      amount,
      currency: normalizeText(payload.currency).toUpperCase(),
      transaction_type: transactionType,
      ip_address: normalizeText(payload.ip_address) || null,
      country: normalizeText(payload.country) || "Singapore",
      timestamp,
      customer_risk_profile: customerRiskProfile,
      merchant_average_amount: merchantAverageAmount,
    },
    metadata: { countryWasDefaulted },
  };
}

module.exports = { validateTransaction };
