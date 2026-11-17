ALTER TABLE "agent_days" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;