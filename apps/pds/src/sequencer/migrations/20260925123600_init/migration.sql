CREATE TABLE `events` (
	`seq` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	`frame` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_sources` (
	`did` text PRIMARY KEY,
	`last_event_id` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_created_at` ON `events` (`created_at`);