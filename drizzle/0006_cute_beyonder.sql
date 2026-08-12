ALTER TABLE `book` ADD `gift_edition` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `book` SET `cover_type` = 'hard', `gift_edition` = 1 WHERE `cover_type` = 'gift';