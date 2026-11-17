ALTER TABLE "public_profiles" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "interests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "experience" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "public_profiles" ADD COLUMN "projects" jsonb DEFAULT '[]'::jsonb NOT NULL;