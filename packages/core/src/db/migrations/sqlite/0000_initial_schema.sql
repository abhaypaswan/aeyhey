CREATE TABLE `action_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`action` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `action_tokens_user_idx` ON `action_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `action_tokens_expiry_idx` ON `action_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text,
	`api_key_enc` text,
	`models` text DEFAULT '{}' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_providers_user_idx` ON `ai_providers` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_providers_user_kind_idx` ON `ai_providers` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`credential_source` text NOT NULL,
	`job_id` text,
	`ref_type` text,
	`ref_id` text,
	`ok` integer DEFAULT true NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_at_idx` ON `ai_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_user_task_idx` ON `ai_usage` (`user_id`,`task`);--> statement-breakpoint
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`fsrs_state` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	`skip_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_item_idx` ON `cards` (`item_type`,`item_id`);--> statement-breakpoint
CREATE INDEX `cards_user_status_due_idx` ON `cards` (`user_id`,`status`,`due`);--> statement-breakpoint
CREATE INDEX `cards_user_type_idx` ON `cards` (`user_id`,`item_type`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`source_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decks_user_idx` ON `decks` (`user_id`);--> statement-breakpoint
CREATE INDEX `decks_user_kind_idx` ON `decks` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `email_channels` (
	`user_id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`verified_at` integer,
	`verify_token_hash` text,
	`unsubscribe_token_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_channels_address_idx` ON `email_channels` (`address`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`user_answer` text NOT NULL,
	`score` integer NOT NULL,
	`verdict` text NOT NULL,
	`result` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grades_user_question_idx` ON `grades` (`user_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `item_tags` (
	`user_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`item_type`, `item_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `item_tags_tag_idx` ON `item_tags` (`user_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `item_tags_item_idx` ON `item_tags` (`item_type`,`item_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer NOT NULL,
	`locked_at` integer,
	`locked_by` text,
	`last_error` text,
	`progress_done` integer DEFAULT 0 NOT NULL,
	`progress_total` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_pickup_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_user_idx` ON `jobs` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`url_normalized` text NOT NULL,
	`title` text,
	`site_name` text,
	`author` text,
	`published_at` integer,
	`image_url` text,
	`content_type` text DEFAULT 'other' NOT NULL,
	`extracted_text` text,
	`extract_status` text DEFAULT 'pending' NOT NULL,
	`ai_status` text DEFAULT 'pending' NOT NULL,
	`summary_lines` text,
	`why_saved` text,
	`summary_confidence` text,
	`read_minutes` integer,
	`language` text,
	`user_note` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`snooze_count` integer DEFAULT 0 NOT NULL,
	`ignored_count` integer DEFAULT 0 NOT NULL,
	`rescued` integer DEFAULT false NOT NULL,
	`saved_at` integer NOT NULL,
	`imported_at` integer,
	`import_source` text DEFAULT 'paste' NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_user_url_idx` ON `links` (`user_id`,`url_normalized`);--> statement-breakpoint
CREATE INDEX `links_user_status_idx` ON `links` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `links_user_saved_idx` ON `links` (`user_id`,`saved_at`);--> statement-breakpoint
CREATE INDEX `links_pipeline_idx` ON `links` (`extract_status`,`ai_status`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`slot_time` integer NOT NULL,
	`session_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_slot_idx` ON `notifications` (`user_id`,`channel`,`slot_time`);--> statement-breakpoint
CREATE INDEX `notifications_status_idx` ON `notifications` (`status`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`last_ok_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_idx` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `question_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`topics` text,
	`level` text,
	`style` text,
	`focus` text,
	`extra_context` text,
	`resume_text` text,
	`resume_file_path` text,
	`resume_profile` text,
	`target_role` text,
	`seniority` text,
	`job_description` text,
	`count_per_topic` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `question_sources_user_idx` ON `question_sources` (`user_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`model_answer` text NOT NULL,
	`key_points` text DEFAULT '[]' NOT NULL,
	`category` text DEFAULT 'technical' NOT NULL,
	`difficulty` text DEFAULT 'medium' NOT NULL,
	`resume_anchor` text,
	`origin` text DEFAULT 'ai' NOT NULL,
	`review_status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `questions_user_deck_idx` ON `questions` (`user_id`,`deck_id`);--> statement-breakpoint
CREATE INDEX `questions_user_review_idx` ON `questions` (`user_id`,`review_status`);--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`session_id` text,
	`action` text NOT NULL,
	`rating` integer,
	`suggested_rating` integer,
	`grade_id` text,
	`channel` text DEFAULT 'web' NOT NULL,
	`card_before` text NOT NULL,
	`card_after` text NOT NULL,
	`fsrs_log` text,
	`duration_ms` integer,
	`undone` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `review_logs_card_at_idx` ON `review_logs` (`card_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_logs_user_at_idx` ON `review_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_logs_session_idx` ON `review_logs` (`session_id`);--> statement-breakpoint
CREATE TABLE `session_items` (
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`card_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`displayed_at` integer,
	`done_at` integer,
	PRIMARY KEY(`session_id`, `card_id`)
);
--> statement-breakpoint
CREATE INDEX `session_items_session_pos_idx` ON `session_items` (`session_id`,`position`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`valid_until` integer NOT NULL,
	`stats` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `sessions_user_status_idx` ON `sessions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `sessions_user_created_idx` ON `sessions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cadence` text DEFAULT 'daily' NOT NULL,
	`cadence_weekdays` text DEFAULT '[1]' NOT NULL,
	`cadence_day_of_month` integer DEFAULT 1 NOT NULL,
	`send_time` text DEFAULT '09:00' NOT NULL,
	`quiet_hours` text,
	`cards_per_session` integer DEFAULT 5 NOT NULL,
	`mix_mode` text DEFAULT 'auto' NOT NULL,
	`mix_links` integer DEFAULT 2 NOT NULL,
	`mix_questions` integer DEFAULT 3 NOT NULL,
	`max_new_questions` integer DEFAULT 3 NOT NULL,
	`max_new_links` integer DEFAULT 2 NOT NULL,
	`request_retention` real DEFAULT 0.9 NOT NULL,
	`expiry_enabled` integer DEFAULT true NOT NULL,
	`expiry_max_snoozes` integer DEFAULT 5 NOT NULL,
	`expiry_max_ignored` integer DEFAULT 3 NOT NULL,
	`expiry_unread_days` integer DEFAULT 180 NOT NULL,
	`strip_pii` integer DEFAULT true NOT NULL,
	`paused_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_name_idx` ON `tags` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`chat_id` text,
	`username` text,
	`linked_at` integer,
	`link_code` text,
	`link_code_expires_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_chat_idx` ON `telegram_links` (`chat_id`);--> statement-breakpoint
CREATE INDEX `telegram_links_code_idx` ON `telegram_links` (`link_code`);--> statement-breakpoint
CREATE TABLE `telegram_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` integer NOT NULL,
	`card_id` text,
	`session_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_messages_chat_message_idx` ON `telegram_messages` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `telegram_messages_card_idx` ON `telegram_messages` (`card_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`display_name` text DEFAULT 'You' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `worker_heartbeat` (
	`id` text PRIMARY KEY DEFAULT 'worker' NOT NULL,
	`beat_at` integer NOT NULL,
	`version` text DEFAULT '0.0.0' NOT NULL,
	`hostname` text
);
