CREATE TABLE `account_invitations` (
	`code` text PRIMARY KEY,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_invitations_expires_at_idx` ON `account_invitations` (`expires_at`);