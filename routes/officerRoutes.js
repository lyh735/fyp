const express = require("express");
const router = express.Router();

const officerController = require("../controllers/officerController");
const rfiController = require("../controllers/rfiController");

const {
  authenticate,
  requireAlertOfficer
} = require("../middleware/authMiddleware");

const {
  handleResponseUpload
} = require("../middleware/rfiUpload");

/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
| All routes in this file require the user to be logged in.
*/
router.use(authenticate);

/*
|--------------------------------------------------------------------------
| General Officer Routes
|--------------------------------------------------------------------------
| These routes only require authentication.
*/
router.get(
  "/audit-logs",
  officerController.showAuditLogsPage
);

router.get(
  "/report",
  officerController.showReportPage
);

/*
|--------------------------------------------------------------------------
| Alert Officer Authorisation
|--------------------------------------------------------------------------
| Routes below require Alert Officer permission.
*/
router.use(requireAlertOfficer);

/*
|--------------------------------------------------------------------------
| Alert Routes
|--------------------------------------------------------------------------
*/
router.get(
  "/alerts",
  officerController.showAlertsPage
);

router.get(
  "/alerts/:id",
  officerController.showAlertDetails
);

router.get(
  "/alerts/:id/action",
  officerController.showAlertActionPage
);

router.post(
  "/action",
  officerController.takeActionPage
);

router.get(
  "/action-success/:id",
  officerController.showActionSuccessPage
);

/*
|--------------------------------------------------------------------------
| RFI Routes
|--------------------------------------------------------------------------
*/
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

/*
|--------------------------------------------------------------------------
| STR Routes
|--------------------------------------------------------------------------
| Generate a new STR draft from an alert.
*/
router.get(
  "/str/generate/:alertId",
  officerController.generateSTRDraft
);

/*
| View an existing STR draft.
*/
router.get(
  "/str/view/:strId",
  officerController.viewSTRDraft
);

/*
| Submit an STR draft to the STRO reviewer.
*/
router.post(
  "/str/:strId/submit-stro",
  officerController.submitSTRToSTRO
);

module.exports = router;
