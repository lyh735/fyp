const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "dft-fyp.mysql.database.azure.com",
  user: "dft_fyp",
  password: "RepublicPoly2026",
  port: "3306",
  database: "soi-2026-0046-yuhan"
});

db.connect((err) => {
  if (err) {
    console.error("DB connection failed:", err);
  } else {
    console.log("Connected to MySQL");
  }
});

module.exports = db;
