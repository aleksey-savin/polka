ALTER TABLE `ai_isbn_guess` ADD `via` text;--> statement-breakpoint
ALTER TABLE `ai_isbn_guess` ADD `proof_url` text;--> statement-breakpoint
ALTER TABLE `ai_isbn_guess` ADD `proof_title` text;--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `searches` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_setting` ADD `web_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `source_setting` ADD `web_mode` text DEFAULT 'extract' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_setting` ADD `web_daily_limit` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_setting` ADD `web_last_result` text;--> statement-breakpoint
ALTER TABLE `source_setting` ADD `web_last_result_at` integer;