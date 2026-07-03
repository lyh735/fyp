const express = require("express");
const router = express.Router();
const { getMerchants, getMerchantProfile, updateMerchantProfile } = require("../controllers/merchantController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

router.get("/", authenticate, getMerchants);
router.get("/:id", authenticate, getMerchantProfile);
router.put("/:id", authenticate, requireAdmin, updateMerchantProfile);

module.exports = router;
