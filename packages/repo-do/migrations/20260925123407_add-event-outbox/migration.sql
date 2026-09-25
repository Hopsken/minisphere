CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`body` blob NOT NULL,
	`type` text NOT NULL
);
