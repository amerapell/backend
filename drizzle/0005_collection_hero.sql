ALTER TABLE "collections" ADD COLUMN "hero_image_url" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "home_order" integer;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "tagline" text;--> statement-breakpoint
-- Backfill the home hero order for the starter collections on existing databases (design v3 §8).
UPDATE "collections" SET "home_order" = CASE "slug" WHEN 'women' THEN 1 WHEN 'men' THEN 2 WHEN 'bags-accessories' THEN 3 WHEN 'shoes' THEN 4 END WHERE "home_order" IS NULL AND "slug" IN ('women', 'men', 'bags-accessories', 'shoes');--> statement-breakpoint
UPDATE "collections" SET "home_order" = 0 WHERE "home_order" IS NULL AND "is_drop" = true;
