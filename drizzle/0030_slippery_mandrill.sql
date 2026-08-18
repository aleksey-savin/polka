CREATE TABLE `book_source` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
