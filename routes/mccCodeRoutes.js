const express = require("express");
const router = express.Router();
const { getMccCodes, createMccCode, deleteMccCode } = require("../controllers/mccCodeController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

router.get("/", authenticate, getMccCodes);
router.post("/", authenticate, requireAdmin, createMccCode);
router.delete("/:code", authenticate, requireAdmin, deleteMccCode);

module.exports = router;
