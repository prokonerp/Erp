-- Bootstrap: enable extensions required by the Prokon ERP migrations.
-- (On the old project these were enabled via the Dashboard, not migrations,
--  so they must be created before the first migration that uses them,
--  e.g. gen_random_uuid() from pgcrypto.)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgjwt;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";