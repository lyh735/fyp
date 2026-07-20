const express = require("express");
const router = express.Router();
const {
  getMerchants,
  getMerchantProfile,
  createMerchant,
  updateMerchantProfile,
  uploadMerchants,
  getMerchantTerminals,
  createTerminal,
  deleteTerminal,
} = require("../controllers/merchantController");
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

const allowAdmin = authorizeRoles("admin");
const allowMerchantRead = authorizeRoles("admin", "analyst", "stro");

router.get("/", authenticate, allowMerchantRead, getMerchants);
router.post("/", authenticate, allowAdmin, createMerchant);
router.post("/upload", authenticate, allowAdmin, uploadMerchants);
router.get("/:id", authenticate, allowMerchantRead, getMerchantProfile);
router.put("/:id", authenticate, allowAdmin, updateMerchantProfile);
router.get("/:id/terminals", authenticate, allowMerchantRead, getMerchantTerminals);
router.post("/:id/terminals", authenticate, allowAdmin, createTerminal);
router.delete("/:id/terminals/:terminalId", authenticate, allowAdmin, deleteTerminal);

module.exports = router;
