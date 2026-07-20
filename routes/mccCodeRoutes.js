const express = require("express");
const router = express.Router();
const { getMccCodes, createMccCode, deleteMccCode } = require("../controllers/mccCodeController");
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

const allowAdmin = authorizeRoles("admin");
const allowMccRead = authorizeRoles("admin", "analyst", "stro");

router.get("/", authenticate, allowMccRead, getMccCodes);
router.post("/", authenticate, allowAdmin, createMccCode);
router.delete("/:code", authenticate, allowAdmin, deleteMccCode);

module.exports = router;
