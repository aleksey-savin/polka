CREATE TABLE `source_setting` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`google_key_enc` text,
	`last_check` text,
	`last_check_at` integer,
	`updated_at` integer NOT NULL
);
