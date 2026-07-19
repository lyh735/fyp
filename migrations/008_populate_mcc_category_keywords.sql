-- Migration 008: populate category_keyword for MCC-specific risk profile rows.
-- These keywords are prototype operational labels for fallback matching and ERD clarity.
-- They are not regulatory category definitions.
-- Safe to rerun: only the listed MCC rows are updated, and no rows are deleted.

UPDATE merchant_category_risk
SET category_keyword = CASE mcc_code
  WHEN '4511' THEN 'airline'
  WHEN '4722' THEN 'tourism'
  WHEN '4789' THEN 'transport'
  WHEN '4812' THEN 'telecom_payment'
  WHEN '4829' THEN 'money_transfer'
  WHEN '5311' THEN 'department_store'
  WHEN '5411' THEN 'grocery'
  WHEN '5541' THEN 'service_station'
  WHEN '5611' THEN 'mens_apparel'
  WHEN '5621' THEN 'womens_apparel'
  WHEN '5631' THEN 'accessories'
  WHEN '5641' THEN 'children_clothing'
  WHEN '5651' THEN 'family_clothing'
  WHEN '5661' THEN 'shoes'
  WHEN '5691' THEN 'clothing'
  WHEN '5712' THEN 'furniture'
  WHEN '5732' THEN 'electronics'
  WHEN '5812' THEN 'restaurants'
  WHEN '5813' THEN 'bars'
  WHEN '5814' THEN 'fast_food'
  WHEN '5942' THEN 'bookstore'
  WHEN '5964' THEN 'direct_marketing'
  WHEN '5999' THEN 'misc_retail'
  WHEN '6012' THEN 'financial_institution'
  WHEN '6051' THEN 'money_services'
  WHEN '7011' THEN 'lodging'
  WHEN '7512' THEN 'vehicle_rental'
  WHEN '7995' THEN 'betting'
  ELSE category_keyword
END,
updated_at = NOW()
WHERE mcc_code IN (
  '4511', '4722', '4789', '4812', '4829', '5311', '5411',
  '5541', '5611', '5621', '5631', '5641', '5651', '5661',
  '5691', '5712', '5732', '5812', '5813', '5814', '5942',
  '5964', '5999', '6012', '6051', '7011', '7512', '7995'
);
