const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "compliance_jwt_secret_2024";

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
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        first_login: !!user.first_login
      }
    });
  });
};

exports.createUser = async (req, res) => {
  const { name, dob, email, password } = req.body;
  if (!name || !dob || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    db.query(
      "INSERT INTO users (name, dob, email, password, role, first_login) VALUES (?, ?, ?, ?, 'user', TRUE)",
      [name, dob, email, hashed],
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
  const { newPassword } = req.body;
  const userId = req.user.id;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    db.query(
      "UPDATE users SET password = ?, first_login = FALSE WHERE id = ?",
      [hashed, userId],
      (err) => {
        if (err) return res.status(500).json({ message: "Server error" });
        res.json({ message: "Password updated successfully" });
      }
    );
  } catch {
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateProfile = (req, res) => {
  const { name, dob, email } = req.body;
  const userId = req.user.id;

  if (!name || !dob || !email) {
    return res.status(400).json({ message: "Name, date of birth and email are required" });
  }

  db.query(
    "SELECT id FROM users WHERE email = ? AND id != ?",
    [email, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (rows.length > 0) {
        return res.status(409).json({ message: "Email is already used by another account" });
      }

      db.query(
        "UPDATE users SET name = ?, dob = ?, email = ? WHERE id = ?",
        [name, dob, email, userId],
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
    "SELECT id, name, dob, email, role, first_login, created_at FROM users WHERE id = ?",
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
    "SELECT id, name, dob, email, role, first_login, created_at FROM users WHERE id != ? ORDER BY created_at DESC",
    [req.user.id],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Server error" });
      res.json(results);
    }
  );
};

exports.getUserById = (req, res) => {
  db.query(
    "SELECT id, name, dob, email, role, first_login, created_at FROM users WHERE id = ?",
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
      "UPDATE users SET password = ?, first_login = TRUE WHERE id = ?",
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

  db.query("DELETE FROM users WHERE id = ?", [targetId], (err, result) => {
    if (err) return res.status(500).json({ message: "Server error" });
    if (result.affectedRows === 0) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User account deleted successfully" });
  });
};

exports.upgradeUser = (req, res) => {
  const targetId = req.params.id;

  db.query(
    "UPDATE users SET role = 'admin' WHERE id = ? AND role = 'user'",
    [targetId],
    (err, result) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "User not found or is already an admin" });
      }
      res.json({ message: "User upgraded to admin successfully" });
    }
  );
};
