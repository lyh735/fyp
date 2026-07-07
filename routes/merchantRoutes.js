const express = require("express");
const router = express.Router();
const {
  getMerchants,
  getMerchantProfile,
  updateMerchantProfile,
  getMerchantTerminals,
  createTerminal,
  deleteTerminal,
} = require("../controllers/merchantController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

router.get("/", authenticate, getMerchants);
router.get("/:id", authenticate, getMerchantProfile);
router.put("/:id", authenticate, requireAdmin, updateMerchantProfile);
router.get("/:id/terminals", authenticate, getMerchantTerminals);
router.post("/:id/terminals", authenticate, requireAdmin, createTerminal);
router.delete("/:id/terminals/:terminalId", authenticate, requireAdmin, deleteTerminal);

module.exports = router;
