const express = require("express");
const router = express.Router();

const officerController = require("../controllers/officerController");
const rfiController = require("../controllers/rfiController");

router.get("/alerts", officerController.showAlertsPage);
router.get("/alerts/:id", officerController.showAlertDetails);
router.get("/alerts/:id/action", officerController.showAlertActionPage);
router.get("/alerts/:id/rfi", rfiController.showRfiPage);
router.post("/alerts/:id/rfi", rfiController.saveRfi);
router.get("/rfi/:id/pdf", rfiController.exportPdf);
router.post("/rfi/:id/mark-sent", rfiController.markAsSent);
router.post("/rfi/:id/reminder", rfiController.sendReminder);

router.post("/action", officerController.takeActionPage);

router.get("/audit-logs", officerController.showAuditLogsPage);
router.get("/report", officerController.showReportPage);

router.get("/action-success/:id", officerController.showActionSuccessPage);
module.exports = router;
