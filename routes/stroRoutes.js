const express = require("express");
const router = express.Router();

const stroController = require("../controllers/stroControllers");

const {
  authenticate,
  authorizeRoles
} = require("../middleware/authMiddleware");

// 必须先登录
router.use(authenticate);

// 只有 STRO 和 Admin 可以进入
router.use(authorizeRoles("stro", "admin"));

router.get(
  "/dashboard",
  stroController.showDashboard
);

router.get(
  "/drafts/:strId",
  stroController.viewDraft
);

router.post(
  "/drafts/:strId/review",
  stroController.reviewDraft
);

module.exports = router;