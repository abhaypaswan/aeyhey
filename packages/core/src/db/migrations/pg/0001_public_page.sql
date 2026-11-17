CREATE TABLE "public_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"title" text,
	"bio" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"indexable" boolean DEFAULT false NOT NULL,
	"show_footer" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "public_takeaway" text;--> statement-breakpoint
CREATE UNIQUE INDEX "public_profiles_handle_idx" ON "public_profiles" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "links_user_shared_idx" ON "links" USING btree ("user_id","shared_at");