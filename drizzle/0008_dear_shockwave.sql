CREATE TABLE `ref_book` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_ref` text NOT NULL,
	`isbn13` text,
	`isbn10` text,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`authors` text DEFAULT '' NOT NULL,
	`publisher` text,
	`year` integer,
	`pages` integer,
	`height_mm` integer,
	`cover_type` text,
	`language` text DEFAULT 'ru' NOT NULL,
	`annotation` text,
	`series_name` text,
	`cover_url` text,
	`cover_path` text,
	`cover_color` text,
	`raw_json` text,
	`fetched_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ref_book_source_unique` ON `ref_book` (`source`,`source_ref`);--> statement-breakpoint
CREATE INDEX `ref_book_isbn13_idx` ON `ref_book` (`isbn13`);--> statement-breakpoint
CREATE TABLE `ref_book_author` (
	`ref_book_id` text NOT NULL,
	`author_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`ref_book_id`, `author_id`),
	FOREIGN KEY (`ref_book_id`) REFERENCES `ref_book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `author`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ref_book_author_author_idx` ON `ref_book_author` (`author_id`);--> statement-breakpoint
CREATE TABLE `ref_book_work` (
	`ref_book_id` text NOT NULL,
	`work_id` text NOT NULL,
	PRIMARY KEY(`ref_book_id`, `work_id`),
	FOREIGN KEY (`ref_book_id`) REFERENCES `ref_book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_id`) REFERENCES `ref_work`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ref_book_work_work_idx` ON `ref_book_work` (`work_id`);--> statement-breakpoint
CREATE TABLE `ref_work` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`year` integer,
	`annotation` text,
	`fetched_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ref_work_source_unique` ON `ref_work` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `ref_work_title_norm_idx` ON `ref_work` (`title_norm`);--> statement-breakpoint
CREATE TABLE `ref_work_author` (
	`work_id` text NOT NULL,
	`author_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`work_id`, `author_id`),
	FOREIGN KEY (`work_id`) REFERENCES `ref_work`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `author`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ref_work_author_author_idx` ON `ref_work_author` (`author_id`);--> statement-breakpoint
ALTER TABLE `book` ADD `ref_book_id` text REFERENCES ref_book(id);