CREATE TABLE `task_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_groups_color_check" CHECK(length("task_groups"."color") = 7 and "task_groups"."color" glob '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_groups_workspace_name_idx` ON `task_groups` (`workspace_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `task_groups_workspace_created_idx` ON `task_groups` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `group_id` text REFERENCES task_groups(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `tasks_group_idx` ON `tasks` (`group_id`) WHERE "tasks"."group_id" is not null;
