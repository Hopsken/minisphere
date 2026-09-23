CREATE TABLE `dpop_state` (
	`key` text PRIMARY KEY,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dpop_state_expires_at_idx` ON `dpop_state` (`expires_at`);