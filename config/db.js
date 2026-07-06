require("dotenv").config();

const mysql = require("mysql2");

const requiredEnvironmentVariables = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
];

const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (name) => !process.env[name]
);

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `Missing database environment variables: ${missingEnvironmentVariables.join(", ")}`
  );
}

const sslEnabled = String(process.env.DB_SSL || "false").toLowerCase() === "true";

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ...(sslEnabled
    ? {
        ssl: {
          rejectUnauthorized:
            String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !==
            "false",
        },
      }
    : {}),
});

db.getConnection((error, connection) => {
  if (error) {
    console.error("Unable to connect to MySQL:", error.message);
    return;
  }

  console.log("Connected to MySQL connection pool");
  connection.release();
});

module.exports = db;
