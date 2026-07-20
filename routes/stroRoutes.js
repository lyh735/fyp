const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const stroController = require("../controllers/stroController");
const rfiController = require("../controllers/rfiController");

const allowAnalyst = authorizeRoles("analyst");
const allowStro = authorizeRoles("stro");

router.use(authenticate);
router.get("/outcomes", allowAnalyst, stroController.getStroOutcomes);
router.get("/alerts", allowStro, stroController.getEscalatedAlerts);
router.get("/alerts/:id", allowStro, stroController.getEscalatedAlert);
router.get("/alerts/:id/str-draft", allowStro, stroController.getStrDraft);
router.post("/alerts/:id/str-draft/generate", allowAnalyst, stroController.generateStrDraftForAlert);
router.put("/str-drafts/:id", allowStro, stroController.saveStrDraft);
router.get("/rfi/:id/pdf", allowStro, rfiController.exportPdf);
router.get("/rfi/:id/response-file", allowStro, rfiController.downloadResponseFile);

module.exports = router;
