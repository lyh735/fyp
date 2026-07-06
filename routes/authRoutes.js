const express = require("express");
const router = express.Router();
const {
  login,
  createUser,
  changePassword,
  updateProfile,
  getProfile,
  getUsers,
  getUserById,
  resetUserPassword,
  deleteUser,
  upgradeUser
} = require("../controllers/authController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

router.post("/login",           login);
router.post("/change-password", authenticate, changePassword);
router.get ("/profile",         authenticate, getProfile);
router.put ("/profile",         authenticate, updateProfile);

router.post  ("/create-user",              authenticate, requireAdmin, createUser);
router.get   ("/users",                    authenticate, requireAdmin, getUsers);
router.get   ("/users/:id",                authenticate, requireAdmin, getUserById);
router.put   ("/users/:id/reset-password", authenticate, requireAdmin, resetUserPassword);
router.delete("/users/:id",                authenticate, requireAdmin, deleteUser);
router.put   ("/users/:id/upgrade",        authenticate, requireAdmin, upgradeUser);

module.exports = router;
