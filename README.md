# Real-Time Compliance Monitoring System — Corrected Rule Engine

This version changes the project from a mostly hardcoded scoring engine into a **database-controlled rule engine**.

The JavaScript code still defines how a rule is evaluated, while the database controls:

- whether the rule is active;
- the rule threshold;
- the required transaction count;
- the time window in seconds; and
- the risk points awarded.

## Main corrections included

1. `riskEngine.js` now reads active rule settings supplied from `compliance_rules`.
2. Rule changes on `rules.html` affect newly processed transactions.
3. Velocity rules use a payment identifier instead of counting every customer at the same merchant.
4. Transactions no longer overwrite an existing merchant profile.
5. Time windows are stored in seconds, so a 30-second or 60-second rule is represented correctly.
6. Triggered rules are stored with rule ID, type, points, message, and evidence.
7. Rule deletion is replaced with deactivation.
8. Merchant MCC/category risk values are stored in `merchant_category_risk`.
9. New rules are included for failed attempts followed by success and possible duplicate/replayed payments.
10. Optional high-risk-jurisdiction and IP-country-mismatch rules are included but inactive until configured.
11. Database credentials and the JWT secret are loaded from `.env`.
12. The MySQL connection now uses a connection pool.

## Step 1 — Configure the environment

Copy `.env.example` to `.env`:

```bash
copy .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

Fill in:

```env
DB_HOST=...
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=...
JWT_SECRET=use-a-long-random-secret
PORT=3006
```

Change the old database password because it was previously stored directly in the source code.

## Step 2 — Install dependencies

```bash
npm install
```

## Step 3 — Start the application

```bash
npm start
```

When the application starts, `services/schema.js` automatically:

- creates missing reference tables;
- adds `time_window_seconds`;
- adds `ip_country` and `customer_risk_profile` to transactions;
- inserts missing default rules; and
- inserts merchant MCC/category reference data.

The application does not overwrite an existing rule's points or thresholds. Existing rules retain their current settings and can be edited from the Rules page.

## Step 4 — Confirm the rule engine is connected

Use the amount rule as the first test.

1. Open **Compliance Rules**.
2. Edit `amount_multiplier`.
3. Set:
   - Threshold value: `3`
   - Points: `30`
   - Status: Active
4. Use a merchant whose average transaction amount is `100`.
5. Submit a new transaction for `400`.
6. Confirm that the amount rule contributes 30 points.
7. Change the rule points to `10`.
8. Submit another new transaction for `400`.
9. Confirm that it now contributes 10 points.
10. Deactivate the rule and submit another transaction.
11. Confirm that the amount rule no longer triggers.

Only new transactions use the new configuration. Historical transactions keep the rule evidence used when they were processed.

## Step 5 — Test velocity rules

Velocity rules need the same usable payment identifier, such as:

- `masked_card_number`;
- `masked_payment_ref`; or
- `payment_gateway_ref`.

They no longer count unrelated customers merely because they paid the same merchant.

Example velocity test:

1. Set `velocity` to count `6` transactions within `60` seconds.
2. Submit six transactions using the same masked card number.
3. Use a different `transaction_id` for every transaction.
4. Confirm that the sixth transaction triggers the velocity rule.

## Current default rules

| Rule type | Default configuration |
|---|---|
| `merchant_profile` | Points come from `merchant_category_risk` |
| `amount_multiplier` | Above 3× merchant average, 25 points |
| `velocity` | 6 transactions in 60 seconds, 25 points |
| `velocity_small_amount` | 5 transactions below SGD 10 in 300 seconds, 20 points |
| `large_amount_frequency` | 3 transactions above 3× merchant average in 1800 seconds, 30 points |
| `cancellation_velocity` | 3 failed/cancelled attempts in 600 seconds, 15 points |
| `failure_then_success` | 3 failures followed by success in 600 seconds, 30 points |
| `duplicate_transaction` | Same merchant, amount, currency and payment identifier in 60 seconds, 25 points |
| `time` | Face-to-face payment outside operating hours, 10 points |
| `customer_risk` | High customer risk profile, 15 points |
| `data_quality` | Missing useful identifying references, 10 points |
| `ip_validation` | Missing/invalid IP for online payment, 10 points |
| `high_risk_jurisdiction` | 25 points; inactive until a list is configured |
| `ip_country_mismatch` | 20 points; inactive until IP-country data is supplied |

## Configure high-risk jurisdictions

Do not hardcode a changing official list in JavaScript. Add only the jurisdictions approved for your project or demonstration:

```sql
INSERT INTO high_risk_jurisdictions
  (country_code, country_name, risk_level, reason, is_active)
VALUES
  ('TST', 'Demo Jurisdiction', 'high', 'Demonstration record only', 1);
```

Then activate `high_risk_jurisdiction` from the Rules page.

For `ip_country_mismatch`, submit an `ip_country` value alongside `country`. The rule only applies to online transactions when both are available.

## Important merchant behaviour

For an existing merchant, a transaction no longer changes its:

- MCC;
- business category;
- average amount;
- country;
- risk level;
- risk score; or
- operating hours.

The Compliance Manager should maintain these values through the merchant profile page.

An unknown merchant can still be created from the first incoming transaction to preserve the existing simulator/import workflow, but later transactions do not overwrite it.

## Run the automated test

```bash
npm test
```

The test verifies that:

- changing amount-rule points changes the score;
- absent/inactive rules do not trigger;
- velocity settings are respected; and
- IP-country mismatch scoring works.

## Risk levels

The project still uses:

- 0–29: Low
- 30–59: Medium
- 60–89: High
- 90+: Critical

These bands remain in `services/riskScoring.js` for now.

## Files most relevant to the revised workflow

- `services/complianceRuleService.js`
- `services/riskEngine.js`
- `controllers/transactionController.js`
- `services/schema.js`
- `services/validation.js`
- `public/rules.html`
- `database.sql`
- `tests/riskEngine.test.js`
