-- LPS STORE - Phase 2 Catalog Imagery & Dynamic Player Field Extensions
-- Additive backward-compatible columns on games, packages, and order_items.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS player_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS player_details JSONB NOT NULL DEFAULT '{}'::jsonb;
