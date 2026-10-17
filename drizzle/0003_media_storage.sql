CREATE TABLE "media_files" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_kind" text NOT NULL,
	"original_filename" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_variants" (
	"media_id" text NOT NULL,
	"width" integer NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_id_media_files_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_files_owner_kind_idx" ON "media_files" USING btree ("owner_kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_variants_media_width_uq" ON "media_variants" USING btree ("media_id","width");