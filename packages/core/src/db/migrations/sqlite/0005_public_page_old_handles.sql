ALTER TABLE `public_profiles` ADD `previous_handle` text;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `handle_changed_at` integer;--> statement-breakpoint
CREATE INDEX `public_profiles_previous_handle_idx` ON `public_profiles` (`previous_handle`);