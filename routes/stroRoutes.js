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
const allowStroOrAdmin = authorizeRoles("stro", "admin");

router.use(authenticate);

// Analysts can see STRO outcomes, but cannot access STRO case controls.
router.get("/outcomes", allowAnalyst, stroController.getStroOutcomes);

// STRO case review and STR drafting API.
router.get("/alerts", allowStro, stroController.getEscalatedAlerts);
router.get("/alerts/:id", allowStro, stroController.getEscalatedAlert);
router.get("/alerts/:id/str-draft", allowStro, stroController.getStrDraft);
router.post("/alerts/:id/str-draft/generate", allowStro, stroController.generateStrDraftForAlert);
router.put("/str-drafts/:id", allowStro, stroController.saveStrDraft);
router.get("/rfi/:id/pdf", allowStro, rfiController.exportPdf);
router.get("/rfi/:id/response-file", allowStro, rfiController.downloadResponseFile);

// Server-rendered STRO review workflow retained for existing links.
router.get("/dashboard", allowStroOrAdmin, stroReviewController.showDashboard);
router.get("/drafts/:strId", allowStroOrAdmin, stroReviewController.viewDraft);
router.post("/drafts/:strId/review", allowStroOrAdmin, stroReviewController.reviewDraft);

module.exports = router;
