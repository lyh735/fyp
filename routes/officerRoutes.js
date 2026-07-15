const express = require("express");
const router = express.Router();

const officerController = require("../controllers/officerController");
const rfiController = require("../controllers/rfiController");
const { authenticate, requireAlertOfficer } = require("../middleware/authMiddleware");
const { handleResponseUpload } = require("../middleware/rfiUpload");

router.use(authenticate);

router.get("/audit-logs", officerController.showAuditLogsPage);
router.get("/report", officerController.showReportPage);

router.use(requireAlertOfficer);

router.get("/alerts", officerController.showAlertsPage);
router.get("/alerts/:id", officerController.showAlertDetails);
router.get("/alerts/:id/action", officerController.showAlertActionPage);
router.get("/alerts/:id/rfi", rfiController.showRfiPage);
router.post("/alerts/:id/rfi", rfiController.saveRfi);
router.get("/rfi/:id/pdf", rfiController.exportPdf);
router.post("/rfi/:id/mark-sent", rfiController.markAsSent);
router.post("/rfi/:id/response", handleResponseUpload, rfiController.recordResponse);
router.get("/rfi/:id/response-file", rfiController.downloadResponseFile);

router.post("/action", officerController.takeActionPage);

router.get("/str/generate/:alertId", officerController.generateSTRDraft);
router.get("/str/view/:strId", officerController.viewSTRDraft);

router.get("/action-success/:id", officerController.showActionSuccessPage);
module.exports = router;
