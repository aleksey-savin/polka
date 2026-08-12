CREATE TABLE `author` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`fantlab_id` integer,
	`openlibrary_id` text,
	`bio` text,
	`birth_year` integer,
	`death_year` integer,
	`country` text,
	`photo_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `author_name_norm_unique` ON `author` (`name_norm`);--> statement-breakpoint
CREATE TABLE `book_author` (
	`book_id` text NOT NULL,
	`author_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`book_id`, `author_id`),
	FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `author`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `book_author_author_idx` ON `book_author` (`author_id`);