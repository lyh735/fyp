require("dotenv").config();
const jwt = require("jsonwebtoken");

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required.");
}

const JWT_SECRET = process.env.JWT_SECRET;
const VALID_ROLES = new Set(["admin", "analyst", "stro"]);

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];
  const cookieToken = String(req.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim().split("="))
    .find(([name]) => name === "cms_token")?.slice(1).join("=");
  const token = bearerToken || cookieToken;
  if (!token) return res.status(401).json({ message: "Authentication required" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
}

exports.authenticateToken = authenticateToken;
exports.authenticate = authenticateToken;

exports.authorizeRoles = (...roles) => {
  const allowedRoles = new Set(roles.map(normalizeRole));
  const invalidRoles = [...allowedRoles].filter((role) => !VALID_ROLES.has(role));

  if (invalidRoles.length) {
    throw new Error(`Invalid RBAC role(s): ${invalidRoles.join(", ")}`);
  }

  return (req, res, next) => {
    const role = normalizeRole(req.user?.role);
    if (!allowedRoles.has(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
};

exports.requireAdmin = exports.authorizeRoles("admin");
exports.requireAnalyst = exports.authorizeRoles("analyst");
exports.requireStro = exports.authorizeRoles("stro");
