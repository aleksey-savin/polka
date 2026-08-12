CREATE TABLE `crawl_task` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`author_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`scheduled_at` integer NOT NULL,
	`done_at` integer,
	`error` text,
	FOREIGN KEY (`author_id`) REFERENCES `author`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crawl_task_unique` ON `crawl_task` (`kind`,`source`,`author_id`);--> statement-breakpoint
CREATE INDEX `crawl_task_status_idx` ON `crawl_task` (`status`,`scheduled_at`);--> statement-breakpoint
ALTER TABLE `book` ADD `ref_work_id` text REFERENCES ref_work(id);--> statement-breakpoint
ALTER TABLE `ref_work` ADD `work_type` text;--> statement-breakpoint
ALTER TABLE `ref_work` ADD `editions_fetched_at` integer;