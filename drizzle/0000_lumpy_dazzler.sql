CREATE TABLE `book` (
	`id` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`library_id` text,
	`shelf_id` text,
	`title` text NOT NULL,
	`authors` text DEFAULT '' NOT NULL,
	`isbn10` text,
	`isbn13` text,
	`publisher` text,
	`year` integer,
	`series_id` text,
	`series_number` text,
	`pages` integer,
	`language` text DEFAULT 'ru' NOT NULL,
	`annotation` text,
	`cover_path` text,
	`status` text DEFAULT 'in_library' NOT NULL,
	`gifted_to` text,
	`gifted_at` integer,
	`title_norm` text NOT NULL,
	`authors_norm` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shelf_id`) REFERENCES `shelf`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `book_added_by_idx` ON `book` (`added_by`);--> statement-breakpoint
CREATE INDEX `book_library_shelf_idx` ON `book` (`library_id`,`shelf_id`);--> statement-breakpoint
CREATE INDEX `book_isbn13_idx` ON `book` (`isbn13`);--> statement-breakpoint
CREATE INDEX `book_series_idx` ON `book` (`series_id`);--> statement-breakpoint
CREATE INDEX `book_status_idx` ON `book` (`status`);--> statement-breakpoint
CREATE TABLE `book_personal` (
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`reading_status` text DEFAULT 'unread' NOT NULL,
	`read_at` integer,
	`rating` integer,
	`review` text,
	`reviewed_at` integer,
	`notes` text,
	PRIMARY KEY(`user_id`, `book_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "book_personal_rating_range" CHECK("book_personal"."rating" IS NULL OR ("book_personal"."rating" >= 1 AND "book_personal"."rating" <= 5))
);
--> statement-breakpoint
CREATE TABLE `book_tag` (
	`book_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `tag_id`),
	FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `library` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `library_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_invite_token_unique` ON `library_invite` (`token`);--> statement-breakpoint
CREATE TABLE `library_member` (
	`library_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`library_id`, `user_id`),
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_member_user_idx` ON `library_member` (`user_id`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_owner_name_unique` ON `series` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `shelf` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`accent_color` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shelf_library_name_unique` ON `shelf` (`library_id`,`name`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_owner_name_unique` ON `tag` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `borrow_request` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`book_id` text NOT NULL,
	`guest_name` text NOT NULL,
	`requester_user_id` text,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`share_id`) REFERENCES `share`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `loan` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`borrower_name` text NOT NULL,
	`note` text,
	`lent_at` integer NOT NULL,
	`due_at` integer,
	`returned_at` integer,
	`request_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `borrow_request`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loan_active_unique` ON `loan` (`book_id`) WHERE "loan"."returned_at" IS NULL;--> statement-breakpoint
CREATE INDEX `loan_book_idx` ON `loan` (`book_id`);--> statement-breakpoint
CREATE TABLE `lookup_cache` (
	`isbn13` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`raw_json` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_share` (
	`user_id` text NOT NULL,
	`share_id` text NOT NULL,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `share_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`share_id`) REFERENCES `share`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `share` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`token` text NOT NULL,
	`scope` text NOT NULL,
	`library_id` text,
	`shelf_id` text,
	`allow_requests` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shelf_id`) REFERENCES `shelf`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "share_scope_target" CHECK(("share"."scope" = 'library' AND "share"."library_id" IS NOT NULL AND "share"."shelf_id" IS NULL) OR ("share"."scope" = 'shelf' AND "share"."shelf_id" IS NOT NULL AND "share"."library_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_token_unique` ON `share` (`token`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);