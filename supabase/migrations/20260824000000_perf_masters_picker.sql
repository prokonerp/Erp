-- 20260824000000_perf_masters_picker.sql
-- Production-grade indexes for masters search & pickers.
-- Customers: 3100+ rows, picker and table do ilike on company/phone/gst etc.
-- Use pg_trgm for fast case-insensitive pattern matching + btree for ordering.

create extension if not exists pg_trgm;

-- Customers: ordering & exact count
create index if not exists idx_customers_company_trgm on public.customers using gin (company gin_trgm_ops);
create index if not exists idx_customers_company_lower on public.customers (lower(company));
create index if not exists idx_customers_phone_trgm on public.customers using gin (phone gin_trgm_ops);
create index if not exists idx_customers_gst_trgm on public.customers using gin (gst gin_trgm_ops);
create index if not exists idx_customers_state_trgm on public.customers using gin (state gin_trgm_ops);
create index if not exists idx_customers_contact_name_trgm on public.customers using gin (contact_name gin_trgm_ops);
create index if not exists idx_customers_city_trgm on public.customers using gin (city gin_trgm_ops);

-- Products: picker search on name/model/brand/category
create index if not exists idx_products_name_trgm on public.products using gin (name gin_trgm_ops);
create index if not exists idx_products_model_trgm on public.products using gin (model gin_trgm_ops);
create index if not exists idx_products_brand_trgm on public.products using gin (brand gin_trgm_ops);
create index if not exists idx_products_category_trgm on public.products using gin (category gin_trgm_ops);
create index if not exists idx_products_active_name on public.products (active, name);

-- Vendors / Employees: small tables but add name indexes for consistency
create index if not exists idx_vendors_name_trgm on public.vendors using gin (name gin_trgm_ops);
create index if not exists idx_employees_name_trgm on public.employees using gin (name gin_trgm_ops);
