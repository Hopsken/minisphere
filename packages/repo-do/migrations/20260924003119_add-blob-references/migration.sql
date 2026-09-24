CREATE TABLE `blobs` (
	`cid` text PRIMARY KEY,
	`key` text NOT NULL,
	`size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `record_blobs` (
	`path` text NOT NULL,
	`cid` text NOT NULL,
	`rev` text NOT NULL,
	CONSTRAINT `record_blobs_pk` PRIMARY KEY(`path`, `cid`),
	CONSTRAINT `fk_record_blobs_cid_blobs_cid_fk` FOREIGN KEY (`cid`) REFERENCES `blobs`(`cid`)
);
--> statement-breakpoint
CREATE INDEX `record_blobs_cid` ON `record_blobs` (`cid`);