CREATE TABLE `accounts` (
	`did` text PRIMARY KEY,
	`handle` text NOT NULL,
	`account_type` text NOT NULL,
	`pds_origin` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_handle_unique_idx` ON `accounts` (`handle`);