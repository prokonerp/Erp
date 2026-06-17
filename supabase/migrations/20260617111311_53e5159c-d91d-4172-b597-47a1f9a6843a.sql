
-- ============= ENUMS =============
DO $$ BEGIN
  CREATE TYPE public.ims_stock_type AS ENUM ('good','defective');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_stock_status AS ENUM ('available','reserved','issued','in_transit','returned_to_oem','scrapped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_txn_type AS ENUM (
    'good_in','good_out','defective_in','defective_out',
    'transfer_out','transfer_in','oem_return','oem_replacement_receipt',
    'stock_adjustment','scrap_adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_transfer_status AS ENUM ('draft','submitted','approved','rejected','in_transit','received','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_reservation_status AS ENUM ('reserved','issued','released');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============= SEQUENCES =============
CREATE TABLE IF NOT EXISTS public.ims_txn_sequence (id INT PRIMARY KEY, last_seq BIGINT NOT NULL DEFAULT 0);
INSERT INTO public.ims_txn_sequence(id,last_seq) VALUES (1,0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ims_transfer_sequence (id INT PRIMARY KEY, last_seq BIGINT NOT NULL DEFAULT 0);
INSERT INTO public.ims_transfer_sequence(id,last_seq) VALUES (1,0) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_ims_txn_seq() RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n BIGINT;
BEGIN
  UPDATE public.ims_txn_sequence SET last_seq = last_seq + 1 WHERE id=1 RETURNING last_seq INTO n;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.next_ims_transfer_seq() RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n BIGINT;
BEGIN
  UPDATE public.ims_transfer_sequence SET last_seq = last_seq + 1 WHERE id=1 RETURNING last_seq INTO n;
  RETURN n;
END $$;

-- ============= STOCK ITEMS =============
CREATE TABLE public.ims_stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oem TEXT,
  category TEXT,
  part_name TEXT NOT NULL,
  part_model_no TEXT,
  part_serial_no TEXT UNIQUE,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_type TEXT,
  stock_type public.ims_stock_type NOT NULL DEFAULT 'good',
  stock_status public.ims_stock_status NOT NULL DEFAULT 'available',
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  indent_id UUID REFERENCES public.indents(id) ON DELETE SET NULL,
  oem_case_id TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  transaction_ref TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  modified_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_stock_warehouse ON public.ims_stock_items(warehouse_id);
CREATE INDEX idx_ims_stock_oem ON public.ims_stock_items(oem);
CREATE INDEX idx_ims_stock_status ON public.ims_stock_items(stock_status);
CREATE INDEX idx_ims_stock_type ON public.ims_stock_items(stock_type);
CREATE INDEX idx_ims_stock_ticket ON public.ims_stock_items(ticket_id);
CREATE INDEX idx_ims_stock_indent ON public.ims_stock_items(indent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_stock_items TO authenticated;
GRANT ALL ON public.ims_stock_items TO service_role;
ALTER TABLE public.ims_stock_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_stock_read" ON public.ims_stock_items FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_stock_insert" ON public.ims_stock_items FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_stock_update" ON public.ims_stock_items FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_stock_delete" ON public.ims_stock_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Auto-populate warehouse_type from warehouses
CREATE OR REPLACE FUNCTION public.ims_set_warehouse_type() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.warehouse_id IS NOT NULL THEN
    SELECT type INTO NEW.warehouse_type FROM public.warehouses WHERE id = NEW.warehouse_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_stock_warehouse_type
  BEFORE INSERT OR UPDATE OF warehouse_id ON public.ims_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.ims_set_warehouse_type();

CREATE TRIGGER trg_ims_stock_updated_at BEFORE UPDATE ON public.ims_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============= TRANSACTIONS =============
CREATE TABLE public.ims_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_no TEXT UNIQUE,
  txn_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  txn_type public.ims_txn_type NOT NULL,
  stock_item_id UUID REFERENCES public.ims_stock_items(id) ON DELETE SET NULL,
  part_name TEXT,
  part_model_no TEXT,
  part_serial_no TEXT,
  oem TEXT,
  from_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  to_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  from_party TEXT,
  to_party TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  indent_id UUID REFERENCES public.indents(id) ON DELETE SET NULL,
  transfer_id UUID,
  reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_txn_type ON public.ims_transactions(txn_type);
CREATE INDEX idx_ims_txn_date ON public.ims_transactions(txn_date);
CREATE INDEX idx_ims_txn_stock ON public.ims_transactions(stock_item_id);
CREATE INDEX idx_ims_txn_ticket ON public.ims_transactions(ticket_id);
CREATE INDEX idx_ims_txn_indent ON public.ims_transactions(indent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_transactions TO authenticated;
GRANT ALL ON public.ims_transactions TO service_role;
ALTER TABLE public.ims_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_txn_read" ON public.ims_transactions FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_txn_insert" ON public.ims_transactions FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_txn_update" ON public.ims_transactions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_txn_delete" ON public.ims_transactions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.set_ims_txn_no() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ts TEXT; seq BIGINT;
BEGIN
  IF NEW.txn_no IS NULL OR NEW.txn_no = '' THEN
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata','DDMMYYHH24MI');
    seq := public.next_ims_txn_seq();
    NEW.txn_no := 'PHS/IMS/' || ts || lpad(seq::text,4,'0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_set_txn_no BEFORE INSERT ON public.ims_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_ims_txn_no();

-- ============= TRANSFERS =============
CREATE TABLE public.ims_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no TEXT UNIQUE,
  request_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  destination_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  oem TEXT,
  part_name TEXT,
  part_model_no TEXT,
  part_serial_no TEXT,
  stock_item_id UUID REFERENCES public.ims_stock_items(id) ON DELETE SET NULL,
  stock_type public.ims_stock_type NOT NULL DEFAULT 'good',
  qty INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  remarks TEXT,
  status public.ims_transfer_status NOT NULL DEFAULT 'draft',
  requested_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  received_by UUID REFERENCES auth.users(id),
  received_at TIMESTAMPTZ,
  receipt_remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_transfers_status ON public.ims_transfers(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_transfers TO authenticated;
GRANT ALL ON public.ims_transfers TO service_role;
ALTER TABLE public.ims_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_xfer_read" ON public.ims_transfers FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_xfer_insert" ON public.ims_transfers FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_xfer_update" ON public.ims_transfers FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_xfer_delete" ON public.ims_transfers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.set_ims_transfer_no() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ts TEXT; seq BIGINT;
BEGIN
  IF NEW.transfer_no IS NULL OR NEW.transfer_no = '' THEN
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata','DDMMYYHH24MI');
    seq := public.next_ims_transfer_seq();
    NEW.transfer_no := 'PHS/IMT/' || ts || lpad(seq::text,4,'0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_set_transfer_no BEFORE INSERT ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_ims_transfer_no();

CREATE TRIGGER trg_ims_transfers_updated_at BEFORE UPDATE ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-react to status changes: in_transit / completed update linked stock_item
CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.stock_item_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_transit' THEN
      UPDATE public.ims_stock_items SET stock_status='in_transit', updated_at=now() WHERE id=NEW.stock_item_id;
    ELSIF NEW.status = 'completed' THEN
      UPDATE public.ims_stock_items
        SET warehouse_id = NEW.destination_warehouse_id,
            stock_status = 'available',
            updated_at = now()
        WHERE id = NEW.stock_item_id;
      -- Log paired transactions
      INSERT INTO public.ims_transactions(txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by)
      VALUES
        ('transfer_out', NEW.stock_item_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no, 'Transfer out', NEW.requested_by),
        ('transfer_in',  NEW.stock_item_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no, 'Transfer in', NEW.received_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_transfer_status_effects
  AFTER UPDATE OF status ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.ims_transfer_status_effects();

-- ============= RESERVATIONS =============
CREATE TABLE public.ims_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES public.ims_stock_items(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  indent_id UUID REFERENCES public.indents(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  status public.ims_reservation_status NOT NULL DEFAULT 'reserved',
  reserved_by UUID REFERENCES auth.users(id),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_resv_stock ON public.ims_reservations(stock_item_id);
CREATE INDEX idx_ims_resv_status ON public.ims_reservations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_reservations TO authenticated;
GRANT ALL ON public.ims_reservations TO service_role;
ALTER TABLE public.ims_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_resv_read" ON public.ims_reservations FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_resv_insert" ON public.ims_reservations FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_resv_update" ON public.ims_reservations FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_resv_delete" ON public.ims_reservations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_ims_resv_updated_at BEFORE UPDATE ON public.ims_reservations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Keep stock status synced with reservation status
CREATE OR REPLACE FUNCTION public.ims_resv_sync_stock() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ims_stock_items SET stock_status='reserved', updated_at=now()
      WHERE id = NEW.stock_item_id AND stock_status='available';
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'issued' THEN
      UPDATE public.ims_stock_items SET stock_status='issued', updated_at=now() WHERE id=NEW.stock_item_id;
    ELSIF NEW.status = 'released' THEN
      UPDATE public.ims_stock_items SET stock_status='available', updated_at=now() WHERE id=NEW.stock_item_id;
    ELSIF NEW.status = 'reserved' THEN
      UPDATE public.ims_stock_items SET stock_status='reserved', updated_at=now() WHERE id=NEW.stock_item_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_resv_sync_stock
  AFTER INSERT OR UPDATE ON public.ims_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ims_resv_sync_stock();

-- ============= AUDIT LOG =============
CREATE TABLE public.ims_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_audit_entity ON public.ims_audit_log(entity, entity_id);
CREATE INDEX idx_ims_audit_created ON public.ims_audit_log(created_at);

GRANT SELECT, INSERT ON public.ims_audit_log TO authenticated;
GRANT ALL ON public.ims_audit_log TO service_role;
ALTER TABLE public.ims_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ims_audit_read" ON public.ims_audit_log FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_audit_insert" ON public.ims_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- Generic audit trigger
CREATE OR REPLACE FUNCTION public.ims_write_audit() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ent TEXT;
BEGIN
  ent := CASE TG_TABLE_NAME
    WHEN 'ims_stock_items' THEN 'stock_item'
    WHEN 'ims_transactions' THEN 'transaction'
    WHEN 'ims_transfers' THEN 'transfer'
    WHEN 'ims_reservations' THEN 'reservation'
    ELSE TG_TABLE_NAME END;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.ims_audit_log(entity, entity_id, action, new_value, user_id)
      VALUES (ent, NEW.id, 'create', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.ims_audit_log(entity, entity_id, action, old_value, new_value, user_id)
      VALUES (ent, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.ims_audit_log(entity, entity_id, action, old_value, user_id)
      VALUES (ent, OLD.id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_ims_stock AFTER INSERT OR UPDATE OR DELETE ON public.ims_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();
CREATE TRIGGER trg_audit_ims_txn AFTER INSERT OR UPDATE OR DELETE ON public.ims_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();
CREATE TRIGGER trg_audit_ims_xfer AFTER INSERT OR UPDATE OR DELETE ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();
CREATE TRIGGER trg_audit_ims_resv AFTER INSERT OR UPDATE OR DELETE ON public.ims_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();

-- ============= APP MODULE =============
INSERT INTO public.app_modules(key, label, sort_order, supports_import, is_active)
VALUES ('ims','IMS',45,false,true)
ON CONFLICT (key) DO NOTHING;
