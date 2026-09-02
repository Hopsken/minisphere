CREATE TABLE `signing_key_reservations` (
	`claimed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`did` text UNIQUE,
	`encrypted_private_key` text NOT NULL,
	`encryption_iv` text NOT NULL,
	`signing_key` text PRIMARY KEY
);
