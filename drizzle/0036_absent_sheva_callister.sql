ALTER TABLE `book` ADD `ref_checksum` text;--> statement-breakpoint
ALTER TABLE `book` ADD `ref_sync_muted` integer DEFAULT false NOT NULL;