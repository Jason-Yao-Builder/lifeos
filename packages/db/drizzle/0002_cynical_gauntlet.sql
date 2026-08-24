CREATE TABLE IF NOT EXISTS `task_images` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_images_size_check" CHECK("task_images"."size_bytes" between 1 and 5242880),
	CONSTRAINT "task_images_data_size_check" CHECK(length("task_images"."data") = "task_images"."size_bytes"),
	CONSTRAINT "task_images_mime_check" CHECK("task_images"."mime_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_images_task_idx` ON `task_images` (`workspace_id`,`task_id`,`created_at`);
