ALTER TYPE "public"."zone_code" ADD VALUE 'INTL_AFRICA';--> statement-breakpoint
ALTER TYPE "public"."zone_code" ADD VALUE 'INTL_EUROPE';--> statement-breakpoint
ALTER TYPE "public"."zone_code" ADD VALUE 'INTL_AMERICAS';--> statement-breakpoint
ALTER TYPE "public"."zone_code" ADD VALUE 'INTL_WORLD';--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "country" text DEFAULT 'NG' NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "postcode" text DEFAULT '' NOT NULL;