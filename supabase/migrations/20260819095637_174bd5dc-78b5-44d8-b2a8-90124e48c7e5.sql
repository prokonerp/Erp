DROP VIEW IF EXISTS public.assignable_engineers;
DROP FUNCTION IF EXISTS public.get_assignable_engineers();

CREATE TABLE public.assignable_engineers (
    id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    department TEXT,
    role TEXT,
    active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.assignable_engineers (id, name, phone, department, role, active)
SELECT id, name, phone, department, role, active
FROM public.employees
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    department = EXCLUDED.department,
    role = EXCLUDED.role,
    active = EXCLUDED.active;

CREATE OR REPLACE FUNCTION public.sync_assignable_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.assignable_engineers (id, name, phone, department, role, active)
        VALUES (NEW.id, NEW.name, NEW.phone, NEW.department, NEW.role, COALESCE(NEW.active, true))
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, phone = EXCLUDED.phone, department = EXCLUDED.department,
            role = EXCLUDED.role, active = EXCLUDED.active;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE public.assignable_engineers
        SET name = NEW.name, phone = NEW.phone, department = NEW.department, role = NEW.role,
            active = COALESCE(NEW.active, true)
        WHERE id = NEW.id;
        IF NOT FOUND THEN
            INSERT INTO public.assignable_engineers (id, name, phone, department, role, active)
            VALUES (NEW.id, NEW.name, NEW.phone, NEW.department, NEW.role, COALESCE(NEW.active, true));
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.assignable_engineers WHERE id = OLD.id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_assignable_employee_insert
AFTER INSERT ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.sync_assignable_employee();

CREATE TRIGGER trg_sync_assignable_employee_update
AFTER UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.sync_assignable_employee();

CREATE TRIGGER trg_sync_assignable_employee_delete
AFTER DELETE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.sync_assignable_employee();

GRANT SELECT ON public.assignable_engineers TO authenticated;
GRANT ALL ON public.assignable_engineers TO service_role;

ALTER TABLE public.assignable_engineers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read assignable engineers"
ON public.assignable_engineers
FOR SELECT
TO authenticated
USING (true);

REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM public;
GRANT EXECUTE ON FUNCTION public.sync_assignable_employee() TO service_role;

COMMENT ON TABLE public.assignable_engineers IS 'Read-only mirror of safe employee fields (id, name, phone, department, role, active) for ticket assignment and other non-HR workflows. Kept in sync via triggers on employees.';