function getRiskLevel(riskScore) {
  if (riskScore >= 70) return "High";
  if (riskScore >= 30) return "Medium";
  return "Low";
}

function getTransactionStatus(riskLevel) {
  if (riskLevel === "High") return "Pending Review";
  if (riskLevel === "Medium") return "Monitoring";
  return "Stored";
}

module.exports = { getRiskLevel, getTransactionStatus };
