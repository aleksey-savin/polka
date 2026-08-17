CREATE TABLE `ai_isbn_guess` (
	`isbn13` text PRIMARY KEY NOT NULL,
	`verdict` text NOT NULL,
	`title` text,
	`authors` text,
	`publisher` text,
	`year` integer,
	`series_name` text,
	`ref_book_id` text,
	`work_id` text,
	`model` text,
	`raw_json` text,
	`asked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`isbn13` text NOT NULL,
	`verdict` text NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`applied_by` text,
	`applied_at` integer NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`review_note` text,
	FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`applied_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_suggestion_book_idx` ON `ai_suggestion` (`book_id`);--> statement-breakpoint
CREATE INDEX `ai_suggestion_status_idx` ON `ai_suggestion` (`status`);