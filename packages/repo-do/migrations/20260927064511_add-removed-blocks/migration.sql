CREATE TABLE `removed_blocks` (
	`cid` text PRIMARY KEY,
	`removed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `removed_blocks_removed_at` ON `removed_blocks` (`removed_at`);
--> statement-breakpoint
-- Blocks from before reclamation have no removal record, so check them all.
-- No read spans a migration, so they need no grace period.
INSERT INTO `removed_blocks` (`cid`, `removed_at`) SELECT `cid`, 0 FROM `blocks`;
