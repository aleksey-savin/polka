CREATE TABLE `moderation_item` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner_id` text,
	`report_count` integer DEFAULT 0 NOT NULL,
	`reason` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_item_status_idx` ON `moderation_item` (`status`,`report_count`);--> statement-breakpoint
CREATE INDEX `moderation_item_target_idx` ON `moderation_item` (`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `moderation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`kind` text,
	`target_id` text,
	`subject_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subject_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_log_created_idx` ON `moderation_log` ("created_at" desc);--> statement-breakpoint
CREATE TABLE `moderation_report` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`reporter_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `moderation_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `moderation_report_item_idx` ON `moderation_report` (`item_id`);--> statement-breakpoint
CREATE TABLE `user_account` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`publish_banned_at` integer,
	`publish_ban_reason` text,
	`blocked_at` integer,
	`blocked_reason` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
