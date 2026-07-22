const express = require("express");
const router = express.Router();

const stroController = require("../controllers/stroController");
const stroReviewController = require("../controllers/stroControllers");
const rfiController = require("../controllers/rfiController");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const allowAnalyst = authorizeRoles("analyst");
const allowStro = authorizeRoles("stro");
const allowAnalystOrStro = authorizeRoles("analyst", "stro");

router.use(authenticate);

// Role-aware actionable notification count.
router.get("/notifications", allowAnalystOrStro, stroController.getNotificationSummary);

// Analysts can see STRO outcomes, but cannot access STRO case controls.
router.get("/outcomes", allowAnalyst, stroController.getStroOutcomes);

// STRO case review API.
router.get("/alerts", allowStro, stroController.getEscalatedAlerts);
router.get("/alerts/:id", allowStro, stroController.getEscalatedAlert);
router.get("/rfi/:id/pdf", allowStro, rfiController.exportPdf);
router.get("/rfi/:id/response-file", allowStro, rfiController.downloadResponseFile);

// Server-rendered STRO review workflow retained for existing links.
router.get("/dashboard", allowStro, stroReviewController.showDashboard);
router.get("/drafts/:strId", allowStro, stroReviewController.viewDraft);
router.post("/drafts/:strId/review", allowStro, stroReviewController.reviewDraft);

module.exports = router;
