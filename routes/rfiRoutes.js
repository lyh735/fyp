const express = require("express");
const router = express.Router();
const rfiController = require("../controllers/rfiController");
const { authenticate, requireAnalyst } = require("../middleware/authMiddleware");

router.get("/history", authenticate, requireAnalyst, rfiController.getAnalystRfiHistory);

module.exports = router;
