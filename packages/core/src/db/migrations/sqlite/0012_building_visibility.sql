ALTER TABLE `agent_highlights` ADD `hidden_from_page` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `building_visibility` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `public_profiles` ADD `show_agent_models` integer DEFAULT false NOT NULL;