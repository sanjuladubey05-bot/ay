-- LPS STORE - Blueprint Financial Engine & Catalog Enhancements
-- Adds package bonus badges, immutable order supplier cost snapshots, and PostgreSQL generated net_profit_inr.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS bonus_badge TEXT NOT NULL DEFAULT '';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_cost_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost_inr >= 0),
  ADD COLUMN IF NOT EXISTS total_cost_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_cost_inr >= 0);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS supplier_cost_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (supplier_cost_inr >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'net_profit_inr'
  ) THEN
    ALTER TABLE public.orders
      ADD COLUMN net_profit_inr NUMERIC(12, 2)
      GENERATED ALWAYS AS (total_inr - supplier_cost_inr) STORED;
  END IF;
END $$;

-- Backfill existing order_items and orders with current package supplier cost if cost is still 0
UPDATE public.order_items oi
SET unit_cost_inr = COALESCE(NULLIF(p.supplier_cost_inr, 0), p.cost_inr, 0),
    total_cost_inr = ROUND(COALESCE(NULLIF(p.supplier_cost_inr, 0), p.cost_inr, 0) * oi.quantity, 2)
FROM public.packages p
WHERE p.id = oi.package_id
  AND oi.unit_cost_inr = 0
  AND oi.total_cost_inr = 0;

UPDATE public.orders o
SET supplier_cost_inr = sub.sum_cost
FROM (
  SELECT order_id, COALESCE(SUM(total_cost_inr), 0) AS sum_cost
  FROM public.order_items
  GROUP BY order_id
) sub
WHERE sub.order_id = o.id
  AND o.supplier_cost_inr = 0
  AND sub.sum_cost > 0;
