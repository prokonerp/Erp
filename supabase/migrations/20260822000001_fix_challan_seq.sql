-- The gatepass trigger generates 'PHT/YYYY/NNNN' but historical challan_no
-- values use the 'PHS/YYYY/NNNN' prefix — bump the sequence from the data.
SELECT setval('public.challan_seq', 61, true);