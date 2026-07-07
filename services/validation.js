const VALID_RISK_PROFILES = ["low", "medium", "high"];
const VALID_TRANSACTION_TYPES = ["online", "face_to_face"];
const VALID_PAYMENT_METHODS = [
  "Visa",
  "Mastercard",
  "Alipay",
  "WeChat Pay",
  "GrabPay",
  "ShopeePay",
  "PayNow",
  "SGQR",
];
const VALID_TRANSACTION_STATUSES = ["success", "completed", "cancelled", "canceled", "failed", "voided"];

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

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function validateTransaction(payload) {
  const errors = [];
  const missingRequiredInfo =
    !normalizeText(payload.masked_card_number) &&
    !normalizeText(payload.masked_payment_ref) &&
    !normalizeText(payload.terminal_id) &&
    !normalizeText(payload.payment_gateway_ref);

  const requiredFields = [
  "transaction_id",
  "merchant_id",
  "amount",
  "currency",
  "transaction_type",
  "timestamp",
  "customer_risk_profile",
];

  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === "") {
      errors.push(`${field} is required`);
    }
  }

  const amount = Number(payload.amount);
  const merchantAverageAmount =
    payload.merchant_average_amount === undefined ||
    payload.merchant_average_amount === null ||
    payload.merchant_average_amount === ""
      ? null
      : Number(payload.merchant_average_amount);
  const transactionType = normalizeText(payload.transaction_type);
  const customerRiskProfile = normalizeText(payload.customer_risk_profile)?.toLowerCase();
  const paymentMethod = normalizeText(payload.payment_method);
  const timestamp = toMysqlDateTime(payload.timestamp);
  const merchantRiskScore =
    payload.merchant_risk_score === undefined || payload.merchant_risk_score === null || payload.merchant_risk_score === ""
      ? null
      : Number(payload.merchant_risk_score);
  const transactionStatus = normalizeText(payload.transaction_status || payload.status)?.toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push("amount must be greater than 0");
  }

  if (merchantAverageAmount !== null && (!Number.isFinite(merchantAverageAmount) || merchantAverageAmount <= 0)) {
    errors.push("merchant_average_amount must be greater than 0");
  }

  if (customerRiskProfile && !VALID_RISK_PROFILES.includes(customerRiskProfile)) {
    errors.push("customer_risk_profile must be low, medium, or high");
  }

  if (transactionType && !VALID_TRANSACTION_TYPES.includes(transactionType)) {
    errors.push("transaction_type must be online or face_to_face");
  }

  if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    errors.push(`payment_method must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`);
  }

  if (transactionStatus && !VALID_TRANSACTION_STATUSES.includes(transactionStatus)) {
    errors.push(`transaction_status must be one of: ${VALID_TRANSACTION_STATUSES.join(", ")}`);
  }

  if (!timestamp) {
    errors.push("timestamp must be valid");
  }

  if (merchantRiskScore !== null && !Number.isInteger(merchantRiskScore)) {
    errors.push("merchant_risk_score must be an integer");
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
      merchant_average_amount: Number.isFinite(merchantAverageAmount)
        ? merchantAverageAmount
        : null,
      merchant_risk_score: merchantRiskScore ?? 0,
      merchant_risk_score_provided: merchantRiskScore !== null,
      has_physical_location: normalizeBoolean(
        payload.has_physical_location ?? payload.has_physical_store,
        true
      ),
      masked_payment_ref: normalizeText(payload.masked_payment_ref) || null,
      card_bin: normalizeText(payload.card_bin) || null,
      masked_card_number: normalizeText(payload.masked_card_number) || null,
      card_presence: normalizeText(payload.card_presence) || null,
      terminal_id: normalizeText(payload.terminal_id) || null,
      payment_gateway_ref: normalizeText(payload.payment_gateway_ref) || null,
      payment_method: paymentMethod || null,
      business_category: normalizeText(payload.business_category) || null,
      mcc_code: normalizeText(payload.mcc_code) || null,
      status: transactionStatus || "success",
      source_type: normalizeText(payload.source_type) || "text_input",
    },
    metadata: { missingRequiredInfo },
  };
}

module.exports = { validateTransaction };
