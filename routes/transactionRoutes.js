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
  markAlertRead,
  dismissAlert,
  escalateAlert,
} = require("../controllers/transactionController");
const { authenticate, requireAdmin, requireAlertOfficer, requireSystemAdmin } = require("../middleware/authMiddleware");

router.post("/transactions",       authenticate, requireSystemAdmin, createTransaction);
router.post("/transactions/upload", authenticate, requireSystemAdmin, uploadTransactions);
router.get ("/transactions",       authenticate, getTransactions);
router.get ("/alerts",             authenticate, getAlerts);
router.get ("/alerts/:id",         authenticate, getAlert);
router.get ("/rules",              authenticate, getComplianceRules);
router.post("/rules",              authenticate, requireAdmin, createComplianceRule);
router.put ("/rules/:id",          authenticate, requireAdmin, updateComplianceRule);
router.delete("/rules/:id",        authenticate, requireAdmin, deleteComplianceRule);
router.post("/alerts/:id/read",    authenticate, markAlertRead);
router.post("/alerts/:id/dismiss", authenticate, requireAlertOfficer, dismissAlert);
router.post("/alerts/:id/escalate",authenticate, requireAlertOfficer, escalateAlert);
router.post("/simulate",           authenticate, requireAdmin, simulate);

module.exports = router;
