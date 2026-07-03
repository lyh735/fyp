const net = require("net");
const { getRiskLevel, getTransactionStatus } = require("./riskScoring");

const MCC_RISK_PROFILE = {
  "4511": { points: 20, category: "Airlines / travel" },
  "4722": { points: 20, category: "Travel agencies / tourism" },
  "4789": { points: 20, category: "Transportation / travel services" },
  "4812": { points: 30, category: "Financial / telecom payment services" },
  "4829": { points: 30, category: "Money transfer / remittance" },
  "5311": { points: 10, category: "Retail / department stores" },
  "5411": { points: 5, category: "Grocery stores" },
  "5541": { points: 10, category: "Retail / service stations" },
  "5611": { points: 10, category: "Retail / apparel" },
  "5621": { points: 10, category: "Retail / apparel" },
  "5631": { points: 10, category: "Retail / accessories" },
  "5641": { points: 10, category: "Retail / children clothing" },
  "5651": { points: 10, category: "Retail / clothing" },
  "5661": { points: 10, category: "Retail / shoes" },
  "5691": { points: 10, category: "Retail / clothing" },
  "5712": { points: 10, category: "Retail / furniture" },
  "5732": { points: 15, category: "Electronics" },
  "5812": { points: 5, category: "Restaurants" },
  "5813": { points: 5, category: "Bars / food and beverage" },
  "5814": { points: 5, category: "Fast food" },
  "5942": { points: 10, category: "Retail / bookstores" },
  "5964": { points: 10, category: "Retail / direct marketing" },
  "5999": { points: 10, category: "Miscellaneous retail" },
  "6012": { points: 30, category: "Financial institutions" },
  "6051": { points: 30, category: "Money services / money orders" },
  "7011": { points: 20, category: "Hotel / lodging" },
  "7512": { points: 20, category: "Vehicle rental / travel" },
  "7995": { points: 30, category: "Gambling / betting" },
};

const CATEGORY_RISK_PROFILE = [
  { pattern: /\b(f&b|food|restaurant|fast food|cafe|coffee|dining|beverage)\b/i, points: 5, category: "F&B / restaurant / fast food" },
  { pattern: /\b(retail|shop|store|fashion|apparel|clothing|grocery|supermarket)\b/i, points: 10, category: "Retail" },
  { pattern: /\b(electronic|electronics|computer|mobile|phone|gadget)\b/i, points: 15, category: "Electronics" },
  { pattern: /\b(travel|tourism|hotel|lodging|airline|ticket|tour)\b/i, points: 20, category: "Travel / tourism / hotel" },
  { pattern: /\b(money service|money services|remittance|financial|finance|payment service|gambling|betting|casino)\b/i, points: 30, category: "Money service / remittance / financial service / gambling" },
];

function getMerchantMccRisk(txn, merchant = {}) {
  const mcc = String(merchant?.mcc_code || txn.mcc_code || "").trim();
  const profile = MCC_RISK_PROFILE[mcc];

  if (profile) {
    return {
      points: profile.points,
      rule: `Merchant MCC ${mcc} - ${profile.category}`,
    };
  }

  const categoryText = String(merchant?.business_category || txn.business_category || "").trim();
  const categoryProfile = CATEGORY_RISK_PROFILE.find((item) => item.pattern.test(categoryText));
  if (categoryProfile) {
    return {
      points: categoryProfile.points,
      rule: `Merchant category base risk - ${categoryProfile.category}`,
    };
  }

  const points = Number(merchant?.merchant_risk_score || txn.merchant_risk_score || 0);
  return {
    points,
    rule: "Merchant profile base risk score applied",
  };
}

function hasInvalidIp(txn) {
  if (txn.transaction_type !== "online") return false;
  return !txn.ip_address || net.isIP(txn.ip_address) === 0;
}

function isOutsideMerchantOperatingHours(timestamp, merchant = {}) {
  if (!merchant?.operating_hours_start || !merchant?.operating_hours_end) {
    return false;
  }

  const txnTime = new Date(timestamp);
  const txnMinutes = txnTime.getHours() * 60 + txnTime.getMinutes();

  const [startHour, startMin] = String(merchant.operating_hours_start)
    .split(":")
    .map(Number);

  const [endHour, endMin] = String(merchant.operating_hours_end)
    .split(":")
    .map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) {
    return false;
  }

  if (startMinutes <= endMinutes) {
    return txnMinutes < startMinutes || txnMinutes > endMinutes;
  }

  return txnMinutes > endMinutes && txnMinutes < startMinutes;
}

function evaluateTransaction(txn, context = {}) {
  let risk_score = 0;
  const triggered_rules = [];
  const merchant = context.merchant || {};

  function trigger(rule, points) {
    risk_score += points;
    triggered_rules.push(`+${points} ${rule}`);
  }

  const merchantMccRisk = getMerchantMccRisk(txn, merchant);
  if (merchantMccRisk.points > 0) {
    trigger(merchantMccRisk.rule, merchantMccRisk.points);
  }

  const merchantAverageAmount =
    Number(merchant.merchant_average_amount) ||
    Number(txn.merchant_average_amount) ||
    0;

  if (merchantAverageAmount > 0 && Number(txn.amount) > 3 * merchantAverageAmount) {
    trigger("Significant amount compared to merchant average", 30);
  }

  if ((context.velocity30SecCount || 0) >= 10) {
    trigger("High transaction velocity detected: 10 transactions within 30 seconds.", 35);
  }

  if ((context.smallTxn5MinCount || 0) >= 5) {
    trigger("Repeated small transactions detected: 5 transactions below SGD 10 within 5 minutes.", 25);
  }

  if ((context.largeTxn30MinCount || 0) >= 3) {
    trigger("Frequent large amount transactions detected within 30 minutes.", 35);
  }

  if ((context.cancelledTxn10MinCount || 0) >= 3) {
    trigger("Repeated cancelled or failed transactions detected within 10 minutes.", 25);
  }

  if (isOutsideMerchantOperatingHours(txn.timestamp, merchant)) {
    trigger("Transaction outside merchant operating hours", 15);
  }

  if (txn.customer_risk_profile === "high") {
    trigger("High-risk customer profile", 25);
  }

  if (context.missingRequiredInfo) {
    trigger("Missing or insufficient transaction information", 20);
  }

  if (hasInvalidIp(txn)) {
    trigger("Online transaction with missing/invalid IP", 20);
  }

  const risk_level = getRiskLevel(risk_score);
  const status = getTransactionStatus(risk_level);

  return {
    risk_score,
    risk_level,
    status,
    triggered_rules,
    alert_required: risk_level !== "Low",
    alert_status: risk_level !== "Low" ? "Pending" : null,
  };
}

module.exports = { evaluateTransaction };
