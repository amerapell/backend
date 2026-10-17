CREATE TABLE "stock_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_notifications" ADD CONSTRAINT "stock_notifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_notifications" ADD CONSTRAINT "stock_notifications_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_notifications_uq" ON "stock_notifications" USING btree ("email","variant_id");--> statement-breakpoint
CREATE INDEX "stock_notifications_variant_idx" ON "stock_notifications" USING btree ("variant_id");