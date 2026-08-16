CREATE TABLE `mail_setting` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`host` text,
	`port` integer,
	`secure` text DEFAULT 'tls' NOT NULL,
	`username` text,
	`password_enc` text,
	`from_name` text,
	`from_email` text,
	`send_reset` integer DEFAULT true NOT NULL,
	`send_invites` integer DEFAULT true NOT NULL,
	`send_email_change` integer DEFAULT true NOT NULL,
	`send_notifications` integer DEFAULT false NOT NULL,
	`last_result` text,
	`last_result_at` integer,
	`updated_at` integer NOT NULL
);
