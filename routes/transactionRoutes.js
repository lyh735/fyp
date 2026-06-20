const express = require("express");
const router  = express.Router();
const {
  createTransaction,
  simulate,
  getTransactions,
  getAlerts,
  getAlert,
  getComplianceRules,
  markAlertRead,
  dismissAlert,
  escalateAlert,
} = require("../controllers/transactionController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

router.post("/transactions",       authenticate, createTransaction);
router.get ("/transactions",       authenticate, getTransactions);
router.get ("/alerts",             authenticate, getAlerts);
router.get ("/alerts/:id",         authenticate, getAlert);
router.get ("/rules",              authenticate, getComplianceRules);
router.post("/alerts/:id/read",    authenticate, markAlertRead);
router.post("/alerts/:id/dismiss", authenticate, dismissAlert);
router.post("/alerts/:id/escalate",authenticate, escalateAlert);
router.post("/simulate",           authenticate, requireAdmin, simulate);

module.exports = router;
