ALTER TABLE "agent_highlights" ADD COLUMN "hidden_from_page" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "building_visibility" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "show_agent_models" boolean DEFAULT false NOT NULL;