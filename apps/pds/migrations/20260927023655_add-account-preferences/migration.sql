CREATE TABLE `account_preferences` (
	`did` text PRIMARY KEY,
	`preferences` text NOT NULL,
	CONSTRAINT `fk_account_preferences_did_accounts_did_fk` FOREIGN KEY (`did`) REFERENCES `accounts`(`did`) ON DELETE CASCADE
);
