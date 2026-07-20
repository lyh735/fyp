const express = require("express");
const router = express.Router();
const {
  login,
  logout,
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
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

const allowAdmin = authorizeRoles("admin");

router.post("/login",           login);
router.post("/logout",          logout);
router.post("/change-password", authenticate, changePassword);
router.get ("/profile",         authenticate, getProfile);
router.put ("/profile",         authenticate, allowAdmin, updateProfile);

router.post  ("/create-user",              authenticate, allowAdmin, createUser);
router.get   ("/users",                    authenticate, allowAdmin, getUsers);
router.get   ("/users/:id",                authenticate, allowAdmin, getUserById);
router.put   ("/users/:id/reset-password", authenticate, allowAdmin, resetUserPassword);
router.delete("/users/:id",                authenticate, allowAdmin, deleteUser);
router.put   ("/users/:id/upgrade",        authenticate, allowAdmin, upgradeUser);

module.exports = router;
