const express = require("express");
const router  = express.Router();
const { createTransaction, simulate, getTransactions, getAlerts } = require("../controllers/transactionController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

router.post("/transactions",       authenticate, createTransaction);
router.get ("/transactions",       authenticate, getTransactions);
router.get ("/alerts",             authenticate, getAlerts);
router.post("/simulate",           authenticate, requireAdmin, simulate);

module.exports = router;
