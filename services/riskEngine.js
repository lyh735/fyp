exports.evaluateTransaction = (txn) => {
  let risk_score = 0;
  let reasons = [];

  if (txn.amount > 5000) {
    risk_score += 30;
    reasons.push("High amount");
  }

  if (txn.country !== "Singapore") {
    risk_score += 20;
    reasons.push("Foreign transaction");
  }

  let status = "normal";

  if (risk_score >= 50) {
    status = "suspicious";
  }

  return { risk_score, status, reasons };
};