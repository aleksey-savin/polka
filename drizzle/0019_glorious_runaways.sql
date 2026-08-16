CREATE TABLE `ai_setting` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`provider` text DEFAULT 'yandex' NOT NULL,
	`api_key_enc` text,
	`folder_id` text,
	`model` text,
	`endpoint` text,
	`daily_limit` integer DEFAULT 30 NOT NULL,
	`last_result` text,
	`last_result_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
