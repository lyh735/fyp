exports.evaluateTransaction = (txn) => {
  let risk_score = 0;
  const reasons = [];

  // ── Amount thresholds ─────────────────────────────────────
  if (txn.amount > 5000) {
    risk_score += 45;
    reasons.push("Extremely high amount (>$5,000 SGD)");
  } else if (txn.amount > 2000) {
    risk_score += 25;
    reasons.push("High amount (>$2,000 SGD)");
  } else if (txn.amount > 1000) {
    risk_score += 15;
    reasons.push("Elevated amount (>$1,000 SGD)");
  }

  // ── Foreign origin ────────────────────────────────────────
  if (txn.country && txn.country !== "Singapore") {
    risk_score += 20;
    reasons.push(`Foreign origin: ${txn.country}`);
  }

  // ── Late-night window (11 PM – 5 AM) ─────────────────────
  const hour = new Date(txn.txn_time || Date.now()).getHours();
  if (hour >= 23 || hour < 5) {
    risk_score += 15;
    reasons.push("Late-night transaction (11 PM – 5 AM)");
  }

  // ── High-value UnionQR Pay (tourist-heavy method) ─────────
  if (txn.payment_method === "UnionQR Pay" && txn.amount > 3000) {
    risk_score += 15;
    reasons.push("High-value UnionQR Pay transaction");
  }

  // ── Status classification ─────────────────────────────────
  let status = "normal";
  if (risk_score >= 50)      status = "suspicious";
  else if (risk_score >= 25) status = "review";

  return { risk_score, status, reasons };
};
