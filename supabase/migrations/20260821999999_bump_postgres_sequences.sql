-- Bump Postgres sequences so new document numbers continue where the old DB left off.
-- Generated automatically by scripts/import-data.mjs from the exported data.
SELECT setval('public.dc_customer_seq', 101, true);  -- delivery_challans.challan_no max=101
SELECT setval('public.dc_oem_seq', 10, true);  -- delivery_challans.challan_no max=10
SELECT setval('public.grn_customer_seq', 22, true);  -- grns.grn_no max=22
SELECT setval('public.grn_oem_seq', 28, true);  -- grns.grn_no max=28
SELECT setval('public.grn_general_seq', 1, true);  -- grns.grn_no max=1
SELECT setval('public.gdc_seq', 10, true);  -- general_delivery_challans.dc_no max=10
