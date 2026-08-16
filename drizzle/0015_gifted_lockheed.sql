CREATE TABLE `user_pref` (
	`user_id` text PRIMARY KEY NOT NULL,
	`skip_action` text DEFAULT 'ask' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
