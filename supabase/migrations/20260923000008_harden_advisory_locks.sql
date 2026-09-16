-- 20260923000008_harden_advisory_locks.sql
--
-- CONTEXT: M5 — the three advisory-lock RPCs (created in
-- 20260911000003_advisory_lock_rpc.sql) are SECURITY DEFINER with EXECUTE
-- granted to authenticated, but accept ARBITRARY text keys. Any authenticated
-- user could therefore lock/unlock ARBITRARY keys — including the
-- SO-fulfillment keys ('so_fulfill:' || soId) used by withSoFulfillLock in
-- src/lib/documentFlow.writers.ts — breaking the numbering mutual exclusion
-- (e.g. holding a foreign key hostage, or unlocking a key another session
-- legitimately holds).
--
-- SAFE: Idempotent (CREATE OR REPLACE, identical signatures). No data
-- affected — functions only wrap pg_advisory_* built-ins. No GRANT changes
-- (grants intentionally untouched — the app calls with the user client).
--
-- Safety assertion: zero DELETE/TRUNCATE/DROP/GRANT statements in this file.
-- Worst case for a foreign-key caller is a catchable Postgres exception
-- ('advisory lock key outside app namespace'), which withSoFulfillLock
-- already handles: any lock RPC failure falls back to
-- optimistic + verification (verifyNoOverFulfillment), so the flow cannot break.

-- ── pg_advisory_lock(key text) — session-level lock, app namespace only ─────
CREATE OR REPLACE FUNCTION public.pg_advisory_lock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF key IS NULL OR key !~ '^so_fulfill:' THEN RAISE EXCEPTION 'advisory lock key outside app namespace'; END IF;
  PERFORM pg_advisory_lock(hashtextextended(key, 0));
END;
$$;

-- ── pg_advisory_unlock(key text) — release session lock, app namespace only ──
CREATE OR REPLACE FUNCTION public.pg_advisory_unlock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF key IS NULL OR key !~ '^so_fulfill:' THEN RAISE EXCEPTION 'advisory lock key outside app namespace'; END IF;
  PERFORM pg_advisory_unlock(hashtextextended(key, 0));
END;
$$;

-- ── pg_advisory_xact_lock(key text) — transaction-level lock, app namespace ──
CREATE OR REPLACE FUNCTION public.pg_advisory_xact_lock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF key IS NULL OR key !~ '^so_fulfill:' THEN RAISE EXCEPTION 'advisory lock key outside app namespace'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(key, 0));
END;
$$;
