ALTER TABLE "public_profiles" ADD COLUMN "previous_handle" text;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "handle_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "public_profiles_previous_handle_idx" ON "public_profiles" USING btree ("previous_handle");