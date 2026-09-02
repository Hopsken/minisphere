CREATE TABLE `account_creation_operations` (
	`operation_id` text PRIMARY KEY,
	`handle` text NOT NULL UNIQUE,
	`did` text NOT NULL UNIQUE,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "account_creation_operation_status_check" CHECK("status" IN ('provisioning', 'active'))
);
