-- CAT-4: typo-tolerant search with Postgres trigrams (Railway Postgres ships pg_trgm).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_material_trgm_idx" ON "products" USING gin ("material" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_name_trgm_idx" ON "collections" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
-- Hot path for availability: active holds per variant.
CREATE INDEX IF NOT EXISTS "stock_holds_active_idx" ON "stock_holds" ("variant_id") WHERE "released_at" IS NULL AND "consumed_at" IS NULL;
