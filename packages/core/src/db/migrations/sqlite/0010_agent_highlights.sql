CREATE TABLE `agent_days` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`active_minutes` integer DEFAULT 0 NOT NULL,
	`agent_minutes` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_tokens` integer DEFAULT 0 NOT NULL,
	`tools` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`)
);
--> statement-breakpoint
CREATE TABLE `agent_highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`repo` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_highlights_user_day_idx` ON `agent_highlights` (`user_id`,`day`);--> statement-breakpoint
CREATE TABLE `agent_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`tool` text NOT NULL,
	`repo` text,
	`branch` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`day` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_tokens` integer DEFAULT 0 NOT NULL,
	`files_changed` integer DEFAULT 0 NOT NULL,
	`commits` text DEFAULT '[]' NOT NULL,
	`digested_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_signals_session_idx` ON `agent_signals` (`user_id`,`tool`,`session_id`);--> statement-breakpoint
CREATE INDEX `agent_signals_user_day_idx` ON `agent_signals` (`user_id`,`day`);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `scope` text DEFAULT 'app' NOT NULL;