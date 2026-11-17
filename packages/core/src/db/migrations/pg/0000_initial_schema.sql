CREATE TABLE "action_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"action" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"credential_source" text NOT NULL,
	"job_id" text,
	"ref_type" text,
	"ref_id" text,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"device_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_type" text NOT NULL,
	"item_id" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"fsrs_state" integer DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone,
	"skip_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"push_token" text NOT NULL,
	"api_token_id" text,
	"app_version" text,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"last_ok_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_channels" (
	"user_id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verify_token_hash" text,
	"unsubscribe_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"user_answer" text NOT NULL,
	"score" integer NOT NULL,
	"verdict" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"user_id" text NOT NULL,
	"item_type" text NOT NULL,
	"item_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "item_tags_item_type_item_id_tag_id_pk" PRIMARY KEY("item_type","item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"url_normalized" text NOT NULL,
	"title" text,
	"site_name" text,
	"author" text,
	"published_at" timestamp with time zone,
	"image_url" text,
	"content_type" text DEFAULT 'other' NOT NULL,
	"extracted_text" text,
	"extract_status" text DEFAULT 'pending' NOT NULL,
	"ai_status" text DEFAULT 'pending' NOT NULL,
	"summary_lines" jsonb,
	"why_saved" text,
	"summary_confidence" text,
	"read_minutes" integer,
	"language" text,
	"user_note" text,
	"status" text DEFAULT 'unread' NOT NULL,
	"snooze_count" integer DEFAULT 0 NOT NULL,
	"ignored_count" integer DEFAULT 0 NOT NULL,
	"rescued" boolean DEFAULT false NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone,
	"import_source" text DEFAULT 'paste' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"slot_time" timestamp with time zone NOT NULL,
	"session_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"last_ok_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"topics" jsonb,
	"topic_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"level" text,
	"style" text,
	"focus" jsonb,
	"extra_context" text,
	"resume_text" text,
	"resume_file_path" text,
	"resume_profile" jsonb,
	"target_role" text,
	"seniority" text,
	"job_description" text,
	"scope" text,
	"count_per_topic" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"deck_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"model_answer" text NOT NULL,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text DEFAULT 'technical' NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"resume_anchor" text,
	"origin" text DEFAULT 'ai' NOT NULL,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"session_id" text,
	"action" text NOT NULL,
	"rating" integer,
	"suggested_rating" integer,
	"grade_id" text,
	"channel" text DEFAULT 'web' NOT NULL,
	"card_before" jsonb NOT NULL,
	"card_after" jsonb NOT NULL,
	"fsrs_log" jsonb,
	"duration_ms" integer,
	"undone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_items" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"card_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"displayed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	CONSTRAINT "session_items_session_id_card_id_pk" PRIMARY KEY("session_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"cadence" text DEFAULT 'daily' NOT NULL,
	"cadence_weekdays" jsonb DEFAULT '[1]'::jsonb NOT NULL,
	"cadence_day_of_month" integer DEFAULT 1 NOT NULL,
	"send_time" text DEFAULT '09:00' NOT NULL,
	"quiet_hours" jsonb,
	"cards_per_session" integer DEFAULT 5 NOT NULL,
	"mix_mode" text DEFAULT 'auto' NOT NULL,
	"mix_links" integer DEFAULT 2 NOT NULL,
	"mix_questions" integer DEFAULT 3 NOT NULL,
	"max_new_questions" integer DEFAULT 3 NOT NULL,
	"max_new_links" integer DEFAULT 2 NOT NULL,
	"request_retention" double precision DEFAULT 0.9 NOT NULL,
	"expiry_enabled" boolean DEFAULT true NOT NULL,
	"expiry_max_snoozes" integer DEFAULT 5 NOT NULL,
	"expiry_max_ignored" integer DEFAULT 3 NOT NULL,
	"expiry_unread_days" integer DEFAULT 180 NOT NULL,
	"strip_pii" boolean DEFAULT true NOT NULL,
	"paused_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"chat_id" text,
	"username" text,
	"linked_at" timestamp with time zone,
	"link_code" text,
	"link_code_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" integer NOT NULL,
	"card_id" text,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"password_hash" text,
	"display_name" text DEFAULT 'You' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"id" text PRIMARY KEY DEFAULT 'worker' NOT NULL,
	"beat_at" timestamp with time zone NOT NULL,
	"version" text DEFAULT '0.0.0' NOT NULL,
	"hostname" text
);
--> statement-breakpoint
CREATE INDEX "action_tokens_user_idx" ON "action_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "action_tokens_expiry_idx" ON "action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_providers_user_idx" ON "ai_providers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_providers_user_kind_idx" ON "ai_providers" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "ai_usage_user_at_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_user_task_idx" ON "ai_usage" USING btree ("user_id","task");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_codes_user_idx" ON "auth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_item_idx" ON "cards" USING btree ("item_type","item_id");--> statement-breakpoint
CREATE INDEX "cards_user_status_due_idx" ON "cards" USING btree ("user_id","status","due");--> statement-breakpoint
CREATE INDEX "cards_user_type_idx" ON "cards" USING btree ("user_id","item_type");--> statement-breakpoint
CREATE INDEX "decks_user_idx" ON "decks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "decks_user_kind_idx" ON "decks" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_push_token_idx" ON "devices" USING btree ("push_token");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_channels_address_idx" ON "email_channels" USING btree ("address");--> statement-breakpoint
CREATE INDEX "grades_user_question_idx" ON "grades" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "item_tags_tag_idx" ON "item_tags" USING btree ("user_id","tag_id");--> statement-breakpoint
CREATE INDEX "item_tags_item_idx" ON "item_tags" USING btree ("item_type","item_id");--> statement-breakpoint
CREATE INDEX "jobs_pickup_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_user_idx" ON "jobs" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "links_user_url_idx" ON "links" USING btree ("user_id","url_normalized");--> statement-breakpoint
CREATE INDEX "links_user_status_idx" ON "links" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "links_user_saved_idx" ON "links" USING btree ("user_id","saved_at");--> statement-breakpoint
CREATE INDEX "links_pipeline_idx" ON "links" USING btree ("extract_status","ai_status");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_slot_idx" ON "notifications" USING btree ("user_id","channel","slot_time");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "question_sources_user_idx" ON "question_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "questions_user_deck_idx" ON "questions" USING btree ("user_id","deck_id");--> statement-breakpoint
CREATE INDEX "questions_user_review_idx" ON "questions" USING btree ("user_id","review_status");--> statement-breakpoint
CREATE INDEX "review_logs_card_at_idx" ON "review_logs" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX "review_logs_user_at_idx" ON "review_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "review_logs_session_idx" ON "review_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_items_session_pos_idx" ON "session_items" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "sessions_user_status_idx" ON "sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "sessions_user_created_idx" ON "sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_idx" ON "tags" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_chat_idx" ON "telegram_links" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "telegram_links_code_idx" ON "telegram_links" USING btree ("link_code");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_messages_chat_message_idx" ON "telegram_messages" USING btree ("chat_id","message_id");--> statement-breakpoint
CREATE INDEX "telegram_messages_card_idx" ON "telegram_messages" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");