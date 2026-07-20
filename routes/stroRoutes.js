const express = require("express");
const router = express.Router();

const stroController = require("../controllers/stroControllers");

//middleware

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