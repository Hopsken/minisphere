ALTER TABLE `atproto_account` ADD `operation` text;--> statement-breakpoint
ALTER TABLE `atproto_account` ADD `encrypted_rotation_key` text;--> statement-breakpoint
ALTER TABLE `atproto_account` ADD `rotation_key_iv` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_atproto_account` (
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`did` text UNIQUE,
	`signing_key` text,
	`operation` text,
	`encrypted_rotation_key` text,
	`rotation_key_iv` text,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`user_id` text PRIMARY KEY,
	`username` text NOT NULL UNIQUE,
	CONSTRAINT "atproto_account_status_check" CHECK("status" IN ('provisioning', 'active')),
	CONSTRAINT "atproto_account_active_did_check" CHECK("status" != 'active' OR "did" IS NOT NULL),
	CONSTRAINT "atproto_account_identity_material_check" CHECK(("did" IS NULL AND "signing_key" IS NULL AND "operation" IS NULL AND "encrypted_rotation_key" IS NULL AND "rotation_key_iv" IS NULL) OR ("did" IS NOT NULL AND "signing_key" IS NOT NULL AND "operation" IS NOT NULL AND "encrypted_rotation_key" IS NOT NULL AND "rotation_key_iv" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_atproto_account`(`created_at`, `did`, `signing_key`, `status`, `updated_at`, `user_id`, `username`) SELECT `created_at`, `did`, `signing_key`, `status`, `updated_at`, `user_id`, `username` FROM `atproto_account`;--> statement-breakpoint
DROP TABLE `atproto_account`;--> statement-breakpoint
ALTER TABLE `__new_atproto_account` RENAME TO `atproto_account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;