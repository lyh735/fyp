# RT-CMS Final Test Data

These files are generated for final testing only. They do not modify the database unless you import or run them yourself.

## Import Headers Confirmed From Current Code

Merchant import accepts:
`merchant_id, merchant_name, business_category, mcc_code, merchant_average_amount, merchant_max_transaction_amount, merchant_risk_score, risk_level, operating_hours_start, operating_hours_end, country, has_physical_location, status`

Transaction import accepts:
`transaction_id, merchant_id, amount, currency, transaction_type, payment_method, txn_time, terminal_id, ip_address, country, transaction_status, customer_risk_profile, masked_payment_ref, payment_gateway_ref, card_bin, masked_card_number, card_presence, ip_country, ip_country_verified`

## Files And Purpose

| File | Test Spec | Type | Expected Result |
|---|---|---|---|
| `valid-merchants-import.xlsx` | RT-CMS-TS-08 / merchant setup | Positive | 8 merchants import successfully. |
| `invalid-merchants-import.xlsx` | RT-CMS-TS-08 validation | Negative | Rows show validation errors such as missing ID, invalid MCC, duplicate ID, invalid hours, negative amount, invalid status. |
| `valid-transactions-import.xlsx` | RT-CMS-TS-03 / RT-CMS-TS-08 | Positive | Successful/completed transactions import, appear in transactions page, and are scored. |
| `invalid-transactions-import.xlsx` | RT-CMS-TS-03 validation | Negative | Invalid rows fail preview or processing. Note: missing payment reference is currently accepted by the importer because references can be auto-generated. |
| `failed-declined-transactions-negative-test.xlsx` | Lecturer feedback validation | Negative | Failed/declined/cancelled rows should not create monitoring alerts or count toward behaviour rules. |
| `varied-rule-transactions-demo.xlsx` | Varied scoring demo | Positive/demo | Demonstrates different active scoring rules and priority queue ordering. |
| `varied-rule-transactions-demo-expected-results.csv` | Marking guide | Reference | Expected score and rules for focus rows. |
| `varied-rule-transactions-demo-expected-alert-queue.csv` | Queue guide | Reference | Expected priority ordering by priority score, then newer timestamp. |
| `rt-cms-test-terminals.sql` | Setup | Optional SQL | Creates `TERM-RTM-BAR-001` for face-to-face outside-hours rows. |

## Recommended Test Order

1. Import `valid-merchants-import.xlsx`.
2. Run `rt-cms-test-terminals.sql` in a test database if you want face-to-face outside-hours rows to pass.
3. Import `valid-transactions-import.xlsx`.
4. Import `invalid-merchants-import.xlsx` and capture the failed-row summary.
5. Import `invalid-transactions-import.xlsx` and capture the failed-row summary.
6. Import `failed-declined-transactions-negative-test.xlsx` and verify no alerts are created for failed/declined/cancelled rows.
7. Import `varied-rule-transactions-demo.xlsx` and compare focus rows against `varied-rule-transactions-demo-expected-results.csv`.

## Screenshots To Capture

- Merchant import preview and successful import result.
- Invalid merchant import failed-row summary.
- Transaction import preview and successful import result.
- Invalid transaction import failed-row summary.
- Transaction list showing imported successful/completed rows.
- Individual transaction detail risk breakdown.
- Alert detail page showing official score, MCC points and priority score.
- Investigation Priority Queue showing higher priority_score first.

## Manual Input Table For RT-CMS-TS-03

| Case | transaction_status | merchant_id | amount | transaction_type | Expected |
|---|---|---|---:|---|---|
| SUCCESS transaction | success | RTM-FNB-LOW-001 | 22.00 | online | Accepted and monitored. |
| COMPLETED transaction | completed | RTM-RETAIL-LOW-001 | 28.00 | online | Accepted and monitored. |
| FAILED transaction | failed | RTM-MONEY-HIGH-001 | 12000.00 | online | Accepted as status test, but should not create risk alert. |
| DECLINED transaction | declined | RTM-MONEY-HIGH-001 | 12000.00 | online | Should not create risk alert or count toward velocity. |
| Missing merchant ID | success | blank | 20.00 | online | Validation error. |
| Invalid amount | success | RTM-FNB-LOW-001 | -10.00 | online | Validation error. |

## Notes

- Only `success` and `completed` rows are intended to flow into active monitoring.
- Alert queue in the live app sorts by `priority_score DESC, created_at DESC`. Bulk import can make created_at values very close together. For a strict newest-first demo, submit two same-priority rows manually a few minutes apart.
- Expected scores reflect the current live rule values inspected from the project/database during preparation. If an admin changes rule points or thresholds later, update the expected-results file.
