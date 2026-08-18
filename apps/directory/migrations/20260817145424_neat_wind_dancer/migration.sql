CREATE TABLE `dids` (
	`did` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`_id` integer PRIMARY KEY AUTOINCREMENT,
	`did` text NOT NULL,
	`operation` text NOT NULL,
	`cid` text NOT NULL,
	`nullified` integer DEFAULT false NOT NULL,
	`createdAt` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_did_cid_unique_idx` ON `operations` (`did`,`cid`);--> statement-breakpoint
CREATE INDEX `operations_did_createdat_idx` ON `operations` (`did`,`createdAt`);