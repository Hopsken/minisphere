CREATE TABLE `atproto_account` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`did` text UNIQUE,
	`signing_key` text,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`user_id` text PRIMARY KEY,
	`username` text NOT NULL UNIQUE,
	CONSTRAINT "atproto_account_status_check" CHECK("status" IN ('provisioning', 'active')),
	CONSTRAINT "atproto_account_active_did_check" CHECK("status" != 'active' OR "did" IS NOT NULL),
	CONSTRAINT "atproto_account_identity_material_check" CHECK(("did" IS NULL AND "signing_key" IS NULL) OR ("did" IS NOT NULL AND "signing_key" IS NOT NULL))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user`(`id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`) SELECT `id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at` FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `user_did_uidx`;--> statement-breakpoint
DROP TABLE `user-relationships`;