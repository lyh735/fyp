const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "compliance_jwt_secret_2024";
const ASSIGNABLE_ROLES = new Set(["analyst", "stro"]);
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

exports.login = (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err) return res.status(500).json({ message: "Server error" });
    if (results.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = results[0];
    const role = String(user.role || "").trim().toLowerCase();
    if (user.status !== "active") {
      return res.status(403).json({ message: "Account is not active" });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.user_id, email: user.email, role, name: user.name },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.cookie("cms_token", token, {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: 8 * 60 * 60 * 1000,
    });

    res.json({
      token,
      user: {
        id: user.user_id,
        name: user.name,
        email: user.email,
        role,
        first_login: !!user.first_login
      }
    });
  });
};

exports.logout = (req, res) => {
  res.clearCookie("cms_token", AUTH_COOKIE_OPTIONS);
  res.json({ message: "Logged out successfully" });
};

exports.createUser = async (req, res) => {
  const { name, email, password } = req.body;
  const role = String(req.body.role || "analyst").toLowerCase();
  if (!name || !email || !password || !ASSIGNABLE_ROLES.has(role)) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    db.query(
      "INSERT INTO users (name, email, password_hash, role, first_login) VALUES (?, ?, ?, ?, TRUE)",
      [name, email, hashed, role],
      (err) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "An account with this email already exists" });
          }
          return res.status(500).json({ message: "Server error" });
        }
        res.json({ message: "User account created successfully" });
      }
    );
  } catch {
    res.status(500).json({ message: "Server error" });
  }
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }
  if (!/[A-Z]/.test(newPassword)) {
    return res.status(400).json({ message: "Password must contain at least one uppercase letter" });
  }
  if (!/\d/.test(newPassword)) {
    return res.status(400).json({ message: "Password must contain at least one number" });
  }

  try {
    db.query(
      "SELECT user_id, password_hash, first_login FROM users WHERE user_id = ? LIMIT 1",
      [userId],
      async (err, results) => {
        if (err) return res.status(500).json({ message: "Server error" });
        if (!results.length) return res.status(404).json({ message: "User not found" });

        const user = results[0];
        const requiresCurrentPassword = !user.first_login;
        if (requiresCurrentPassword) {
          if (!currentPassword) {
            return res.status(400).json({ message: "Current password is required" });
          }

          const matchesCurrentPassword = await bcrypt.compare(currentPassword, user.password_hash);
          if (!matchesCurrentPassword) {
            return res.status(401).json({ message: "Current password is incorrect" });
          }
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        db.query(
          "UPDATE users SET password_hash = ?, first_login = FALSE, updated_at = NOW() WHERE user_id = ?",
          [hashed, userId],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ message: "Server error" });
            res.json({ message: "Password updated successfully" });
          }
        );
      }
    );
  } catch {
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateProfile = (req, res) => {
  const { name, email } = req.body;
  const userId = req.user.id;

  if (!name || !email) {
    return res.status(400).json({ message: "Name and email are required" });
  }

  db.query(
    "SELECT user_id FROM users WHERE email = ? AND user_id != ?",
    [email, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (rows.length > 0) {
        return res.status(409).json({ message: "Email is already used by another account" });
      }

      db.query(
        "UPDATE users SET name = ?, email = ?, updated_at = NOW() WHERE user_id = ?",
        [name, email, userId],
        (err2) => {
          if (err2) return res.status(500).json({ message: "Server error" });
          res.json({ message: "Profile updated successfully", name, email });
        }
      );
    }
  );
};

exports.getProfile = (req, res) => {
  db.query(
    "SELECT user_id AS id, name, email, role, status, first_login, created_at, updated_at FROM users WHERE user_id = ?",
    [req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (!results.length) return res.status(404).json({ message: "User not found" });
      res.json(results[0]);
    }
  );
};

exports.getUsers = (req, res) => {
  db.query(
    "SELECT user_id AS id, name, email, role, status, first_login, created_at, updated_at FROM users WHERE user_id != ? ORDER BY created_at DESC",
    [req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Server error" });
      res.json(results);
    }
  );
};

exports.getUserById = (req, res) => {
  db.query(
    "SELECT user_id AS id, name, email, role, status, first_login, created_at, updated_at FROM users WHERE user_id = ?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (!results.length) return res.status(404).json({ message: "User not found" });
      res.json(results[0]);
    }
  );
};

exports.resetUserPassword = async (req, res) => {
  const { newPassword } = req.body;
  const targetId = req.params.id;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    db.query(
      "UPDATE users SET password_hash = ?, first_login = TRUE, updated_at = NOW() WHERE user_id = ?",
      [hashed, targetId],
      (err, result) => {
        if (err) return res.status(500).json({ message: "Server error" });
        if (result.affectedRows === 0) return res.status(404).json({ message: "User not found" });
        res.json({ message: "Password reset successfully. User will be prompted to change it on next login." });
      }
    );
  } catch {
    res.status(500).json({ message: "Server error" });
  }
};

exports.deleteUser = (req, res) => {
  const targetId = req.params.id;

  if (parseInt(targetId) === req.user.id) {
    return res.status(400).json({ message: "You cannot delete your own account" });
  }

  db.query("DELETE FROM users WHERE user_id = ?", [targetId], (err, result) => {
    if (err) return res.status(500).json({ message: "Server error" });
    if (result.affectedRows === 0) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User account deleted successfully" });
  });
};

exports.upgradeUser = (req, res) => {
  const targetId = req.params.id;

  db.query(
    "UPDATE users SET role = 'admin', updated_at = NOW() WHERE user_id = ? AND role = 'analyst'",
    [targetId],
    (err, result) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Analyst not found or is already an admin" });
      }
      res.json({ message: "Analyst promoted to admin successfully" });
    }
  );
};
