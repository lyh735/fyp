const db = require('./config/db');
const alertId = Number(process.argv[2] || 1);
if (!Number.isInteger(alertId) || alertId <= 0) {
  throw new Error('Usage: node queryAlert.js <numeric-alert-id>');
}
db.query('SELECT alert_id, transaction_id, status, created_at FROM alerts WHERE alert_id = ?', [alertId], (err, results) => {
  if (err) { console.error('ERR', err); process.exit(1); }
  console.log(JSON.stringify(results, null, 2));
  db.end();
});
