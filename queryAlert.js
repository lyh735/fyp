const db = require('./config/db');
const alertId = 'ALT-UWP-MP3K2JAC-LC8ON-1778646277703';
db.query('SELECT alert_id, transaction_id, status, created_at FROM alerts WHERE alert_id = ?', [alertId], (err, results) => {
  if (err) { console.error('ERR', err); process.exit(1); }
  console.log(JSON.stringify(results, null, 2));
  db.end();
});
