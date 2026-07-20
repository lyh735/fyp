require("dotenv").config();
const mysql = require("mysql2");

function normalizeDatabaseName(name) {
  if (!name) return name;
  return name.trim().replace(/^['"`]+|['"`]+$/g, "");
}

const db = mysql.createPool({
  host: process.env.DB_HOST || "dft-fyp.mysql.database.azure.com",
  user: process.env.DB_USER || "dft_fyp",
  password: process.env.DB_PASSWORD || "RepublicPoly2026",
  port: Number(process.env.DB_PORT || 3306),
  database: normalizeDatabaseName(process.env.DB_NAME) || "soi-2026-0046-yuhan1",
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
    : undefined,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
});

async function verifyConnection() {
  try {
    const connection = await db.promise().getConnection();
    connection.release();
    console.log("Connected to MySQL");
  } catch (err) {
    console.error("DB connection failed:", err);
  }
}

verifyConnection();

module.exports = db;
