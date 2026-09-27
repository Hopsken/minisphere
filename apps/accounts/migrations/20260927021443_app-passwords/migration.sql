CREATE TABLE `app_password` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`privileged` integer NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_app_password_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `app_password_refresh_token` (
	`app_password_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY,
	`next_id` text,
	CONSTRAINT `fk_app_password_refresh_token_app_password_id_app_password_id_fk` FOREIGN KEY (`app_password_id`) REFERENCES `app_password`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_password_user_name_idx` ON `app_password` (`user_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_password_hash_idx` ON `app_password` (`password_hash`);--> statement-breakpoint
CREATE INDEX `app_password_refresh_token_app_password_idx` ON `app_password_refresh_token` (`app_password_id`);