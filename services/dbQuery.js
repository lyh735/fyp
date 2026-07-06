const db = require("../config/db");

function query(sql, values = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, values, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

module.exports = { query };
