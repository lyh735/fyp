const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "compliance_jwt_secret_2024";

exports.authenticate = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Authentication required" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
};

exports.requireAdmin = (req, res, next) => {
  if (!["admin", "compliance_manager"].includes(req.user.role)) {
    return res.status(403).json({ message: "Compliance manager access required" });
  }
  next();
};

exports.requireStro = (req, res, next) => {
  if (String(req.user.role || "").trim().toLowerCase() !== "stro") {
    return res.status(403).json({ message: "STRO access required" });
  }
  next();
};

exports.requireAnalyst = (req, res, next) => {
  if (String(req.user.role || "").trim().toLowerCase() !== "analyst") {
    return res.status(403).json({ message: "Analyst access required" });
  }
  next();
};

exports.requireAlertOfficer = (req, res, next) => {
  const role = String(req.user.role || "").trim().toLowerCase();
  if (!["admin", "compliance_manager", "analyst"].includes(role)) {
    return res.status(403).json({ message: "Compliance officer access required" });
  }
  next();
};
