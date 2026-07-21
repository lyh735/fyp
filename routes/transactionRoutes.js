const express = require("express");
const router  = express.Router();
const {
  createTransaction,
  uploadTransactions,
  simulate,
  getTransactions,
  getAlerts,
  getAlert,
  getComplianceRules,
  createComplianceRule,
  updateComplianceRule,
  deleteComplianceRule,
  getMccRiskProfiles,
  updateMccRiskProfile,
  markAlertRead,
  dismissAlert,
  escalateAlert,
} = require("../controllers/transactionController");
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

const allowAllRoles = authorizeRoles("admin", "analyst", "stro");
const allowAdmin = authorizeRoles("admin");
const allowAnalyst = authorizeRoles("analyst");

router.post("/transactions",        authenticate, allowAdmin, createTransaction);
router.post("/transactions/upload", authenticate, allowAdmin, uploadTransactions);
router.get ("/transactions",        authenticate, allowAllRoles, getTransactions);
router.get ("/alerts",              authenticate, allowAllRoles, getAlerts);
router.get ("/alerts/:id",          authenticate, allowAllRoles, getAlert);
router.get ("/rules",               authenticate, allowAllRoles, getComplianceRules);
router.post("/rules",               authenticate, allowAdmin, createComplianceRule);
router.put ("/rules/:id",           authenticate, allowAdmin, updateComplianceRule);
router.delete("/rules/:id",         authenticate, allowAdmin, deleteComplianceRule);
router.get ("/mcc-risk",            authenticate, allowAllRoles, getMccRiskProfiles);
router.put ("/mcc-risk/:id",        authenticate, allowAdmin, updateMccRiskProfile);
router.post("/alerts/:id/read",     authenticate, allowAllRoles, markAlertRead);
router.post("/alerts/:id/dismiss",  authenticate, allowAnalyst, dismissAlert);
router.post("/alerts/:id/escalate", authenticate, allowAnalyst, escalateAlert);
router.post("/simulate",            authenticate, allowAdmin, simulate);

module.exports = router;
