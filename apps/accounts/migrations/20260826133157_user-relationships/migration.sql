CREATE TABLE `user-relationships` (
	`source_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	CONSTRAINT `user-relationships_pk` PRIMARY KEY(`source_user_id`, `target_user_id`),
	CONSTRAINT `fk_user-relationships_source_user_id_user_id_fk` FOREIGN KEY (`source_user_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_user-relationships_target_user_id_user_id_fk` FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `display_username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `did` text;--> statement-breakpoint
ALTER TABLE `user` ADD `type` text DEFAULT 'user';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`username` text UNIQUE,
	`display_username` text,
	`did` text,
	`type` text DEFAULT 'user'
);
--> statement-breakpoint
INSERT INTO `__new_user`(`id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`) SELECT `id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at` FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_did_uidx` ON `user` (`did`);