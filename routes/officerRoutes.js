const express = require("express");
const router = express.Router();

const officerController = require(
  "../controllers/officerController"
);

const rfiController = require(
  "../controllers/rfiController"
);

const {
  authenticate,
  authorizeRoles
} = require("../middleware/authMiddleware");

const {
  handleResponseUpload
} = require("../middleware/rfiUpload");

const allowAllRoles = authorizeRoles(
  "admin",
  "analyst",
  "stro"
);

router.use(authenticate);

router.get(
  "/audit-logs",
  officerController.showAuditLogsPage
);

router.get(
  "/report",
  officerController.showReportPage
);

router.get(
  "/alerts/:id",
  allowAllRoles,
  officerController.showAlertDetails
);

router.use(authorizeRoles("analyst"));

router.get(
  "/alerts",
  officerController.showAlertsPage
);

router.get(
  "/alerts/:id/action",
  officerController.showAlertActionPage
);

router.get(
  "/alerts/:id/rfi",
  rfiController.showRfiPage
);

router.post(
  "/alerts/:id/rfi",
  rfiController.saveRfi
);

router.get(
  "/rfi/:id/pdf",
  rfiController.exportPdf
);

router.post(
  "/rfi/:id/mark-sent",
  rfiController.markAsSent
);

router.post(
  "/rfi/:id/response",
  handleResponseUpload,
  rfiController.recordResponse
);

router.get(
  "/rfi/:id/response-file",
  rfiController.downloadResponseFile
);

router.post(
  "/action",
  officerController.takeActionPage
);

router.post(
  "/str-draft",
  officerController.handleStrDraftSubmission
);

router.post(
  "/str-draft/:alertId",
  officerController.handleStrDraftSubmission
);

router.get(
  "/str/generate/:alertId",
  officerController.generateSTRDraft
);

router.get(
  "/str/view/:strId",
  officerController.viewSTRDraft
);

router.get(
  "/action-success/:id",
  officerController.showActionSuccessPage
);

module.exports = router;