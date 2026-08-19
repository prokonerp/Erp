DO $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.employees (name, active, department, phone, role) 
    VALUES ('__TEST_TRIGGER_ASSIGNABLE__', true, 'Test', '0000000000', 'technician')
    RETURNING id INTO v_id;
    
    IF NOT EXISTS (SELECT 1 FROM public.assignable_engineers WHERE id = v_id) THEN
        RAISE EXCEPTION 'Trigger did not sync row to assignable_engineers';
    END IF;
    
    DELETE FROM public.employees WHERE id = v_id;
    
    IF EXISTS (SELECT 1 FROM public.assignable_engineers WHERE id = v_id) THEN
        RAISE EXCEPTION 'Trigger did not delete row from assignable_engineers';
    END IF;
END $$;