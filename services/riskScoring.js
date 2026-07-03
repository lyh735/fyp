function getRiskLevel(riskScore) {
  if (riskScore >= 90) return "Critical";
  if (riskScore >= 60) return "High";
  if (riskScore >= 30) return "Medium";
  return "Low";
}

function getTransactionStatus(riskLevel) {
  if (riskLevel === "Critical") return "Critical Review";
  if (riskLevel === "High") return "Pending Review";
  if (riskLevel === "Medium") return "Monitoring";
  return "Stored";
}

module.exports = { getRiskLevel, getTransactionStatus };