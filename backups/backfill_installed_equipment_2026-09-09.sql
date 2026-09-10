-- Backfill installed_equipment from tickets (open + closed + valid)
-- Generated: 2026-09-09T13:05:52.128Z
-- Source: https://cqjmcfwsrljxhixzfgpk.supabase.co
-- Filters: is_deleted=false AND status IN ('Closed','New','In Progress','Under Observation','Parts Received')
--         AND customer_id IS NOT NULL AND product<>'' AND valid serial (not NA/null/-/none, len>=3)
-- Dedup: (customer_id, upper(serial_no)) keep earliest ticket; skip if already exists
-- Stats: tickets=413, installed_existing=230, candidates=290, distinct=276, already_exists=17, to_insert=259
-- Safety: Idempotent - each INSERT has WHERE NOT EXISTS guard. Re-running inserts 0 rows.
--         Run as single transaction. No DELETE/UPDATE on existing rows.
-- How to run: Supabase Dashboard -> SQL Editor -> paste & Run (or psql < file)

BEGIN;

-- Optional: ensure RLS allows service_role inserts (already granted). Verify:
-- SELECT * FROM pg_policies WHERE tablename='installed_equipment';


-- 259 new equipment rows (deduped, skipping 17 already present)
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '0cfd181f-7f69-4116-a659-f6e65b90ae2a'::uuid, '7cc692ef-dc56-4801-92a7-90931dbbcdc0'::uuid, 'SURT10000XLI', 'YQ0504120048', 0, 'Backfilled from ticket PHS2506261535016 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='0cfd181f-7f69-4116-a659-f6e65b90ae2a'::uuid AND upper(trim(serial_no)) = 'YQ0504120048');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '900c0174-8500-4493-8c83-f1d2ef3833c4'::uuid, 'a3736c1f-4c4f-46f8-83c6-9fcc1fd83976'::uuid, 'SRV20KUXI-IN', '9S2402A02561', 0, 'Backfilled from ticket PHS2506261546017 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='900c0174-8500-4493-8c83-f1d2ef3833c4'::uuid AND upper(trim(serial_no)) = '9S2402A02561');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '39b1d4d4-02ea-4d73-a4ec-35c13015d43c'::uuid, '53773aae-30c3-45ba-804e-0c0b06b44bc6'::uuid, 'RBC44', '0H2604G09704', 0, 'Backfilled from ticket PHS2506261820018 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='39b1d4d4-02ea-4d73-a4ec-35c13015d43c'::uuid AND upper(trim(serial_no)) = '0H2604G09704');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a332ac88-d29c-426c-8b00-8be54c86716e'::uuid, '0888d497-631c-4e03-9336-531bccb6aa04'::uuid, 'SRVPM10KRIL-IN', '9S2346A00094', 0, 'Backfilled from ticket PHS2906261549019 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a332ac88-d29c-426c-8b00-8be54c86716e'::uuid AND upper(trim(serial_no)) = '9S2346A00094');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '26106c4f-471c-4582-b04e-12b9c5c2910f'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2421A00589', 0, 'Backfilled from ticket PHS2906261611020 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='26106c4f-471c-4582-b04e-12b9c5c2910f'::uuid AND upper(trim(serial_no)) = '9S2421A00589');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '3ec698d3-80e8-478f-9fa9-72f28e3219b0'::uuid, 'a3736c1f-4c4f-46f8-83c6-9fcc1fd83976'::uuid, 'SRV20KUXI-IN', '9S2513A01130', 0, 'Backfilled from ticket PHS3006261042023 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='3ec698d3-80e8-478f-9fa9-72f28e3219b0'::uuid AND upper(trim(serial_no)) = '9S2513A01130');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ce12e5c2-10ca-4cb8-9313-7fa4da85e468'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2421A00589', 0, 'Backfilled from ticket PHS3006261050024 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ce12e5c2-10ca-4cb8-9313-7fa4da85e468'::uuid AND upper(trim(serial_no)) = '9S2421A00589');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '488b9276-da50-4d90-9f90-4a67bca760d6'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242504539762', 0, 'Backfilled from ticket PHS3006261110026 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='488b9276-da50-4d90-9f90-4a67bca760d6'::uuid AND upper(trim(serial_no)) = '242504539762');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '46540287-3580-4432-aa20-06d3910aedca'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2012A21804', 0, 'Backfilled from ticket PHS3006261134027 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='46540287-3580-4432-aa20-06d3910aedca'::uuid AND upper(trim(serial_no)) = '9S2012A21804');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '46540287-3580-4432-aa20-06d3910aedca'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2023A65038', 0, 'Backfilled from ticket PHS3006261136028 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='46540287-3580-4432-aa20-06d3910aedca'::uuid AND upper(trim(serial_no)) = '9S2023A65038');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '3ada9531-4a52-481b-9350-f0c86b43b7bf'::uuid, '4457e907-5780-4a81-be5d-700523d27119'::uuid, 'BVX2200LI-IN', '9B2518A02087', 0, 'Backfilled from ticket PHS3006261143029 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='3ada9531-4a52-481b-9350-f0c86b43b7bf'::uuid AND upper(trim(serial_no)) = '9B2518A02087');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd27497b2-8e25-4d85-9ce3-0bbab05b6f5c'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', 'ZS2521000379', 0, 'Backfilled from ticket PHS3006261147030 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d27497b2-8e25-4d85-9ce3-0bbab05b6f5c'::uuid AND upper(trim(serial_no)) = 'ZS2521000379');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2017A37289', 0, 'Backfilled from ticket PHS3006261223032 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid AND upper(trim(serial_no)) = '9S2017A37289');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2210A03923', 0, 'Backfilled from ticket PHS3006261314033 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid AND upper(trim(serial_no)) = '9S2210A03923');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B21848023096', 0, 'Backfilled from ticket PHS3006261342034 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid AND upper(trim(serial_no)) = 'B21848023096');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2210A03929', 0, 'Backfilled from ticket PHS3006261343035 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid AND upper(trim(serial_no)) = '9S2210A03929');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '789a4c7d-f004-49ff-a54c-064362f320e7'::uuid, 'ef80e667-ee66-4c41-a16e-3dcd2a4387b5'::uuid, 'SRV6KRIL-IN', '9S2417A00172', 0, 'Backfilled from ticket PHS3006262345037 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='789a4c7d-f004-49ff-a54c-064362f320e7'::uuid AND upper(trim(serial_no)) = '9S2417A00172');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '60d36747-520f-4605-b506-8c9fdc89452e'::uuid, 'fb9a1ea1-011b-49b2-b533-b8922bc03b34'::uuid, 'SRV2KL-IN', '9S2612A07389', 0, 'Backfilled from ticket PHS0107260923039 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='60d36747-520f-4605-b506-8c9fdc89452e'::uuid AND upper(trim(serial_no)) = '9S2612A07389');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5dceeac0-146d-485d-ac2c-f0ae6c36443b'::uuid, '052dcb8e-745b-4339-96f3-5092093ed481'::uuid, 'BR1000G-IN', '0B2522G00503', 0, 'Backfilled from ticket PHS0107260943041 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5dceeac0-146d-485d-ac2c-f0ae6c36443b'::uuid AND upper(trim(serial_no)) = '0B2522G00503');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '55c7662f-7bcd-4e09-9666-0f89c2e49efd'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242412515530', 0, 'Backfilled from ticket PHS0107261038044 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='55c7662f-7bcd-4e09-9666-0f89c2e49efd'::uuid AND upper(trim(serial_no)) = '242412515530');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '512f0485-ad9a-4b84-9fcb-9b7336af4542'::uuid, 'd362fbef-0ed7-42fa-95c9-6c595817de2a'::uuid, 'SRC3KUXI', 'BQ1346000272', 0, 'Backfilled from ticket PHS0107261320047 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='512f0485-ad9a-4b84-9fcb-9b7336af4542'::uuid AND upper(trim(serial_no)) = 'BQ1346000272');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '415d660a-485e-4425-a3c2-fc9ed0b5375d'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2021A55392', 0, 'Backfilled from ticket PHS0107261615049 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='415d660a-485e-4425-a3c2-fc9ed0b5375d'::uuid AND upper(trim(serial_no)) = '9S2021A55392');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6aa72729-01c9-4eae-9c2a-b5b40108ff98'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B22041035242', 0, 'Backfilled from ticket PHS0207260917050 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6aa72729-01c9-4eae-9c2a-b5b40108ff98'::uuid AND upper(trim(serial_no)) = 'B22041035242');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2a292de4-9c67-4af3-b027-1626c329a09d'::uuid, 'fb9a1ea1-011b-49b2-b533-b8922bc03b34'::uuid, 'SRV2KL-IN', '9S2502A02620', 0, 'Backfilled from ticket PHS0207260934052 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2a292de4-9c67-4af3-b027-1626c329a09d'::uuid AND upper(trim(serial_no)) = '9S2502A02620');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd1cee557-4566-41d7-b7f0-44c5258c8ab8'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '9718649050', 0, 'Backfilled from ticket PHS0207260941053 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d1cee557-4566-41d7-b7f0-44c5258c8ab8'::uuid AND upper(trim(serial_no)) = '9718649050');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '67899886-7845-4271-bdfd-3754c4059d99'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242411544906', 0, 'Backfilled from ticket PHS0207261446054 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='67899886-7845-4271-bdfd-3754c4059d99'::uuid AND upper(trim(serial_no)) = '242411544906');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ed96f53e-1588-4ba8-a7cc-417c105742aa'::uuid, '5e5ac265-142d-45af-836a-479f2aeed701'::uuid, 'BR1500G-IN', '0B2504G08175', 0, 'Backfilled from ticket PHS0207261523055 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ed96f53e-1588-4ba8-a7cc-417c105742aa'::uuid AND upper(trim(serial_no)) = '0B2504G08175');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '9ee3c68e-2b03-4b6d-a447-9a5569fc38ea'::uuid, '782d5788-22cc-4297-a1f6-9046c305d737'::uuid, '9E6K-IN', 'ZS296D2005', 0, 'Backfilled from ticket PHS0207261657056 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='9ee3c68e-2b03-4b6d-a447-9a5569fc38ea'::uuid AND upper(trim(serial_no)) = 'ZS296D2005');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '169d53b1-92d9-4132-8f7a-d1a662b3a9d2'::uuid, '2a08691b-2c42-4d72-baa5-3d64d34ea98c'::uuid, 'LD20KT', '84422311500127', 0, 'Backfilled from ticket PHS0207261826058 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='169d53b1-92d9-4132-8f7a-d1a662b3a9d2'::uuid AND upper(trim(serial_no)) = '84422311500127');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a7f65aae-c934-4426-a512-c6889fa42ab3'::uuid, '7a4d3e43-244c-42f2-8c3e-73da3a12557b'::uuid, '1 KVA MAX+ (EXT)', '25I6C020P100010399', 0, 'Backfilled from ticket PHS0307260710059 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a7f65aae-c934-4426-a512-c6889fa42ab3'::uuid AND upper(trim(serial_no)) = '25I6C020P100010399');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4e567236-72ef-42d6-8fdd-f1b01db61f70'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'ZB2605007126', 0, 'Backfilled from ticket PHS0307260754060 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4e567236-72ef-42d6-8fdd-f1b01db61f70'::uuid AND upper(trim(serial_no)) = 'ZB2605007126');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b8c88488-75ae-4b7f-a33b-d6591b1d53ce'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442511506387', 0, 'Backfilled from ticket PHS0307260836061 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b8c88488-75ae-4b7f-a33b-d6591b1d53ce'::uuid AND upper(trim(serial_no)) = '442511506387');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ae49f990-ae06-417f-ae23-673c8cac1e4b'::uuid, '6f292a4d-a939-45df-8cf0-36f65d2c9bf9'::uuid, 'RBC144', '0B24040115869', 0, 'Backfilled from ticket PHS0607261115064 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ae49f990-ae06-417f-ae23-673c8cac1e4b'::uuid AND upper(trim(serial_no)) = '0B24040115869');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '447ec020-7968-4867-8cdb-c8ba466b533c'::uuid, '6f292a4d-a939-45df-8cf0-36f65d2c9bf9'::uuid, 'RBC144', '0B2410G08142', 0, 'Backfilled from ticket PHS0607261116065 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='447ec020-7968-4867-8cdb-c8ba466b533c'::uuid AND upper(trim(serial_no)) = '0B2410G08142');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e6cefad4-fa66-4876-83b3-31ef0d556a78'::uuid, '19ea85ec-c3b1-4be3-87a9-cd6b840b7ae3'::uuid, 'SRV15KUXI-IN', '9S2603A05616', 0, 'Backfilled from ticket PHS0607261135066 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e6cefad4-fa66-4876-83b3-31ef0d556a78'::uuid AND upper(trim(serial_no)) = '9S2603A05616');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '35e15324-ac4e-4380-907a-ac7a676582c9'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'ZB2609010603', 0, 'Backfilled from ticket PHS0607261141067 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='35e15324-ac4e-4380-907a-ac7a676582c9'::uuid AND upper(trim(serial_no)) = 'ZB2609010603');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '35e15324-ac4e-4380-907a-ac7a676582c9'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'ZB2609006432', 0, 'Backfilled from ticket PHS0607261142068 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='35e15324-ac4e-4380-907a-ac7a676582c9'::uuid AND upper(trim(serial_no)) = 'ZB2609006432');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4f99d6d7-916f-43d7-a3d7-82cd82e254c3'::uuid, 'a3736c1f-4c4f-46f8-83c6-9fcc1fd83976'::uuid, 'SRV20KUXI-IN', '9S2447A03137', 0, 'Backfilled from ticket PHS0607261827071 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4f99d6d7-916f-43d7-a3d7-82cd82e254c3'::uuid AND upper(trim(serial_no)) = '9S2447A03137');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '97991d53-17ec-40d7-b515-432e72213e1f'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242412515603', 0, 'Backfilled from ticket PHS0607261828072 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='97991d53-17ec-40d7-b515-432e72213e1f'::uuid AND upper(trim(serial_no)) = '242412515603');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8c99eaa4-4e03-4aa6-b6ad-83a1140bd63a'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2126A88342', 0, 'Backfilled from ticket PHS0607261831073 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8c99eaa4-4e03-4aa6-b6ad-83a1140bd63a'::uuid AND upper(trim(serial_no)) = '9S2126A88342');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '32c40424-8c12-41ee-9a5f-a4e4e7089b36'::uuid, '5e5ac265-142d-45af-836a-479f2aeed701'::uuid, 'BR1500G-IN', '0B2445G52021', 0, 'Backfilled from ticket PHS0607261839074 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='32c40424-8c12-41ee-9a5f-a4e4e7089b36'::uuid AND upper(trim(serial_no)) = '0B2445G52021');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6936468d-7f26-4beb-a835-cf07fc6a68a4'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2432G16109', 0, 'Backfilled from ticket PHS0607261844075 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6936468d-7f26-4beb-a835-cf07fc6a68a4'::uuid AND upper(trim(serial_no)) = '0B2432G16109');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd143019d-8f19-4a8e-9c34-40fd4aa470d5'::uuid, '9d7995ea-7a81-49b5-805d-5d0758b8d8b4'::uuid, 'SRV10KUXI-IN', '9S2348A00402', 0, 'Backfilled from ticket PHS0607261845076 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d143019d-8f19-4a8e-9c34-40fd4aa470d5'::uuid AND upper(trim(serial_no)) = '9S2348A00402');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6d79e595-a9c8-4b12-afcc-7bb0d62332bd'::uuid, 'afbd8c2c-8343-4350-ba95-adbc6665f342'::uuid, 'SRV3KUXI-IN', '9S2417A02428', 0, 'Backfilled from ticket PHS0707261655078 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6d79e595-a9c8-4b12-afcc-7bb0d62332bd'::uuid AND upper(trim(serial_no)) = '9S2417A02428');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5b5996d0-98a7-4c9c-947b-3b86cb07f886'::uuid, 'e95c2f18-0ef0-4f9b-b3b5-e56eee9623f5'::uuid, 'BE650Y-IN', 'BB0938000659', 0, 'Backfilled from ticket PHS0707261756081 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5b5996d0-98a7-4c9c-947b-3b86cb07f886'::uuid AND upper(trim(serial_no)) = 'BB0938000659');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '81a6d399-7da0-4f17-b097-baaff495b7ed'::uuid, '5e5ac265-142d-45af-836a-479f2aeed701'::uuid, 'BR1500G-IN', 'ZB2546006634', 0, 'Backfilled from ticket PHS0707261816084 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='81a6d399-7da0-4f17-b097-baaff495b7ed'::uuid AND upper(trim(serial_no)) = 'ZB2546006634');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '054f470a-5ccb-44d3-be84-909b814e3996'::uuid, 'c6dd0953-02f4-41fb-b509-3d12180bae31'::uuid, 'BX1100I-IN', '9B2425A04581', 0, 'Backfilled from ticket PHS0707261821086 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='054f470a-5ccb-44d3-be84-909b814e3996'::uuid AND upper(trim(serial_no)) = '9B2425A04581');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'af05ad96-f699-48fd-bf0d-8e8bbe4f5ac0'::uuid, '6ea11b4e-5029-409c-9061-65d4a7895f27'::uuid, 'BX2000UXI', '9B1742A00621', 0, 'Backfilled from ticket PHS0907261319087 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='af05ad96-f699-48fd-bf0d-8e8bbe4f5ac0'::uuid AND upper(trim(serial_no)) = '9B1742A00621');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '294405aa-1775-4d86-9613-d20d54d43203'::uuid, 'c6dd0953-02f4-41fb-b509-3d12180bae31'::uuid, 'BX1100I-IN', '9B2537820075', 0, 'Backfilled from ticket PHS0907261320088 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='294405aa-1775-4d86-9613-d20d54d43203'::uuid AND upper(trim(serial_no)) = '9B2537820075');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a5d673a8-2da1-4822-9829-71a8f8adc2ed'::uuid, '14a0cac3-17cb-48bf-9fdf-9f7ed06f1421'::uuid, 'BVX1600LI-IN', '9B2122A19603', 0, 'Backfilled from ticket PHS0907261532089 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a5d673a8-2da1-4822-9829-71a8f8adc2ed'::uuid AND upper(trim(serial_no)) = '9B2122A19603');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f6b2a498-d888-4154-998e-bfbbbaaf7a35'::uuid, 'f24b300d-586e-46a9-973a-d629f697a8de'::uuid, 'AP9544', 'QA2543171345', 0, 'Backfilled from ticket PHS0907261535090 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f6b2a498-d888-4154-998e-bfbbbaaf7a35'::uuid AND upper(trim(serial_no)) = 'QA2543171345');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '73d62dfa-88df-4f79-8b19-0f5d354f8fe2'::uuid, '5e5ac265-142d-45af-836a-479f2aeed701'::uuid, 'BR1500G-IN', 'B22242012358', 0, 'Backfilled from ticket PHS0907261813091 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='73d62dfa-88df-4f79-8b19-0f5d354f8fe2'::uuid AND upper(trim(serial_no)) = 'B22242012358');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '3125593e-d490-463c-9c2f-d9b271349db9'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2124A73950', 0, 'Backfilled from ticket PHS1007261329094 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='3125593e-d490-463c-9c2f-d9b271349db9'::uuid AND upper(trim(serial_no)) = '9S2124A73950');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '134829b2-a63d-496c-ad8e-847dc747845c'::uuid, '4457e907-5780-4a81-be5d-700523d27119'::uuid, 'BVX2200LI-IN', '9B2431A27043', 0, 'Backfilled from ticket PHS1007261335095 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='134829b2-a63d-496c-ad8e-847dc747845c'::uuid AND upper(trim(serial_no)) = '9B2431A27043');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7ef24dba-63eb-4cf3-8447-c2b5513d4c63'::uuid, '9d7995ea-7a81-49b5-805d-5d0758b8d8b4'::uuid, 'SRV10KUXI-IN', '9S2521A00108', 0, 'Backfilled from ticket PHS1007261355096 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7ef24dba-63eb-4cf3-8447-c2b5513d4c63'::uuid AND upper(trim(serial_no)) = '9S2521A00108');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '3911cabd-6ca2-4b26-9550-b896f8daf958'::uuid, 'c6dd0953-02f4-41fb-b509-3d12180bae31'::uuid, 'BX1100I-IN', '9B2510A32179', 0, 'Backfilled from ticket PHS1007261403097 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='3911cabd-6ca2-4b26-9550-b896f8daf958'::uuid AND upper(trim(serial_no)) = '9B2510A32179');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '98dc27b9-735d-4e7c-a0c8-1c99b75036a8'::uuid, 'a3736c1f-4c4f-46f8-83c6-9fcc1fd83976'::uuid, 'SRV20KUXI-IN', 'S9S2441A00970', 0, 'Backfilled from ticket PHS1307261304101 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='98dc27b9-735d-4e7c-a0c8-1c99b75036a8'::uuid AND upper(trim(serial_no)) = 'S9S2441A00970');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'fcf70c1a-d6eb-46ab-935d-4fa208805070'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'ZB26090110792', 0, 'Backfilled from ticket PHS1307261314102 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='fcf70c1a-d6eb-46ab-935d-4fa208805070'::uuid AND upper(trim(serial_no)) = 'ZB26090110792');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'c4adc083-60f7-4627-acc7-8b6ccd267c09'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2211A00403', 0, 'Backfilled from ticket PHS1307261317103 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='c4adc083-60f7-4627-acc7-8b6ccd267c09'::uuid AND upper(trim(serial_no)) = '9S2211A00403');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7d9d6ca5-5830-46b2-ba66-a4fd51237130'::uuid, '9d7995ea-7a81-49b5-805d-5d0758b8d8b4'::uuid, 'SRV10KUXI-IN', '9S2348A00404', 0, 'Backfilled from ticket PHS1307261448104 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7d9d6ca5-5830-46b2-ba66-a4fd51237130'::uuid AND upper(trim(serial_no)) = '9S2348A00404');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5a981c1f-364a-4f87-b4e0-b3a5fa70059a'::uuid, 'afbd8c2c-8343-4350-ba95-adbc6665f342'::uuid, 'SRV3KUXI-IN', 'ZS2423009927', 0, 'Backfilled from ticket PHS1307261626106 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5a981c1f-364a-4f87-b4e0-b3a5fa70059a'::uuid AND upper(trim(serial_no)) = 'ZS2423009927');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f6b2a498-d888-4154-998e-bfbbbaaf7a35'::uuid, 'afbd8c2c-8343-4350-ba95-adbc6665f342'::uuid, 'SRV3KUXI-IN', '0S2341G01270', 0, 'Backfilled from ticket PHS1307261655107 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f6b2a498-d888-4154-998e-bfbbbaaf7a35'::uuid AND upper(trim(serial_no)) = '0S2341G01270');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '1e6706ea-5527-44f1-b4ca-2b064a91bf6f'::uuid, '29f1e2d6-c64a-45bf-a533-ce0e0f6f13f9'::uuid, 'LD6000-PRO', '83622409501553', 0, 'Backfilled from ticket PHS1407261147108 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='1e6706ea-5527-44f1-b4ca-2b064a91bf6f'::uuid AND upper(trim(serial_no)) = '83622409501553');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '415d660a-485e-4425-a3c2-fc9ed0b5375d'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2534A06562', 0, 'Backfilled from ticket PHS1407261157109 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='415d660a-485e-4425-a3c2-fc9ed0b5375d'::uuid AND upper(trim(serial_no)) = '9S2534A06562');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '415d660a-485e-4425-a3c2-fc9ed0b5375d'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2534A06557', 0, 'Backfilled from ticket PHS1407261159110 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='415d660a-485e-4425-a3c2-fc9ed0b5375d'::uuid AND upper(trim(serial_no)) = '9S2534A06557');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '044b4fbd-c326-4502-8ede-2dfa8397cd08'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', '0Q2345G14707', 0, 'Backfilled from ticket PHS1407261425111 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='044b4fbd-c326-4502-8ede-2dfa8397cd08'::uuid AND upper(trim(serial_no)) = '0Q2345G14707');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '84f70047-0955-4f82-b94a-93be1058fd8f'::uuid, 'c6dd0953-02f4-41fb-b509-3d12180bae31'::uuid, 'BX1100I-IN', '9B2603A03091', 0, 'Backfilled from ticket PHS1407261505112 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='84f70047-0955-4f82-b94a-93be1058fd8f'::uuid AND upper(trim(serial_no)) = '9B2603A03091');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8a73de80-9d10-4ee3-abb2-dc0a1064ddee'::uuid, 'afbd8c2c-8343-4350-ba95-adbc6665f342'::uuid, 'SRV3KUXI-IN', 'ZS2426005761', 0, 'Backfilled from ticket PHS1407261514113 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8a73de80-9d10-4ee3-abb2-dc0a1064ddee'::uuid AND upper(trim(serial_no)) = 'ZS2426005761');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '486d120f-d0db-414d-a16c-321e4e401cbb'::uuid, '9a320824-6bfc-449e-9dc9-bba20616a09b'::uuid, 'SURT20KUXIQ', 'BQ1348000004', 0, 'Backfilled from ticket PHS1507261202114 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='486d120f-d0db-414d-a16c-321e4e401cbb'::uuid AND upper(trim(serial_no)) = 'BQ1348000004');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2210A03925', 0, 'Backfilled from ticket PHS1507261311115 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d4f92cb5-d496-43bc-8069-014a70acbeb9'::uuid AND upper(trim(serial_no)) = '9S2210A03925');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b5ba1ed2-d17f-40e2-a408-551b4ed4d06b'::uuid, 'cc571dd2-8875-4fc0-a25b-77eece980e8b'::uuid, 'BVX1200LI-IN', '9B2233A14817', 0, 'Backfilled from ticket PHS1507261617118 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b5ba1ed2-d17f-40e2-a408-551b4ed4d06b'::uuid AND upper(trim(serial_no)) = '9B2233A14817');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '0952223b-75b3-4e85-98d3-02a416f73f2c'::uuid, '5f35e620-c796-492e-84fd-1772a18c7e52'::uuid, 'LD1000IN', '83122501504119', 0, 'Backfilled from ticket PHS1507261631119 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='0952223b-75b3-4e85-98d3-02a416f73f2c'::uuid AND upper(trim(serial_no)) = '83122501504119');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '78fe4443-f51b-4a04-90a9-1050abd4c7f0'::uuid, '7ff4b4ed-cf30-4e73-a0db-126bc1a60e6c'::uuid, 'LB600UNO', '241812503659', 0, 'Backfilled from ticket PHS1607261106121 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='78fe4443-f51b-4a04-90a9-1050abd4c7f0'::uuid AND upper(trim(serial_no)) = '241812503659');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8d701462-4f9e-4473-8ea0-719a68642100'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2449G03815', 0, 'Backfilled from ticket PHS1607261148122 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8d701462-4f9e-4473-8ea0-719a68642100'::uuid AND upper(trim(serial_no)) = '0B2449G03815');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '84b00b5f-ac14-4bb2-b080-3c3516371df7'::uuid, 'c6dd0953-02f4-41fb-b509-3d12180bae31'::uuid, 'BX1100I-IN', '9B2527A10152', 0, 'Backfilled from ticket PHS1607261151123 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='84b00b5f-ac14-4bb2-b080-3c3516371df7'::uuid AND upper(trim(serial_no)) = '9B2527A10152');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '078008b3-a695-4bfc-a4c9-5b8142a06a0a'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2511G01496', 0, 'Backfilled from ticket PHS1607261202124 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='078008b3-a695-4bfc-a4c9-5b8142a06a0a'::uuid AND upper(trim(serial_no)) = '0B2511G01496');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '778b9fc2-b3ec-4c98-a106-97ff742657e2'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2504A01061', 0, 'Backfilled from ticket PHS1607261208126 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='778b9fc2-b3ec-4c98-a106-97ff742657e2'::uuid AND upper(trim(serial_no)) = '9S2504A01061');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '0318d788-78ca-4bd0-a81b-7e79915a2b5b'::uuid, '10022edb-ffe2-459d-9395-f9c55b020893'::uuid, 'LD3000IN', '83322511500360', 0, 'Backfilled from ticket PHS1607261212128 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='0318d788-78ca-4bd0-a81b-7e79915a2b5b'::uuid AND upper(trim(serial_no)) = '83322511500360');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '608473d9-457c-4e48-bd51-f8364dcff26d'::uuid, 'f9bbd1f7-8aa7-4643-a69c-4259ee5c9041'::uuid, 'SRC2KUXI', 'B21846009454', 0, 'Backfilled from ticket PHS1707261143129 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='608473d9-457c-4e48-bd51-f8364dcff26d'::uuid AND upper(trim(serial_no)) = 'B21846009454');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7893d7fe-7484-4d4c-bde6-1da0ca00652f'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2453A00527', 0, 'Backfilled from ticket PHS1707261147130 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7893d7fe-7484-4d4c-bde6-1da0ca00652f'::uuid AND upper(trim(serial_no)) = '9S2453A00527');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b6d4277b-81de-46c2-869a-c487aa6468b6'::uuid, '0888d497-631c-4e03-9336-531bccb6aa04'::uuid, 'SRVPM10KRIL-IN', '9S2447A03216', 0, 'Backfilled from ticket PHS1707261156131 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b6d4277b-81de-46c2-869a-c487aa6468b6'::uuid AND upper(trim(serial_no)) = '9S2447A03216');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd94cf5bc-60ba-47a6-883d-391d89b79780'::uuid, '10022edb-ffe2-459d-9395-f9c55b020893'::uuid, 'LD3000IN', '9220000000038349', 0, 'Backfilled from ticket PHS1707261202132 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d94cf5bc-60ba-47a6-883d-391d89b79780'::uuid AND upper(trim(serial_no)) = '9220000000038349');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7496f9b4-1a20-4348-8c05-42c7af28e198'::uuid, 'feb54748-d6d8-4664-aa4e-742fbd342dcf'::uuid, 'SRC1KUXIX850', 'B21825010115', 0, 'Backfilled from ticket PHS1707261244133 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7496f9b4-1a20-4348-8c05-42c7af28e198'::uuid AND upper(trim(serial_no)) = 'B21825010115');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '80cdef3b-72ec-4000-8728-79e3b9c93dd5'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2448A08187', 0, 'Backfilled from ticket PHS1707261247134 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='80cdef3b-72ec-4000-8728-79e3b9c93dd5'::uuid AND upper(trim(serial_no)) = '9B2448A08187');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f7aab6f1-8a4f-4c54-87f8-b25af4acb0ce'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', '0B2529G02221', 0, 'Backfilled from ticket PHS1707261715136 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f7aab6f1-8a4f-4c54-87f8-b25af4acb0ce'::uuid AND upper(trim(serial_no)) = '0B2529G02221');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '057b2c8f-4597-4b8e-b852-a5435afd7679'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2345G19608', 0, 'Backfilled from ticket PHS1707261720137 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='057b2c8f-4597-4b8e-b852-a5435afd7679'::uuid AND upper(trim(serial_no)) = '0B2345G19608');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8b8727e9-86d7-4b84-b8c6-82983d26c3d2'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2546A10655', 0, 'Backfilled from ticket PHS1707261725138 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8b8727e9-86d7-4b84-b8c6-82983d26c3d2'::uuid AND upper(trim(serial_no)) = '9B2546A10655');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f8e9f1e8-9da0-40ef-8a6e-98dbc2c43906'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', 'ZB2534006308', 0, 'Backfilled from ticket PHS1707261729139 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f8e9f1e8-9da0-40ef-8a6e-98dbc2c43906'::uuid AND upper(trim(serial_no)) = 'ZB2534006308');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8de95739-deaa-4a1f-9f82-11baf0f86cda'::uuid, '10022edb-ffe2-459d-9395-f9c55b020893'::uuid, 'LD3000IN', '83322310502714', 0, 'Backfilled from ticket PHS1707261735140 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8de95739-deaa-4a1f-9f82-11baf0f86cda'::uuid AND upper(trim(serial_no)) = '83322310502714');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f9f02e4a-cb60-4ead-bb21-24be00e364ae'::uuid, '9d7995ea-7a81-49b5-805d-5d0758b8d8b4'::uuid, 'SRV10KUXI-IN', 'ZS2548020604', 0, 'Backfilled from ticket PHS1707261739141 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f9f02e4a-cb60-4ead-bb21-24be00e364ae'::uuid AND upper(trim(serial_no)) = 'ZS2548020604');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5c8ceca7-d64b-44af-bbee-b9e6d28e3107'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B22210030842', 0, 'Backfilled from ticket PHS1807261710145 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5c8ceca7-d64b-44af-bbee-b9e6d28e3107'::uuid AND upper(trim(serial_no)) = 'B22210030842');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '807a34e8-880e-4029-bd18-4423bc4b0401'::uuid, NULL, 'SRCE6KUXI', 'B22230005408', 0, 'Backfilled from ticket PHS2007261240146 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='807a34e8-880e-4029-bd18-4423bc4b0401'::uuid AND upper(trim(serial_no)) = 'B22230005408');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6fd736fe-d7b0-4fc7-a8ad-77269bccb4e8'::uuid, '9d7995ea-7a81-49b5-805d-5d0758b8d8b4'::uuid, 'SRV10KUXI-IN', 'ZS2437003413', 0, 'Backfilled from ticket PHS2007261243147 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6fd736fe-d7b0-4fc7-a8ad-77269bccb4e8'::uuid AND upper(trim(serial_no)) = 'ZS2437003413');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'c596b450-4216-41b2-8d24-409a2abab55e'::uuid, 'f10a2670-7776-4ab7-83fc-abda666dc015'::uuid, 'SRC1KUXIX850Q', 'B21818006964', 0, 'Backfilled from ticket PHS2007261326148 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='c596b450-4216-41b2-8d24-409a2abab55e'::uuid AND upper(trim(serial_no)) = 'B21818006964');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '9800f279-43c5-464f-9ef3-81548d4ecb33'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2442A15455', 0, 'Backfilled from ticket PHS2007261728150 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='9800f279-43c5-464f-9ef3-81548d4ecb33'::uuid AND upper(trim(serial_no)) = '9B2442A15455');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6607d272-a7ab-4f18-907c-4876c15d733e'::uuid, '5e5ac265-142d-45af-836a-479f2aeed701'::uuid, 'BR1500G-IN', '0B2423G26423', 0, 'Backfilled from ticket PHS2207261322157 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6607d272-a7ab-4f18-907c-4876c15d733e'::uuid AND upper(trim(serial_no)) = '0B2423G26423');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '52a99194-fb48-4814-91e9-722ad3f5c69a'::uuid, '6ea11b4e-5029-409c-9061-65d4a7895f27'::uuid, 'BX2000UXI', '9B1819A07254', 0, 'Backfilled from ticket PHS2207261326158 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='52a99194-fb48-4814-91e9-722ad3f5c69a'::uuid AND upper(trim(serial_no)) = '9B1819A07254');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'db6468d4-d864-4b7e-9ff8-eced3e40483e'::uuid, 'cb9303a3-f56c-4a5e-8ab3-7e130013cab4'::uuid, 'SUA3000I-IND', 'ZS2410051398', 0, 'Backfilled from ticket PHS2307261215163 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='db6468d4-d864-4b7e-9ff8-eced3e40483e'::uuid AND upper(trim(serial_no)) = 'ZS2410051398');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '991a86bc-f95d-4615-939e-85707951bdfd'::uuid, '5f35e620-c796-492e-84fd-1772a18c7e52'::uuid, 'LD1000IN', '83121407103688', 0, 'Backfilled from ticket PHS2307261328164 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='991a86bc-f95d-4615-939e-85707951bdfd'::uuid AND upper(trim(serial_no)) = '83121407103688');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b45cadfb-a17d-4d39-9333-b549f39c21e6'::uuid, 'feb54748-d6d8-4664-aa4e-742fbd342dcf'::uuid, 'SRC1KUXIX850', 'B21827000382', 0, 'Backfilled from ticket PHS2307261353165 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b45cadfb-a17d-4d39-9333-b549f39c21e6'::uuid AND upper(trim(serial_no)) = 'B21827000382');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '895482ba-e4b2-4622-8f03-f0a0965004f4'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2603A19229', 0, 'Backfilled from ticket PHS2307261357166 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='895482ba-e4b2-4622-8f03-f0a0965004f4'::uuid AND upper(trim(serial_no)) = '9B2603A19229');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '84fcb277-7bd6-4868-a4c9-711a1bca888a'::uuid, 'ac9d473a-ea76-43bc-a49e-700c3d771941'::uuid, 'BE700Y-IND', 'B22237001181', 0, 'Backfilled from ticket PHS2407261055167 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='84fcb277-7bd6-4868-a4c9-711a1bca888a'::uuid AND upper(trim(serial_no)) = 'B22237001181');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'bb9a3541-d4de-4331-a279-883b51dff08a'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242411544908', 0, 'Backfilled from ticket PHS2407261437168 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='bb9a3541-d4de-4331-a279-883b51dff08a'::uuid AND upper(trim(serial_no)) = '242411544908');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b1f0ea8d-101e-4757-a12e-c929dd6cbd29'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B22236005254', 0, 'Backfilled from ticket PHS2407261441169 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b1f0ea8d-101e-4757-a12e-c929dd6cbd29'::uuid AND upper(trim(serial_no)) = 'B22236005254');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '9d59b09b-f949-4297-871e-6380f5c0cf94'::uuid, '0888d497-631c-4e03-9336-531bccb6aa04'::uuid, 'SRVPM10KRIL-IN', '9S2447A02756', 0, 'Backfilled from ticket PHS2407261511170 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='9d59b09b-f949-4297-871e-6380f5c0cf94'::uuid AND upper(trim(serial_no)) = '9S2447A02756');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '64a3004d-61f8-4f15-83dc-879e3684ee03'::uuid, NULL, 'SRCE6KUXI', 'B21716006374', 0, 'Backfilled from ticket PHS2507261032171 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='64a3004d-61f8-4f15-83dc-879e3684ee03'::uuid AND upper(trim(serial_no)) = 'B21716006374');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '128cc596-1dd5-4bb8-9a28-ac08597ac2da'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B22249013426', 0, 'Backfilled from ticket PHS2507261037172 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='128cc596-1dd5-4bb8-9a28-ac08597ac2da'::uuid AND upper(trim(serial_no)) = 'B22249013426');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'cf953bdb-97b0-49d1-bf02-b12e707af1cb'::uuid, '8e3360cc-ebe5-4959-a715-94c4e6d50ffe'::uuid, 'LD10000', '83922104100200', 0, 'Backfilled from ticket PHS2507261620173 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='cf953bdb-97b0-49d1-bf02-b12e707af1cb'::uuid AND upper(trim(serial_no)) = '83922104100200');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f9193362-c5eb-426c-ba0b-a4e8c80bee3a'::uuid, 'c6dd0953-02f4-41fb-b509-3d12180bae31'::uuid, 'BX1100I-IN', '9B2603A22628', 0, 'Backfilled from ticket PHS2707261135174 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f9193362-c5eb-426c-ba0b-a4e8c80bee3a'::uuid AND upper(trim(serial_no)) = '9B2603A22628');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58041', 0, 'Backfilled from ticket PHS2707261308176 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid AND upper(trim(serial_no)) = '9S1835A58041');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58084', 0, 'Backfilled from ticket PHS2707261312177 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid AND upper(trim(serial_no)) = '9S1835A58084');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58060', 0, 'Backfilled from ticket PHS2707261315178 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid AND upper(trim(serial_no)) = '9S1835A58060');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58068', 0, 'Backfilled from ticket PHS2707261316179 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid AND upper(trim(serial_no)) = '9S1835A58068');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58078', 0, 'Backfilled from ticket PHS2707261321180 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='968b2421-bdcd-4ed8-af11-cf007f9da34e'::uuid AND upper(trim(serial_no)) = '9S1835A58078');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd4b60d3e-7a3f-4de0-bdfa-f9d7f48a5819'::uuid, 'c390f26e-f016-4687-9bfa-b532074b97d6'::uuid, 'SRC10KUXI-IN', 'BQ1508001453', 0, 'Backfilled from ticket PHS2707261324181 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d4b60d3e-7a3f-4de0-bdfa-f9d7f48a5819'::uuid AND upper(trim(serial_no)) = 'BQ1508001453');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ba978346-e694-49be-8af9-00981758fbd8'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B22137017926', 0, 'Backfilled from ticket PHS2707261332182 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ba978346-e694-49be-8af9-00981758fbd8'::uuid AND upper(trim(serial_no)) = 'B22137017926');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ba978346-e694-49be-8af9-00981758fbd8'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', 'B22108003905', 0, 'Backfilled from ticket PHS2707261334183 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ba978346-e694-49be-8af9-00981758fbd8'::uuid AND upper(trim(serial_no)) = 'B22108003905');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '1ce33ac4-9b11-4d91-b2af-a0a4311936d8'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242504534618', 0, 'Backfilled from ticket PHS2707261615184 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='1ce33ac4-9b11-4d91-b2af-a0a4311936d8'::uuid AND upper(trim(serial_no)) = '242504534618');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'bb61004c-f58e-4183-91ee-2a88de4087ca'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'ZB2541014643', 0, 'Backfilled from ticket PHS2707261645185 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='bb61004c-f58e-4183-91ee-2a88de4087ca'::uuid AND upper(trim(serial_no)) = 'ZB2541014643');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5a2aae9b-c77b-4818-bed2-10198d464699'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', 'B22229009138', 0, 'Backfilled from ticket PHS2807261054187 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5a2aae9b-c77b-4818-bed2-10198d464699'::uuid AND upper(trim(serial_no)) = 'B22229009138');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5b52ee6c-5309-4254-8dc1-c83ad1584277'::uuid, '368a1b34-78f3-44f3-95fd-b1777fb6487b'::uuid, 'SURT6000XLI-CC', 'B21626000863', 0, 'Backfilled from ticket PHS2807261530190 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5b52ee6c-5309-4254-8dc1-c83ad1584277'::uuid AND upper(trim(serial_no)) = 'B21626000863');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'efa31d3d-2d88-4514-9763-c55a58940ec0'::uuid, 'fb9a1ea1-011b-49b2-b533-b8922bc03b34'::uuid, 'SRV2KL-IN', '9S2612A07420', 0, 'Backfilled from ticket PHS2807261813191 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='efa31d3d-2d88-4514-9763-c55a58940ec0'::uuid AND upper(trim(serial_no)) = '9S2612A07420');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4278be32-40c8-4a45-9bc6-8f405c37c81c'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2534A06557', 0, 'Backfilled from ticket PHS2907261135193 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4278be32-40c8-4a45-9bc6-8f405c37c81c'::uuid AND upper(trim(serial_no)) = '9S2534A06557');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a10f3e23-a8b0-4091-994a-3e54edd2b6cd'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2504A03172', 0, 'Backfilled from ticket PHS2907261343194 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a10f3e23-a8b0-4091-994a-3e54edd2b6cd'::uuid AND upper(trim(serial_no)) = '9S2504A03172');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e18df272-43ca-4e3c-b9c5-2c3da13f1b7b'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2603A01842', 0, 'Backfilled from ticket PHS2907261353196 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e18df272-43ca-4e3c-b9c5-2c3da13f1b7b'::uuid AND upper(trim(serial_no)) = '9B2603A01842');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4dc9ccf6-698a-475a-9790-3730c4de9426'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', '0B2529G03142', 0, 'Backfilled from ticket PHS3007261130197 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4dc9ccf6-698a-475a-9790-3730c4de9426'::uuid AND upper(trim(serial_no)) = '0B2529G03142');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '09378a87-79bb-454b-9344-84b76deff77e'::uuid, 'fb9a1ea1-011b-49b2-b533-b8922bc03b34'::uuid, 'SRV2KL-IN', '9S2617A01460', 0, 'Backfilled from ticket PHS3007261300198 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='09378a87-79bb-454b-9344-84b76deff77e'::uuid AND upper(trim(serial_no)) = '9S2617A01460');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '09378a87-79bb-454b-9344-84b76deff77e'::uuid, 'fb9a1ea1-011b-49b2-b533-b8922bc03b34'::uuid, 'SRV2KL-IN', '9S2617A01462', 0, 'Backfilled from ticket PHS3007261301199 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='09378a87-79bb-454b-9344-84b76deff77e'::uuid AND upper(trim(serial_no)) = '9S2617A01462');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '95dbef93-0337-49b9-b85c-9df64da67a76'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', 'B22002010109', 0, 'Backfilled from ticket PHS3007261754202 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='95dbef93-0337-49b9-b85c-9df64da67a76'::uuid AND upper(trim(serial_no)) = 'B22002010109');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a2b60f96-8148-4eea-815f-2e656cc7addf'::uuid, '7cc692ef-dc56-4801-92a7-90931dbbcdc0'::uuid, 'SURT10000XLI', 'B21421002220', 0, 'Backfilled from ticket PHS3107261106203 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a2b60f96-8148-4eea-815f-2e656cc7addf'::uuid AND upper(trim(serial_no)) = 'B21421002220');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e398a2b4-15b1-4b40-aeeb-36096dd8dc6a'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242411545534', 0, 'Backfilled from ticket PHS3107261139204 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e398a2b4-15b1-4b40-aeeb-36096dd8dc6a'::uuid AND upper(trim(serial_no)) = '242411545534');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7cb74d8c-86fa-45b0-9d15-843af4bf124f'::uuid, '368a1b34-78f3-44f3-95fd-b1777fb6487b'::uuid, 'SURT6000XLI-CC', 'QQ1202250620,IS1022004317', 0, 'Backfilled from ticket PHS3107261541205 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7cb74d8c-86fa-45b0-9d15-843af4bf124f'::uuid AND upper(trim(serial_no)) = 'QQ1202250620,IS1022004317');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a6f004ee-9f55-4dff-ab1e-7695c3c66f35'::uuid, '59e5d06e-34b7-4285-96c6-206c9c40d65f'::uuid, 'SURTD5000XLI-CC', 'B21837015541', 0, 'Backfilled from ticket PHS3107261634206 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a6f004ee-9f55-4dff-ab1e-7695c3c66f35'::uuid AND upper(trim(serial_no)) = 'B21837015541');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '03c83ca5-a030-46e3-a6a9-637990e71150'::uuid, '3bd7a732-55e4-47a5-8e0d-492aa27691ee'::uuid, 'SRVPM3KRIL-IN', '9S2218A02719', 0, 'Backfilled from ticket PHS0108261513208 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='03c83ca5-a030-46e3-a6a9-637990e71150'::uuid AND upper(trim(serial_no)) = '9S2218A02719');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2909ef07-996a-426e-bf76-e384f927a49f'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '9B2527A21585', 0, 'Backfilled from ticket PHS0108261525209 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2909ef07-996a-426e-bf76-e384f927a49f'::uuid AND upper(trim(serial_no)) = '9B2527A21585');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '53b5a52a-bf9a-43b6-9a65-11304cd1d19e'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', 'B22039020132', 0, 'Backfilled from ticket PHS0108261611210 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='53b5a52a-bf9a-43b6-9a65-11304cd1d19e'::uuid AND upper(trim(serial_no)) = 'B22039020132');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '759a0126-c429-4764-91bf-16776d26078d'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', '0B2408G12615', 0, 'Backfilled from ticket PHS0308261528213 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='759a0126-c429-4764-91bf-16776d26078d'::uuid AND upper(trim(serial_no)) = '0B2408G12615');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '63a0cb34-f9e7-419c-bbc4-098fc4ffc9be'::uuid, 'd362fbef-0ed7-42fa-95c9-6c595817de2a'::uuid, 'SRC3KUXI', 'B22246014874', 0, 'Backfilled from ticket PHS0308261707214 (' || 'New' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='63a0cb34-f9e7-419c-bbc4-098fc4ffc9be'::uuid AND upper(trim(serial_no)) = 'B22246014874');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442501517212', 0, 'Backfilled from ticket PHS0308261806216 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid AND upper(trim(serial_no)) = '442501517212');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442501517613', 0, 'Backfilled from ticket PHS0308261806217 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid AND upper(trim(serial_no)) = '442501517613');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4565d742-719f-45a0-918c-e6f315ff1235'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2527A21819', 0, 'Backfilled from ticket PHS0308261818218 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4565d742-719f-45a0-918c-e6f315ff1235'::uuid AND upper(trim(serial_no)) = '9B2527A21819');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '78308998-abc7-4070-8581-6b8762cbc983'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242402500731', 0, 'Backfilled from ticket PHS0308261840219 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='78308998-abc7-4070-8581-6b8762cbc983'::uuid AND upper(trim(serial_no)) = '242402500731');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442501517614', 0, 'Backfilled from ticket PHS0408261251221 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid AND upper(trim(serial_no)) = '442501517614');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442509506791', 0, 'Backfilled from ticket PHS0408261253222 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid AND upper(trim(serial_no)) = '442509506791');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442509506805', 0, 'Backfilled from ticket PHS0408261255223 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid AND upper(trim(serial_no)) = '442509506805');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442509506806', 0, 'Backfilled from ticket PHS0408261301224 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e1c12066-8c0b-4e1a-9f9a-38fcdd127713'::uuid AND upper(trim(serial_no)) = '442509506806');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f7ac40e8-6ca5-408d-9eb6-e77ee85aee32'::uuid, '0888d497-631c-4e03-9336-531bccb6aa04'::uuid, 'SRVPM10KRIL-IN', '9S2352A03942', 0, 'Backfilled from ticket PHS0408261614225 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f7ac40e8-6ca5-408d-9eb6-e77ee85aee32'::uuid AND upper(trim(serial_no)) = '9S2352A03942');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5f063602-17cd-473f-bf72-bc4a9b4a6c17'::uuid, '5e5ac265-142d-45af-836a-479f2aeed701'::uuid, 'BR1500G-IN', '0B2445G50952', 0, 'Backfilled from ticket PHS0408261637226 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5f063602-17cd-473f-bf72-bc4a9b4a6c17'::uuid AND upper(trim(serial_no)) = '0B2445G50952');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '16f0baa5-7708-4930-89da-daeeb9dd6e04'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2621A01513', 0, 'Backfilled from ticket PHS0408261647227 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='16f0baa5-7708-4930-89da-daeeb9dd6e04'::uuid AND upper(trim(serial_no)) = '9S2621A01513');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b52b9d37-b7ff-4008-ae7c-b6fbcdc98642'::uuid, '45c3dbaf-021f-42fc-931a-8f77f534be68'::uuid, 'LD6000-INX', 'ZS2421009692', 0, 'Backfilled from ticket PHS0408261709228 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b52b9d37-b7ff-4008-ae7c-b6fbcdc98642'::uuid AND upper(trim(serial_no)) = 'ZS2421009692');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b52b9d37-b7ff-4008-ae7c-b6fbcdc98642'::uuid, 'deb7216a-43e0-4064-be5a-765adad0fa48'::uuid, 'LD6000', '83622304100539', 0, 'Backfilled from ticket PHS0408261710229 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b52b9d37-b7ff-4008-ae7c-b6fbcdc98642'::uuid AND upper(trim(serial_no)) = '83622304100539');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '71eda439-72b2-4adb-90ae-9d319301a509'::uuid, '10022edb-ffe2-459d-9395-f9c55b020893'::uuid, 'LD3000IN', '83322405500786', 0, 'Backfilled from ticket PHS0408261714231 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='71eda439-72b2-4adb-90ae-9d319301a509'::uuid AND upper(trim(serial_no)) = '83322405500786');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '0c8ffd8a-b884-45d4-8e2f-cc8cf001770a'::uuid, '9d7995ea-7a81-49b5-805d-5d0758b8d8b4'::uuid, 'SRV10KUXI-IN', 'ZS2352070165', 0, 'Backfilled from ticket PHS0508261321235 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='0c8ffd8a-b884-45d4-8e2f-cc8cf001770a'::uuid AND upper(trim(serial_no)) = 'ZS2352070165');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '489068ca-5ea2-4512-a7d1-576494e4f0de'::uuid, 'c6dd0953-02f4-41fb-b509-3d12180bae31'::uuid, 'BX1100I-IN', '9B2603A22645', 0, 'Backfilled from ticket PHS0508261326236 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='489068ca-5ea2-4512-a7d1-576494e4f0de'::uuid AND upper(trim(serial_no)) = '9B2603A22645');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8b24b448-c9af-458e-a686-c0318d37bc37'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'ZB2538000915', 0, 'Backfilled from ticket PHS0608261458237 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8b24b448-c9af-458e-a686-c0318d37bc37'::uuid AND upper(trim(serial_no)) = 'ZB2538000915');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2c8b7e17-d6ad-4ce7-bb17-faa4b63a5745'::uuid, NULL, 'SRCE6KUXI', 'B21846007501', 0, 'Backfilled from ticket PHS0608261507238 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2c8b7e17-d6ad-4ce7-bb17-faa4b63a5745'::uuid AND upper(trim(serial_no)) = 'B21846007501');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ffa3cee5-cfdd-4b83-9d38-35f69af0eed0'::uuid, 'c390f26e-f016-4687-9bfa-b532074b97d6'::uuid, 'SRC10KUXI-IN', 'B22238008796', 0, 'Backfilled from ticket PHS0608261716239 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ffa3cee5-cfdd-4b83-9d38-35f69af0eed0'::uuid AND upper(trim(serial_no)) = 'B22238008796');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6804d815-a190-4ee1-8cea-8e3d8b5ee8f8'::uuid, '052dcb8e-745b-4339-96f3-5092093ed481'::uuid, 'BR1000G-IN', '0Q2444G01674', 0, 'Backfilled from ticket PHS0608261721241 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6804d815-a190-4ee1-8cea-8e3d8b5ee8f8'::uuid AND upper(trim(serial_no)) = '0Q2444G01674');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5f7eef57-c9b0-4c26-b695-36f90560437d'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242507500586', 0, 'Backfilled from ticket PHS0608261738242 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5f7eef57-c9b0-4c26-b695-36f90560437d'::uuid AND upper(trim(serial_no)) = '242507500586');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7a336feb-cade-471d-a898-d483075d58b8'::uuid, '19ea85ec-c3b1-4be3-87a9-cd6b840b7ae3'::uuid, 'SRV15KUXI-IN', '9S2502A01882', 0, 'Backfilled from ticket PHS0708261743245 (' || 'New' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7a336feb-cade-471d-a898-d483075d58b8'::uuid AND upper(trim(serial_no)) = '9S2502A01882');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f1d451eb-5b1c-451b-b3b3-e5d7a4dec87b'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2023A65038', 0, 'Backfilled from ticket PHS0708261749246 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f1d451eb-5b1c-451b-b3b3-e5d7a4dec87b'::uuid AND upper(trim(serial_no)) = '9S2023A65038');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f1d451eb-5b1c-451b-b3b3-e5d7a4dec87b'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2012A21804', 0, 'Backfilled from ticket PHS0708261754247 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f1d451eb-5b1c-451b-b3b3-e5d7a4dec87b'::uuid AND upper(trim(serial_no)) = '9S2012A21804');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4c0168be-4063-4754-b7b9-0e48f63771c1'::uuid, '74340174-e4a4-4734-99b7-ccb05bce4ec7'::uuid, 'SRC1KUXI-IN', '9Q2308A00428', 0, 'Backfilled from ticket PHS0708261757248 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4c0168be-4063-4754-b7b9-0e48f63771c1'::uuid AND upper(trim(serial_no)) = '9Q2308A00428');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'cce7b256-6814-40f7-bf24-b0a61c43113b'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2426A00144', 0, 'Backfilled from ticket PHS0708261804249 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='cce7b256-6814-40f7-bf24-b0a61c43113b'::uuid AND upper(trim(serial_no)) = '9S2426A00144');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2811dea7-4caf-4322-bba2-0fb90c65adfc'::uuid, '10022edb-ffe2-459d-9395-f9c55b020893'::uuid, 'LD3000IN', '83322311502754', 0, 'Backfilled from ticket PHS0708261806250 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2811dea7-4caf-4322-bba2-0fb90c65adfc'::uuid AND upper(trim(serial_no)) = '83322311502754');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'cc0135d3-a47b-4e52-89de-e8ec30e6df4f'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2403A06719', 0, 'Backfilled from ticket PHS0708261812251 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='cc0135d3-a47b-4e52-89de-e8ec30e6df4f'::uuid AND upper(trim(serial_no)) = '9S2403A06719');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '55d868a2-450e-4593-beca-5766e4ff03e4'::uuid, '6ea11b4e-5029-409c-9061-65d4a7895f27'::uuid, 'BX2000UXI', '9B2319A07242', 0, 'Backfilled from ticket PHS1008261348253 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='55d868a2-450e-4593-beca-5766e4ff03e4'::uuid AND upper(trim(serial_no)) = '9B2319A07242');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd0ad22ea-1e39-4b91-9144-4f6cfd160fe1'::uuid, '561c0e41-595f-4812-98b0-edaae91c7e0d'::uuid, 'SRV3KL-IN', '9S2320A04261', 0, 'Backfilled from ticket PHS1008261351254 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d0ad22ea-1e39-4b91-9144-4f6cfd160fe1'::uuid AND upper(trim(serial_no)) = '9S2320A04261');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2811dea7-4caf-4322-bba2-0fb90c65adfc'::uuid, '0ebf271d-a6c4-4326-a427-4bb9cd83866e'::uuid, 'LD3000', '83322311502475', 0, 'Backfilled from ticket PHS1108261108256 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2811dea7-4caf-4322-bba2-0fb90c65adfc'::uuid AND upper(trim(serial_no)) = '83322311502475');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4ddd3dff-86af-491c-9dcd-2dd4c50025bf'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B225039020131', 0, 'Backfilled from ticket PHS1108261117257 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4ddd3dff-86af-491c-9dcd-2dd4c50025bf'::uuid AND upper(trim(serial_no)) = 'B225039020131');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'af5fe7be-e0d8-4810-a0ef-a7cb916564b3'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242411549960', 0, 'Backfilled from ticket PHS1108261240258 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='af5fe7be-e0d8-4810-a0ef-a7cb916564b3'::uuid AND upper(trim(serial_no)) = '242411549960');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '1579c8db-cec8-44c1-8fc6-8218a308f617'::uuid, '052dcb8e-745b-4339-96f3-5092093ed481'::uuid, 'BR1000G-IN', 'B22123002591', 0, 'Backfilled from ticket PHS1108261453259 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='1579c8db-cec8-44c1-8fc6-8218a308f617'::uuid AND upper(trim(serial_no)) = 'B22123002591');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '223aaa05-b353-4084-8037-735e44ee13fc'::uuid, '846e1b76-fbc7-42fe-a4da-e00b1b9ebe12'::uuid, 'LD6000TXL', '83622302101641', 0, 'Backfilled from ticket PHS1108261536260 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='223aaa05-b353-4084-8037-735e44ee13fc'::uuid AND upper(trim(serial_no)) = '83622302101641');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5710cbec-744e-4a70-80fc-70836d65e364'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2326A00379', 0, 'Backfilled from ticket PHS1108261603261 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5710cbec-744e-4a70-80fc-70836d65e364'::uuid AND upper(trim(serial_no)) = '9S2326A00379');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a862bfb6-c800-4fa9-a3be-bc3e0016f258'::uuid, 'a3736c1f-4c4f-46f8-83c6-9fcc1fd83976'::uuid, 'SRV20KUXI-IN', '9S2440A00040', 0, 'Backfilled from ticket PHS1108261759262 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a862bfb6-c800-4fa9-a3be-bc3e0016f258'::uuid AND upper(trim(serial_no)) = '9S2440A00040');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd4b60d3e-7a3f-4de0-bdfa-f9d7f48a5819'::uuid, 'c390f26e-f016-4687-9bfa-b532074b97d6'::uuid, 'SRC10KUXI-IN', 'B21635001115', 0, 'Backfilled from ticket PHS1208261104265 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d4b60d3e-7a3f-4de0-bdfa-f9d7f48a5819'::uuid AND upper(trim(serial_no)) = 'B21635001115');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'dfe7e1a2-195c-4112-9b5c-3bb9510a57e9'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442506511063', 0, 'Backfilled from ticket PHS1208261456267 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='dfe7e1a2-195c-4112-9b5c-3bb9510a57e9'::uuid AND upper(trim(serial_no)) = '442506511063');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'dfe7e1a2-195c-4112-9b5c-3bb9510a57e9'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242507500603', 0, 'Backfilled from ticket PHS1208261515268 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='dfe7e1a2-195c-4112-9b5c-3bb9510a57e9'::uuid AND upper(trim(serial_no)) = '242507500603');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '81537490-6015-4589-a094-b6e056774fc9'::uuid, '83b71185-27c9-4c85-bd17-a209715c0a1c'::uuid, 'SRV5KL-IN', '9S2451A04247', 0, 'Backfilled from ticket PHS1208261749270 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='81537490-6015-4589-a094-b6e056774fc9'::uuid AND upper(trim(serial_no)) = '9S2451A04247');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '346b331c-0d5d-47c2-939e-dc2b698ca73e'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2432G12174', 0, 'Backfilled from ticket PHS1208261800271 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='346b331c-0d5d-47c2-939e-dc2b698ca73e'::uuid AND upper(trim(serial_no)) = '0B2432G12174');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '976080c8-70a4-4507-a7e4-c154b72e78d8'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242502505167', 0, 'Backfilled from ticket PHS1208261808273 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='976080c8-70a4-4507-a7e4-c154b72e78d8'::uuid AND upper(trim(serial_no)) = '242502505167');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '474dc4e0-d45f-48fc-aae6-91e6ce7b4a23'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2317A03688', 0, 'Backfilled from ticket PHS1308261120276 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='474dc4e0-d45f-48fc-aae6-91e6ce7b4a23'::uuid AND upper(trim(serial_no)) = '9S2317A03688');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7cb74d8c-86fa-45b0-9d15-843af4bf124f'::uuid, '53773aae-30c3-45ba-804e-0c0b06b44bc6'::uuid, 'RBC44', '0H2551G05075', 0, 'Backfilled from ticket PHS1308261257277 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7cb74d8c-86fa-45b0-9d15-843af4bf124f'::uuid AND upper(trim(serial_no)) = '0H2551G05075');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7cb74d8c-86fa-45b0-9d15-843af4bf124f'::uuid, '53773aae-30c3-45ba-804e-0c0b06b44bc6'::uuid, 'RBC44', '0H2551G05092', 0, 'Backfilled from ticket PHS1308261259278 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7cb74d8c-86fa-45b0-9d15-843af4bf124f'::uuid AND upper(trim(serial_no)) = '0H2551G05092');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'e23d2edf-3906-44a6-a1ca-5052f0f7eaec'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', 'ZS2439035902', 0, 'Backfilled from ticket PHS1308261620280 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='e23d2edf-3906-44a6-a1ca-5052f0f7eaec'::uuid AND upper(trim(serial_no)) = 'ZS2439035902');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'fa84eb52-6bb2-48f4-8771-020b5963531e'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442504535179', 0, 'Backfilled from ticket PHS1308261626281 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='fa84eb52-6bb2-48f4-8771-020b5963531e'::uuid AND upper(trim(serial_no)) = '442504535179');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '67162a55-2d93-4bed-80d5-5def4cb0d3e2'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2439A00228', 0, 'Backfilled from ticket PHS1308261723282 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='67162a55-2d93-4bed-80d5-5def4cb0d3e2'::uuid AND upper(trim(serial_no)) = '9S2439A00228');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'dd41726a-489a-4e0b-85f0-6c9deacba960'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2434G01289', 0, 'Backfilled from ticket PHS1308261742283 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='dd41726a-489a-4e0b-85f0-6c9deacba960'::uuid AND upper(trim(serial_no)) = '0B2434G01289');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8e55e516-92d0-4e8f-9f23-246fd24f691a'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242504534595', 0, 'Backfilled from ticket PHS1408261527284 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8e55e516-92d0-4e8f-9f23-246fd24f691a'::uuid AND upper(trim(serial_no)) = '242504534595');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '01cfed76-d0f6-4774-8300-83be5609e6c7'::uuid, 'b17f0cca-dd79-4714-8086-1c4065e0956a'::uuid, 'LD10K 3P:3P', '85122111600194', 0, 'Backfilled from ticket PHS1408261729285 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='01cfed76-d0f6-4774-8300-83be5609e6c7'::uuid AND upper(trim(serial_no)) = '85122111600194');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7a336feb-cade-471d-a898-d483075d58b8'::uuid, '19ea85ec-c3b1-4be3-87a9-cd6b840b7ae3'::uuid, 'SRV15KUXI-IN', '9S2502A01873', 0, 'Backfilled from ticket PHS1708261111286 (' || 'New' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7a336feb-cade-471d-a898-d483075d58b8'::uuid AND upper(trim(serial_no)) = '9S2502A01873');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8e282f63-13cc-4ba5-a4a2-f130f4ff0071'::uuid, '052dcb8e-745b-4339-96f3-5092093ed481'::uuid, 'BR1000G-IN', '0B2507G09383', 0, 'Backfilled from ticket PHS1708261115287 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8e282f63-13cc-4ba5-a4a2-f130f4ff0071'::uuid AND upper(trim(serial_no)) = '0B2507G09383');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '101a5409-fc40-4dec-81e0-ab43b8c1a3e4'::uuid, '5dbe46fc-38d4-42ea-8bf1-ce4ecfcaa781'::uuid, 'LD2000IN', '83222310500726', 0, 'Backfilled from ticket PHS1708261119288 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='101a5409-fc40-4dec-81e0-ab43b8c1a3e4'::uuid AND upper(trim(serial_no)) = '83222310500726');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '1597c790-b684-4d4a-b290-268589375aef'::uuid, 'a3736c1f-4c4f-46f8-83c6-9fcc1fd83976'::uuid, 'SRV20KUXI-IN', '9S2524A05110', 0, 'Backfilled from ticket PHS1708261153290 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='1597c790-b684-4d4a-b290-268589375aef'::uuid AND upper(trim(serial_no)) = '9S2524A05110');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '077a46b3-5180-4914-8caa-9efcfc9a6ab6'::uuid, '14a0cac3-17cb-48bf-9fdf-9f7ed06f1421'::uuid, 'BVX1600LI-IN', '9B2210AC1185', 0, 'Backfilled from ticket PHS1708261157291 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='077a46b3-5180-4914-8caa-9efcfc9a6ab6'::uuid AND upper(trim(serial_no)) = '9B2210AC1185');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2acd670c-37c4-47b4-8871-b69f6de0ed36'::uuid, '052dcb8e-745b-4339-96f3-5092093ed481'::uuid, 'BR1000G-IN', 'BQ1949030088', 0, 'Backfilled from ticket PHS1708261221293 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2acd670c-37c4-47b4-8871-b69f6de0ed36'::uuid AND upper(trim(serial_no)) = 'BQ1949030088');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2eb64903-dbb9-44e1-9486-edf396788547'::uuid, 'e568e52d-3bed-4e03-ac05-54daec31684e'::uuid, 'SURT20KUXIG-IN', 'B217450201989', 0, 'Backfilled from ticket PHS1708261335294 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2eb64903-dbb9-44e1-9486-edf396788547'::uuid AND upper(trim(serial_no)) = 'B217450201989');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ec27dee6-1ba1-4020-b4b0-ccfe13aeede8'::uuid, 'f3171941-f9fa-4d5e-b514-72d05e1eb975'::uuid, 'SRCE6KUXI-IN', 'B21906002153', 0, 'Backfilled from ticket PHS1708261337295 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ec27dee6-1ba1-4020-b4b0-ccfe13aeede8'::uuid AND upper(trim(serial_no)) = 'B21906002153');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b0060485-138b-4395-a06b-15c4810ec8af'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', 'ZS2521000021', 0, 'Backfilled from ticket PHS1708261443296 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b0060485-138b-4395-a06b-15c4810ec8af'::uuid AND upper(trim(serial_no)) = 'ZS2521000021');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4dee900e-9efe-45b4-8a8d-21cc2e40f84a'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2124A73813', 0, 'Backfilled from ticket PHS1708261627297 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4dee900e-9efe-45b4-8a8d-21cc2e40f84a'::uuid AND upper(trim(serial_no)) = '9S2124A73813');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b7fec289-f94e-426a-85e6-3fced7eb54b2'::uuid, '4457e907-5780-4a81-be5d-700523d27119'::uuid, 'BVX2200LI-IN', '9B2545A29301', 0, 'Backfilled from ticket PHS1708261849299 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b7fec289-f94e-426a-85e6-3fced7eb54b2'::uuid AND upper(trim(serial_no)) = '9B2545A29301');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'f36b9bc6-aea0-4e20-b66f-401023f590a9'::uuid, 'f244bcdf-384c-4dd9-a1e6-1612fea09a61'::uuid, 'SRV1KL-IN', '9S2147A01376', 0, 'Backfilled from ticket PHS1808261103301 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='f36b9bc6-aea0-4e20-b66f-401023f590a9'::uuid AND upper(trim(serial_no)) = '9S2147A01376');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '216bfdce-509c-4a22-9470-94053b621e8b'::uuid, '5420a62f-7634-4d38-93d7-08eacb938371'::uuid, 'LD2000XL-NC', '83222310100462', 0, 'Backfilled from ticket PHS1808261113303 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='216bfdce-509c-4a22-9470-94053b621e8b'::uuid AND upper(trim(serial_no)) = '83222310100462');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '16cd2b7b-353f-468b-a46b-c4a54da6df36'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2538A03544', 0, 'Backfilled from ticket PHS1808261231308 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='16cd2b7b-353f-468b-a46b-c4a54da6df36'::uuid AND upper(trim(serial_no)) = '9S2538A03544');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '857bb7c3-cefb-418d-8685-229959c5f022'::uuid, '4e887db8-11b6-4c49-9803-3d521aa26781'::uuid, 'LB1000PRO', '442403505104', 0, 'Backfilled from ticket PHS1808261244309 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='857bb7c3-cefb-418d-8685-229959c5f022'::uuid AND upper(trim(serial_no)) = '442403505104');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '19c73317-15df-40ea-9d45-0c3895b295d4'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242502510193', 0, 'Backfilled from ticket PHS1808261247310 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='19c73317-15df-40ea-9d45-0c3895b295d4'::uuid AND upper(trim(serial_no)) = '242502510193');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '678fd355-fa4d-4635-a376-5e884beb4613'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', 'ZS2550020636', 0, 'Backfilled from ticket PHS1808261251312 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='678fd355-fa4d-4635-a376-5e884beb4613'::uuid AND upper(trim(serial_no)) = 'ZS2550020636');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8a8c9946-02bd-4c92-86b2-eb0ecc9af34d'::uuid, '5e5ac265-142d-45af-836a-479f2aeed701'::uuid, 'BR1500G-IN', 'ZB2539030683', 0, 'Backfilled from ticket PHS1808261259313 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8a8c9946-02bd-4c92-86b2-eb0ecc9af34d'::uuid AND upper(trim(serial_no)) = 'ZB2539030683');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '466209b8-f7dc-488c-937d-6e6c13a267bc'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2340A01755', 0, 'Backfilled from ticket PHS1808261801315 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='466209b8-f7dc-488c-937d-6e6c13a267bc'::uuid AND upper(trim(serial_no)) = '9S2340A01755');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd6c0dbcc-926a-45ee-a03c-68c5be7f91e1'::uuid, '664bad2f-44c4-46e1-8412-ef7d9fe3250f'::uuid, 'SRV240RBP-9A', '9S2423A01821', 0, 'Backfilled from ticket PHS1908261729321 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d6c0dbcc-926a-45ee-a03c-68c5be7f91e1'::uuid AND upper(trim(serial_no)) = '9S2423A01821');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b36d6980-5b55-4795-a874-c87f7e732855'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', '9S2446A02604', 0, 'Backfilled from ticket PHS1908261813324 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b36d6980-5b55-4795-a874-c87f7e732855'::uuid AND upper(trim(serial_no)) = '9S2446A02604');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ae3aa36e-e91b-4668-b310-37de8bab6e5b'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2340A01750', 0, 'Backfilled from ticket PHS2008261051325 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ae3aa36e-e91b-4668-b310-37de8bab6e5b'::uuid AND upper(trim(serial_no)) = '9S2340A01750');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '88d144dc-acbc-4e74-8d0f-76b792399bdc'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B22307001164', 0, 'Backfilled from ticket PHS2008261849331 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='88d144dc-acbc-4e74-8d0f-76b792399bdc'::uuid AND upper(trim(serial_no)) = 'B22307001164');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2502A02224', 0, 'Backfilled from ticket PHS2008261852332 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid AND upper(trim(serial_no)) = '9B2502A02224');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2502A02221', 0, 'Backfilled from ticket PHS2008261853333 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid AND upper(trim(serial_no)) = '9B2502A02221');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '50bb9ee7-76a1-460f-981b-8b34f3a4e177'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2526A04953', 0, 'Backfilled from ticket PHS2008261855334 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='50bb9ee7-76a1-460f-981b-8b34f3a4e177'::uuid AND upper(trim(serial_no)) = '9S2526A04953');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'dfae8b76-0743-45e6-a23f-1a595e38cbee'::uuid, '4457e907-5780-4a81-be5d-700523d27119'::uuid, 'BVX2200LI-IN', '9B2518A02244', 0, 'Backfilled from ticket PHS2008261900335 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='dfae8b76-0743-45e6-a23f-1a595e38cbee'::uuid AND upper(trim(serial_no)) = '9B2518A02244');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'bd37470c-c756-4672-8a92-41756dfac210'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2415G02133', 0, 'Backfilled from ticket PHS2108261300336 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='bd37470c-c756-4672-8a92-41756dfac210'::uuid AND upper(trim(serial_no)) = '0B2415G02133');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'd5833001-148d-4c03-950f-c7206aa24a96'::uuid, 'f3374293-78bb-4342-940f-8c6fb90a36f0'::uuid, 'SRV1KUXI-IN', '9S2326A02701', 0, 'Backfilled from ticket PHS2108261304337 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='d5833001-148d-4c03-950f-c7206aa24a96'::uuid AND upper(trim(serial_no)) = '9S2326A02701');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '0aabc78b-eb1c-42ac-b75e-169edca9d8ae'::uuid, 'c390f26e-f016-4687-9bfa-b532074b97d6'::uuid, 'SRC10KUXI-IN', 'B21814008348', 0, 'Backfilled from ticket PHS2408261113338 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='0aabc78b-eb1c-42ac-b75e-169edca9d8ae'::uuid AND upper(trim(serial_no)) = 'B21814008348');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a183b4bb-a37f-45e0-af33-5567fc468d22'::uuid, 'f3171941-f9fa-4d5e-b514-72d05e1eb975'::uuid, 'SRCE6KUXI-IN', 'B21906002153', 0, 'Backfilled from ticket PHS2408261128339 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a183b4bb-a37f-45e0-af33-5567fc468d22'::uuid AND upper(trim(serial_no)) = 'B21906002153');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2502A02193', 0, 'Backfilled from ticket PHS2408261749340 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid AND upper(trim(serial_no)) = '9B2502A02193');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2443A04704', 0, 'Backfilled from ticket PHS2408261808341 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid AND upper(trim(serial_no)) = '9B2443A04704');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2537A12933', 0, 'Backfilled from ticket PHS2408261813342 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7ddf0e34-0aab-4283-adf3-2b13b5062047'::uuid AND upper(trim(serial_no)) = '9B2537A12933');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '48b28262-8cfe-42c4-bbc4-ad535401d74f'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242503501887', 0, 'Backfilled from ticket PHS2408261816343 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='48b28262-8cfe-42c4-bbc4-ad535401d74f'::uuid AND upper(trim(serial_no)) = '242503501887');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'b7d965ff-48e0-45d3-8016-5143f29e0c8e'::uuid, 'ef80e667-ee66-4c41-a16e-3dcd2a4387b5'::uuid, 'SRV6KRIL-IN', 'S9S2546A05514', 0, 'Backfilled from ticket PHS2508261247339 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='b7d965ff-48e0-45d3-8016-5143f29e0c8e'::uuid AND upper(trim(serial_no)) = 'S9S2546A05514');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6ee23b42-96a4-4873-a9d9-69492c6744fd'::uuid, '0888d497-631c-4e03-9336-531bccb6aa04'::uuid, 'SRVPM10KRIL-IN', '9S2451A03575', 0, 'Backfilled from ticket PHS2508261255340 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6ee23b42-96a4-4873-a9d9-69492c6744fd'::uuid AND upper(trim(serial_no)) = '9S2451A03575');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a5799dfa-421f-44a2-a073-d34c29a8e33b'::uuid, '846e1b76-fbc7-42fe-a4da-e00b1b9ebe12'::uuid, 'LD6000TXL', '83622211100476', 0, 'Backfilled from ticket PHS2508261259341 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a5799dfa-421f-44a2-a073-d34c29a8e33b'::uuid AND upper(trim(serial_no)) = '83622211100476');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'caa5d3aa-79ee-48c2-845c-67f173dcc91a'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', 'B22202002922', 0, 'Backfilled from ticket PHS2608261239346 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='caa5d3aa-79ee-48c2-845c-67f173dcc91a'::uuid AND upper(trim(serial_no)) = 'B22202002922');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7bb310d2-1a51-4634-b802-8c66cfd7e044'::uuid, '3bd7a732-55e4-47a5-8e0d-492aa27691ee'::uuid, 'SRVPM3KRIL-IN', '9S2533A02169', 0, 'Backfilled from ticket PHS2608261242347 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7bb310d2-1a51-4634-b802-8c66cfd7e044'::uuid AND upper(trim(serial_no)) = '9S2533A02169');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '33ae8953-f81d-44cb-9709-6e9710cb7e95'::uuid, '0888d497-631c-4e03-9336-531bccb6aa04'::uuid, 'SRVPM10KRIL-IN', '9S2227A00327', 0, 'Backfilled from ticket PHS2608261248349 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='33ae8953-f81d-44cb-9709-6e9710cb7e95'::uuid AND upper(trim(serial_no)) = '9S2227A00327');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5a66ec24-ddbd-48d2-bff5-e049bc5f8b82'::uuid, 'a1f7b56a-80b9-4772-a03d-75ffe3ff30cb'::uuid, 'SRV6KL-IN', 'ZS2550026077', 0, 'Backfilled from ticket PHS2608261251350 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5a66ec24-ddbd-48d2-bff5-e049bc5f8b82'::uuid AND upper(trim(serial_no)) = 'ZS2550026077');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '87522c44-f196-40a7-ac15-e7750bd5b109'::uuid, '9d7995ea-7a81-49b5-805d-5d0758b8d8b4'::uuid, 'SRV10KUXI-IN', '9S2537A03761', 0, 'Backfilled from ticket PHS2608261255352 (' || 'New' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='87522c44-f196-40a7-ac15-e7750bd5b109'::uuid AND upper(trim(serial_no)) = '9S2537A03761');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '68986e30-486f-4055-ad33-8f55db0e635d'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', 'S9S2403A05181', 0, 'Backfilled from ticket PHS2608261826353 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='68986e30-486f-4055-ad33-8f55db0e635d'::uuid AND upper(trim(serial_no)) = 'S9S2403A05181');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'dfb44e18-8a77-4575-8a7c-7f8053e140ba'::uuid, '9d22d9d9-603d-4964-a40c-7a9c9d5c8b61'::uuid, 'SRV6KUXI-IN', '9S2439A00228', 0, 'Backfilled from ticket PHS2708261138357 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='dfb44e18-8a77-4575-8a7c-7f8053e140ba'::uuid AND upper(trim(serial_no)) = '9S2439A00228');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '313937d0-f380-4053-8899-00100dbda0c5'::uuid, 'b8c0c414-00fd-4be3-8c0a-7988436cabd8'::uuid, 'BX1100C-IN', 'ZB2625010617', 0, 'Backfilled from ticket PHS2708261341360 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='313937d0-f380-4053-8899-00100dbda0c5'::uuid AND upper(trim(serial_no)) = 'ZB2625010617');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '0bf01a30-c541-4949-856e-7b742dfab389'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2308A06310', 0, 'Backfilled from ticket PHS2708261349361 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='0bf01a30-c541-4949-856e-7b742dfab389'::uuid AND upper(trim(serial_no)) = '9S2308A06310');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '110ea896-ebf3-4381-b3bd-de11b13143ad'::uuid, 'd362fbef-0ed7-42fa-95c9-6c595817de2a'::uuid, 'SRC3KUXI', 'B21415000200', 0, 'Backfilled from ticket PHS3108261316369 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='110ea896-ebf3-4381-b3bd-de11b13143ad'::uuid AND upper(trim(serial_no)) = 'B21415000200');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '08d6f0a2-adc0-43af-a4dd-185764879574'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2537A27621', 0, 'Backfilled from ticket PHS0109261305371 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='08d6f0a2-adc0-43af-a4dd-185764879574'::uuid AND upper(trim(serial_no)) = '9B2537A27621');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '4e0df38e-2a24-49f1-ad2a-d0fb2ae5102a'::uuid, '19ea85ec-c3b1-4be3-87a9-cd6b840b7ae3'::uuid, 'SRV15KUXI-IN', '9S2345A02646', 0, 'Backfilled from ticket PHS0109261309372 (' || 'Parts Received' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='4e0df38e-2a24-49f1-ad2a-d0fb2ae5102a'::uuid AND upper(trim(serial_no)) = '9S2345A02646');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '0e69571f-382d-4b8e-9915-26e71b2aa320'::uuid, 'f3374293-78bb-4342-940f-8c6fb90a36f0'::uuid, 'SRV1KUXI-IN', '9S2326A02702', 0, 'Backfilled from ticket PHS0109261312373 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='0e69571f-382d-4b8e-9915-26e71b2aa320'::uuid AND upper(trim(serial_no)) = '9S2326A02702');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '2ac98911-e47c-46b8-b349-8501b0d1f954'::uuid, '19ea85ec-c3b1-4be3-87a9-cd6b840b7ae3'::uuid, 'SRV15KUXI-IN', '9S2607A02015', 0, 'Backfilled from ticket PHS0109261320374 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='2ac98911-e47c-46b8-b349-8501b0d1f954'::uuid AND upper(trim(serial_no)) = '9S2607A02015');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8a68e065-3efc-43d1-bc89-f2d2a9446a78'::uuid, 'deb7216a-43e0-4064-be5a-765adad0fa48'::uuid, 'LD6000', '83621811101191', 0, 'Backfilled from ticket PHS0109261334375 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8a68e065-3efc-43d1-bc89-f2d2a9446a78'::uuid AND upper(trim(serial_no)) = '83621811101191');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '8bf03f16-1406-41a0-9180-dcc1f245c0dc'::uuid, '4457e907-5780-4a81-be5d-700523d27119'::uuid, 'BVX2200LI-IN', '9B2518A02198', 0, 'Backfilled from ticket PHS0109261337376 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='8bf03f16-1406-41a0-9180-dcc1f245c0dc'::uuid AND upper(trim(serial_no)) = '9B2518A02198');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6a5a327a-c76a-4e77-9f29-eb92a8e0e866'::uuid, 'dcd40ea4-db41-4fd5-a334-c2d28c48f2df'::uuid, 'SRV5KRIL-IN', '9S2020A52974', 0, 'Backfilled from ticket PHS0109261338377 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6a5a327a-c76a-4e77-9f29-eb92a8e0e866'::uuid AND upper(trim(serial_no)) = '9S2020A52974');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '5befc8da-72a6-46a2-b883-74339a16f087'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S2426A00292', 0, 'Backfilled from ticket PHS0109261340378 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='5befc8da-72a6-46a2-b883-74339a16f087'::uuid AND upper(trim(serial_no)) = '9S2426A00292');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'ca001d2e-4c6e-4617-b4c9-4d2a0134e282'::uuid, '29f1e2d6-c64a-45bf-a533-ce0e0f6f13f9'::uuid, 'LD6000-PRO', '83622310501047', 0, 'Backfilled from ticket PHS0109261342379 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='ca001d2e-4c6e-4617-b4c9-4d2a0134e282'::uuid AND upper(trim(serial_no)) = '83622310501047');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '9ccccdde-c66d-4dcc-91d9-baf3fb8a2c0f'::uuid, '846e1b76-fbc7-42fe-a4da-e00b1b9ebe12'::uuid, 'LD6000TXL', '83622302101487', 0, 'Backfilled from ticket PHS0109261344380 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='9ccccdde-c66d-4dcc-91d9-baf3fb8a2c0f'::uuid AND upper(trim(serial_no)) = '83622302101487');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '35dd4aaa-f850-4e42-a04c-101350e74a8e'::uuid, '0888d497-631c-4e03-9336-531bccb6aa04'::uuid, 'SRVPM10KRIL-IN', '9S2447A02633', 0, 'Backfilled from ticket PHS0109261531381 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='35dd4aaa-f850-4e42-a04c-101350e74a8e'::uuid AND upper(trim(serial_no)) = '9S2447A02633');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '40ccaab1-d116-46ac-96ba-a2d4958f2a13'::uuid, '52f37ec4-ee1e-4236-bd2f-6a6d2f1989f9'::uuid, 'LB600PRO', '242402507607', 0, 'Backfilled from ticket PHS0209261508384 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='40ccaab1-d116-46ac-96ba-a2d4958f2a13'::uuid AND upper(trim(serial_no)) = '242402507607');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '6db59427-7fca-40f0-b6f7-3e5b677608eb'::uuid, 'a3736c1f-4c4f-46f8-83c6-9fcc1fd83976'::uuid, 'SRV20KUXI-IN', '9S2433A02624', 0, 'Backfilled from ticket PHS0209261659385 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='6db59427-7fca-40f0-b6f7-3e5b677608eb'::uuid AND upper(trim(serial_no)) = '9S2433A02624');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a6f004ee-9f55-4dff-ab1e-7695c3c66f35'::uuid, '59e5d06e-34b7-4285-96c6-206c9c40d65f'::uuid, 'SURTD5000XLI-CC', 'BQ1648901422', 0, 'Backfilled from ticket PHS0209261709387 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a6f004ee-9f55-4dff-ab1e-7695c3c66f35'::uuid AND upper(trim(serial_no)) = 'BQ1648901422');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '03398b59-36b7-4d4c-9c9f-701e8a9a8f4a'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58041', 0, 'Backfilled from ticket PHS0309261055390 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='03398b59-36b7-4d4c-9c9f-701e8a9a8f4a'::uuid AND upper(trim(serial_no)) = '9S1835A58041');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '03398b59-36b7-4d4c-9c9f-701e8a9a8f4a'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58068', 0, 'Backfilled from ticket PHS0309261057391 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='03398b59-36b7-4d4c-9c9f-701e8a9a8f4a'::uuid AND upper(trim(serial_no)) = '9S1835A58068');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '03398b59-36b7-4d4c-9c9f-701e8a9a8f4a'::uuid, 'aed724b3-e28c-4215-ab07-9e94c043ab37'::uuid, 'SRC1KI-IN', '9S1835A58060', 0, 'Backfilled from ticket PHS0309261100392 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='03398b59-36b7-4d4c-9c9f-701e8a9a8f4a'::uuid AND upper(trim(serial_no)) = '9S1835A58060');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '77124c4e-a3fa-4909-865d-61e6fb225aa5'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2516A20850', 0, 'Backfilled from ticket PHS0309261329393 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='77124c4e-a3fa-4909-865d-61e6fb225aa5'::uuid AND upper(trim(serial_no)) = '9B2516A20850');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT 'a80e3b12-1307-4765-8c03-96c8f1a3f458'::uuid, 'b485663a-0e6b-498b-90fd-1aa365a2db13'::uuid, 'BX600I-IN', '9B2518A10233', 0, 'Backfilled from ticket PHS0409261036395 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='a80e3b12-1307-4765-8c03-96c8f1a3f458'::uuid AND upper(trim(serial_no)) = '9B2518A10233');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '7e7325d2-1bc2-4295-a0ae-a584b3731f60'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', '0B2449G11133', 0, 'Backfilled from ticket PHS0409261721396 (' || 'New' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='7e7325d2-1bc2-4295-a0ae-a584b3731f60'::uuid AND upper(trim(serial_no)) = '0B2449G11133');
INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)
SELECT '89500ddd-cc66-42f2-b872-1f712dcb8ff0'::uuid, 'af9414ea-9349-44e3-a622-6d0ff1342a97'::uuid, 'BX600C-IN', 'B22033008308', 0, 'Backfilled from ticket PHS0409261724397 (' || 'Closed' || ')'
WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='89500ddd-cc66-42f2-b872-1f712dcb8ff0'::uuid AND upper(trim(serial_no)) = 'B22033008308');

