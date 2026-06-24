-- Backfill place_of_supply from the GSTIN state code on existing customers
-- where place_of_supply is missing but gst is present.
WITH state_map AS (
  SELECT * FROM (VALUES
    ('01','Jammu and Kashmir'),('02','Himachal Pradesh'),('03','Punjab'),
    ('04','Chandigarh'),('05','Uttarakhand'),('06','Haryana'),('07','Delhi'),
    ('08','Rajasthan'),('09','Uttar Pradesh'),('10','Bihar'),('11','Sikkim'),
    ('12','Arunachal Pradesh'),('13','Nagaland'),('14','Manipur'),('15','Mizoram'),
    ('16','Tripura'),('17','Meghalaya'),('18','Assam'),('19','West Bengal'),
    ('20','Jharkhand'),('21','Odisha'),('22','Chhattisgarh'),('23','Madhya Pradesh'),
    ('24','Gujarat'),('25','Daman and Diu'),('26','Dadra and Nagar Haveli'),
    ('27','Maharashtra'),('28','Andhra Pradesh'),('29','Karnataka'),('30','Goa'),
    ('31','Lakshadweep'),('32','Kerala'),('33','Tamil Nadu'),('34','Puducherry'),
    ('35','Andaman and Nicobar Islands'),('36','Telangana'),('37','Andhra Pradesh'),
    ('38','Ladakh')
  ) AS t(code, state_name)
)
UPDATE public.customers c
   SET place_of_supply = sm.state_name
  FROM state_map sm
 WHERE (c.place_of_supply IS NULL OR btrim(c.place_of_supply) = '')
   AND c.gst IS NOT NULL
   AND length(c.gst) >= 2
   AND substr(c.gst, 1, 2) = sm.code;
