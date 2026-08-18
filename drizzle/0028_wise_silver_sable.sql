ALTER TABLE `moderation_item` ADD `from_ai` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `moderation_item` ADD `draft_json` text;--> statement-breakpoint
ALTER TABLE `moderation_item` ADD `published_ref_id` text;