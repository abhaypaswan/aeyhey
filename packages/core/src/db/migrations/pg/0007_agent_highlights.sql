CREATE TABLE "agent_days" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"active_minutes" integer DEFAULT 0 NOT NULL,
	"agent_minutes" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_tokens" integer DEFAULT 0 NOT NULL,
	"tools" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "agent_highlights" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"repo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"tool" text NOT NULL,
	"repo" text,
	"branch" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"day" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_tokens" integer DEFAULT 0 NOT NULL,
	"files_changed" integer DEFAULT 0 NOT NULL,
	"commits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"digested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "scope" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_highlights_user_day_idx" ON "agent_highlights" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_signals_session_idx" ON "agent_signals" USING btree ("user_id","tool","session_id");--> statement-breakpoint
CREATE INDEX "agent_signals_user_day_idx" ON "agent_signals" USING btree ("user_id","day");