-- Optional: back-link tickets.equipment_id to the newly created installed_equipment (only where ticket.equipment_id IS NULL)
-- Uncomment to enable traceability:
-- UPDATE public.tickets t SET equipment_id = ie.id
-- FROM public.installed_equipment ie
-- WHERE t.equipment_id IS NULL
--   AND t.is_deleted = false
--   AND t.status IN ('Closed','New','In Progress','Under Observation','Parts Received')
--   AND t.customer_id IS NOT NULL
--   AND ie.customer_id = t.customer_id
--   AND upper(trim(ie.serial_no)) = upper(trim(t.serial_no))
--   AND upper(trim(t.serial_no)) NOT IN ('NA','-','NULL','NIL','#N/A','N/A','NONE','FALSE')
--   AND length(trim(t.serial_no))>=3;

COMMIT;

-- Verification queries (run after COMMIT):
-- 1. Count total equipment
-- SELECT count(*) FROM public.installed_equipment;
-- 2. Count backfilled rows
-- SELECT count(*) FROM public.installed_equipment WHERE remarks LIKE 'Backfilled from ticket%';
-- 3. Show backfilled rows with customer name
-- SELECT ie.id, c.company, ie.model_no, ie.serial_no, ie.warranty_months, ie.remarks, ie.created_at
-- FROM public.installed_equipment ie JOIN public.customers c ON c.id=ie.customer_id
-- WHERE ie.remarks LIKE 'Backfilled from ticket%' ORDER BY ie.created_at DESC;
-- 4. Confirm no duplicates by (customer, serial)
-- SELECT customer_id, upper(trim(serial_no)), count(*) FROM public.installed_equipment WHERE serial_no IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;
