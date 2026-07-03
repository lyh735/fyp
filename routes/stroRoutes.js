const express = require("express");
const router = express.Router();
const { authenticate, requireStro } = require("../middleware/authMiddleware");
const stroController = require("../controllers/stroController");
const rfiController = require("../controllers/rfiController");

router.use(authenticate, requireStro);
router.get("/alerts", stroController.getEscalatedAlerts);
router.get("/alerts/:id", stroController.getEscalatedAlert);
router.get("/rfi/:id/pdf", rfiController.exportPdf);
router.get("/rfi/:id/response-file", rfiController.downloadResponseFile);

module.exports = router;
