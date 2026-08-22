-- Masters performance: indexes on sort/filter columns used by masters pages + pickers.

-- Customers: list is ordered by company and filtered/searched on state (and company).
CREATE INDEX IF NOT EXISTS idx_customers_company ON public.customers (company);
CREATE INDEX IF NOT EXISTS idx_customers_state ON public.customers (state);

-- Products: list is ordered by name and filtered by category/brand.
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products (brand);

-- Vendors: list/picker ordered by name.
CREATE INDEX IF NOT EXISTS idx_vendors_name ON public.vendors (name);

-- Employees: list ordered by name, filtered on active.
CREATE INDEX IF NOT EXISTS idx_employees_name ON public.employees (name);
CREATE INDEX IF NOT EXISTS idx_employees_active ON public.employees (active);
