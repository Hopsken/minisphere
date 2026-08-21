CREATE TABLE `blocks` (
	`cid` text PRIMARY KEY,
	`bytes` blob NOT NULL,
	`rev` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metadata` (
	`id` integer PRIMARY KEY DEFAULT 1,
	`did` text NOT NULL,
	`rev` text NOT NULL,
	`root_cid` text NOT NULL
);
