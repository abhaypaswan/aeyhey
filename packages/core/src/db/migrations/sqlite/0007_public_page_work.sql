ALTER TABLE `public_profiles` ADD `headline` text;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `location` text;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `skills` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `interests` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `experience` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `projects` text DEFAULT '[]' NOT NULL;