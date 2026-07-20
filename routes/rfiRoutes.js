const express = require("express");
const router = express.Router();
const rfiController = require("../controllers/rfiController");
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

router.get("/history", authenticate, authorizeRoles("analyst", "stro"), rfiController.getAnalystRfiHistory);

module.exports = router;
