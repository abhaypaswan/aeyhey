CREATE TABLE `public_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`title` text,
	`bio` text,
	`enabled` integer DEFAULT false NOT NULL,
	`indexable` integer DEFAULT false NOT NULL,
	`show_footer` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_profiles_handle_idx` ON `public_profiles` (`handle`);--> statement-breakpoint
ALTER TABLE `links` ADD `shared_at` integer;--> statement-breakpoint
ALTER TABLE `links` ADD `public_takeaway` text;--> statement-breakpoint
CREATE INDEX `links_user_shared_idx` ON `links` (`user_id`,`shared_at`);