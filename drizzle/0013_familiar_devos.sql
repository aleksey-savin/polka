CREATE TABLE `gift_hold` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`share_id` text NOT NULL,
	`guest_name` text NOT NULL,
	`holder_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`canceled_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `book_list_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`share_id`) REFERENCES `share`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gift_hold_item_idx` ON `gift_hold` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gift_hold_active_unique` ON `gift_hold` (`item_id`) WHERE "gift_hold"."canceled_at" is null;--> statement-breakpoint
CREATE TABLE `book_list` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `book_list_owner_idx` ON `book_list` (`owner_id`,`kind`,`position`);--> statement-breakpoint
CREATE TABLE `book_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`book_id` text,
	`ref_work_id` text,
	`ref_book_id` text,
	`note` text,
	`position` integer DEFAULT 0 NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `book_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ref_work_id`) REFERENCES `ref_work`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ref_book_id`) REFERENCES `ref_book`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "book_list_item_single_target" CHECK(("book_list_item"."book_id" is not null) + ("book_list_item"."ref_work_id" is not null) + ("book_list_item"."ref_book_id" is not null) = 1)
);
--> statement-breakpoint
CREATE INDEX `book_list_item_list_idx` ON `book_list_item` (`list_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `book_list_item_book_unique` ON `book_list_item` (`list_id`,`book_id`) WHERE "book_list_item"."book_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `book_list_item_work_unique` ON `book_list_item` (`list_id`,`ref_work_id`) WHERE "book_list_item"."ref_work_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `book_list_item_edition_unique` ON `book_list_item` (`list_id`,`ref_book_id`) WHERE "book_list_item"."ref_book_id" is not null;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_share` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`token` text NOT NULL,
	`scope` text NOT NULL,
	`library_id` text,
	`shelf_id` text,
	`list_id` text,
	`allow_requests` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shelf_id`) REFERENCES `shelf`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `book_list`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "share_scope_target" CHECK(("__new_share"."scope" = 'library' AND "__new_share"."library_id" IS NOT NULL AND "__new_share"."shelf_id" IS NULL AND "__new_share"."list_id" IS NULL) OR ("__new_share"."scope" = 'shelf' AND "__new_share"."shelf_id" IS NOT NULL AND "__new_share"."library_id" IS NULL AND "__new_share"."list_id" IS NULL) OR ("__new_share"."scope" = 'list' AND "__new_share"."list_id" IS NOT NULL AND "__new_share"."library_id" IS NULL AND "__new_share"."shelf_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_share`("id", "created_by", "token", "scope", "library_id", "shelf_id", "list_id", "allow_requests", "created_at", "revoked_at") SELECT "id", "created_by", "token", "scope", "library_id", "shelf_id", NULL, "allow_requests", "created_at", "revoked_at" FROM `share`;--> statement-breakpoint
DROP TABLE `share`;--> statement-breakpoint
ALTER TABLE `__new_share` RENAME TO `share`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `share_token_unique` ON `share` (`token`);