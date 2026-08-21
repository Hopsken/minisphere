CREATE TABLE `accounts` (
	`did` text PRIMARY KEY,
	`handle` text NOT NULL,
	`password_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`did` text NOT NULL,
	`expires_at` integer NOT NULL,
	`jti` text PRIMARY KEY,
	CONSTRAINT `fk_refresh_tokens_did_accounts_did_fk` FOREIGN KEY (`did`) REFERENCES `accounts`(`did`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_handle_unique_idx` ON `accounts` (`handle`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_did_idx` ON `refresh_tokens` (`did`);