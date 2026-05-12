const net = require("net");
const { getRiskLevel, getTransactionStatus } = require("./riskScoring");

const HIGH_RISK_COUNTRIES = new Set([
  "iran",
  "north korea",
  "myanmar",
  "syria",
  "russia",
]);

function isSingapore(country) {
  return String(country || "").trim().toLowerCase() === "singapore";
}

function isOutsideOperatingHours(timestamp) {
  const hour = new Date(timestamp).getHours();
  return hour >= 23 || hour < 6;
}

function hasInvalidIp(txn) {
  if (txn.transaction_type !== "online") return false;
  return !txn.ip_address || net.isIP(txn.ip_address) === 0;
}

function evaluateTransaction(txn, context = {}) {
  let risk_score = 0;
  const triggered_rules = [];

  function trigger(rule, points) {
    risk_score += points;
    triggered_rules.push(rule);
  }

  if (txn.amount > 3 * txn.merchant_average_amount) {
    trigger("Significant amount compared to merchant average", 30);
  }

  if ((context.recentMerchantTransactionCount || 0) >= 5) {
    trigger("Repeated transactions within short period", 25);
  }

  if (isOutsideOperatingHours(txn.timestamp)) {
    trigger("Transaction outside operating hours", 15);
  }

  if (txn.customer_risk_profile === "high") {
    trigger("High-risk customer profile", 25);
  }

  if (HIGH_RISK_COUNTRIES.has(String(txn.country || "").trim().toLowerCase())) {
    trigger("High-risk country/jurisdiction", 30);
  }

  if (context.countryWasDefaulted) {
    trigger("Missing or insufficient information", 20);
  }

  if (hasInvalidIp(txn)) {
    trigger("Online transaction with missing/invalid IP", 20);
  }

  if (!isSingapore(txn.country) && txn.currency === "SGD" && txn.amount > 1500) {
    trigger("Large cross-border transfer amount if country is not Singapore", 25);
  }

  const risk_level = getRiskLevel(risk_score);
  const status = getTransactionStatus(risk_level);

  return {
    risk_score,
    risk_level,
    status,
    triggered_rules,
    alert_required: risk_level === "High",
    alert_status: risk_level === "High" ? "Pending Review" : null,
  };
}

module.exports = { evaluateTransaction };
