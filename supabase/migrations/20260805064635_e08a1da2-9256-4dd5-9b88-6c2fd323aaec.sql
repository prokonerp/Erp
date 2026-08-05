ALTER TABLE public.defective_tags ALTER COLUMN txn_id DROP NOT NULL;
ALTER TABLE public.defective_tags ADD COLUMN IF NOT EXISTS stock_item_id uuid REFERENCES public.ims_stock_items(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS defective_tags_stock_item_id_key ON public.defective_tags (stock_item_id);