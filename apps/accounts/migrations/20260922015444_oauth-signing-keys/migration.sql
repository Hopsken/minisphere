CREATE TABLE `oauth_signing_key` (
	`kid` text PRIMARY KEY,
	`status` text NOT NULL,
	`public_x` text NOT NULL,
	`public_y` text NOT NULL,
	`encrypted_private_key` text NOT NULL,
	`encryption_iv` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "oauth_signing_key_status_check" CHECK("status" IN ('current', 'retired', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_signing_key_one_current` ON `oauth_signing_key` (`status`) WHERE "oauth_signing_key"."status" = 'current';