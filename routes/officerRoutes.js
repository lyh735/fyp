const express = require("express");
const router = express.Router();

const officerController = require("../controllers/officerController");

router.get("/alerts", officerController.showAlertsPage);
router.post("/action", officerController.takeActionPage);
router.get("/audit-logs", officerController.showAuditLogsPage);
router.get("/report", officerController.showReportPage);

module.exports = router;