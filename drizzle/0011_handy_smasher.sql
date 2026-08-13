CREATE TABLE `ref_work_link` (
	`parent_id` text NOT NULL,
	`child_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`parent_id`, `child_id`),
	FOREIGN KEY (`parent_id`) REFERENCES `ref_work`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `ref_work`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ref_work_link_child_idx` ON `ref_work_link` (`child_id`);