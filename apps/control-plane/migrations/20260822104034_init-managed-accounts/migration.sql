CREATE TABLE `accounts` (
	`did` text PRIMARY KEY,
	`encrypted_credentials` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
