CREATE TABLE `handles` (
	`handle` text PRIMARY KEY,
	`did` text NOT NULL,
	`createdAt` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
