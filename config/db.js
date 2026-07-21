require("dotenv").config();
const mysql = require("mysql2");

function normalizeDatabaseName(name) {
  if (!name) return name;
  return name.trim().replace(/^['"`]+|['"`]+$/g, "");
}

if (
  !process.env.DB_HOST ||
  !process.env.DB_USER ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_NAME
) {
  throw new Error(
    "Missing required database environment variables. Check your .env file."
  );
}

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 3306),
  database: normalizeDatabaseName(process.env.DB_NAME),
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
