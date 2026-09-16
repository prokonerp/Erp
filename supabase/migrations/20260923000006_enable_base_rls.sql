-- Migration: 20260923000006_enable_base_rls.sql
-- Remediation M2 — enable RLS on base tables that carry policies but no versioned ENABLE.
--
-- CONTEXT (why): a Postgres policy is unenforced unless Row Level Security is
--   enabled on its table (relrowsecurity flag). The tables below all gained
--   CREATE POLICY statements across versioned migrations, but no versioned
--   migration ever ran ENABLE ROW LEVEL SECURITY on them — so on a fresh
--   `supabase db reset` their policies exist yet enforce nothing (wide open).
--   Live is NOT exposed: supabase/setup_new_supabase.sql (the snapshot live was
--   built from) already enables RLS on these tables — e.g. line 591 (tickets),
--   line 615 (ticket_activities), line 816 (employees) — so on live every block
--   below sees relrowsecurity = true and is a strict no-op.
--
-- SAFE: one guarded DO block per table. Each block fires only when the table
--   exists AND relrowsecurity is currently false; otherwise it does nothing.
--   Idempotent and re-runnable. Zero behavior change on live; closes the
--   fresh-reset exposure for new environments.
-- Safety assertion: this file touches ONLY the relrowsecurity flag via
--   ENABLE ROW LEVEL SECURITY. Zero DELETE / TRUNCATE / DROP / GRANT / POLICY
--   changes — no policy is created, altered, or dropped here.

-- ── public.tickets ──────────────────────────────────────────────────────
-- Policies: 20260829000002, 20260905000001, 20260922000004, 20260923000003.
DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tickets'::regclass) THEN ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.ticket_activities ────────────────────────────────────────────
-- Policies: 20260915000001 (+ snapshot seed).
DO $$ BEGIN
  IF to_regclass('public.ticket_activities') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ticket_activities'::regclass) THEN ALTER TABLE public.ticket_activities ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.employees ────────────────────────────────────────────────────
-- Policies: 20260915000005 (+ snapshot seed).
DO $$ BEGIN
  IF to_regclass('public.employees') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.employees'::regclass) THEN ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.customers ────────────────────────────────────────────────────
-- Policies: 20260829000002, 20260830000000, 20260911000002.
DO $$ BEGIN
  IF to_regclass('public.customers') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customers'::regclass) THEN ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.sales_orders ─────────────────────────────────────────────────
-- Policies: 20260909000001.
DO $$ BEGIN
  IF to_regclass('public.sales_orders') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_orders'::regclass) THEN ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.sales_order_settings ─────────────────────────────────────────
-- Policies: 20260909000001.
DO $$ BEGIN
  IF to_regclass('public.sales_order_settings') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales_order_settings'::regclass) THEN ALTER TABLE public.sales_order_settings ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.leads ────────────────────────────────────────────────────────
-- Policies: 20260905000003.
DO $$ BEGIN
  IF to_regclass('public.leads') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.leads'::regclass) THEN ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.lead_activities ──────────────────────────────────────────────
-- Policies: 20260905000003.
DO $$ BEGIN
  IF to_regclass('public.lead_activities') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lead_activities'::regclass) THEN ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.products ─────────────────────────────────────────────────────
-- Policies: 20260829000002.
DO $$ BEGIN
  IF to_regclass('public.products') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.products'::regclass) THEN ALTER TABLE public.products ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.indents ──────────────────────────────────────────────────────
-- Policies: 20260829000002.
DO $$ BEGIN
  IF to_regclass('public.indents') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.indents'::regclass) THEN ALTER TABLE public.indents ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.gatepasses ───────────────────────────────────────────────────
-- Policies: 20260829000002.
DO $$ BEGIN
  IF to_regclass('public.gatepasses') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.gatepasses'::regclass) THEN ALTER TABLE public.gatepasses ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.user_roles ───────────────────────────────────────────────────
-- Policies: 20260829000002 ("claim first admin").
DO $$ BEGIN
  IF to_regclass('public.user_roles') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_roles'::regclass) THEN ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.ims_stock_items ──────────────────────────────────────────────
-- Policies: 20260830000001.
DO $$ BEGIN
  IF to_regclass('public.ims_stock_items') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ims_stock_items'::regclass) THEN ALTER TABLE public.ims_stock_items ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ── public.ims_transactions ─────────────────────────────────────────────
-- Policies: 20260830000001.
DO $$ BEGIN
  IF to_regclass('public.ims_transactions') IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ims_transactions'::regclass) THEN ALTER TABLE public.ims_transactions ENABLE ROW LEVEL SECURITY; END IF;
END $$;
