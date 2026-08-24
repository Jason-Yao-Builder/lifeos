CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`timeframe` text,
	`status` text DEFAULT 'active' NOT NULL,
	`rank` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `goals_workspace_idx` ON `goals` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `repeat_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`temperature` text DEFAULT 'warm' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`estimated_minutes` integer,
	`goal_id` text,
	`cron_expr` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`horizon_days` integer DEFAULT 28 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_generated` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `templates_workspace_idx` ON `repeat_templates` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `review_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `reviews_workspace_type_idx` ON `review_cards` (`workspace_id`,`type`,`period_start`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`predecessor_id` text NOT NULL,
	`successor_id` text NOT NULL,
	`type` text DEFAULT 'finish_to_start' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`predecessor_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`successor_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deps_pair_idx` ON `task_dependencies` (`predecessor_id`,`successor_id`);--> statement-breakpoint
CREATE INDEX `deps_predecessor_idx` ON `task_dependencies` (`predecessor_id`);--> statement-breakpoint
CREATE INDEX `deps_successor_idx` ON `task_dependencies` (`successor_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `goal_id` text REFERENCES goals(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `repeat_template_id` text REFERENCES repeat_templates(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `planned_start_time` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `planned_end_time` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `carry_over_from` text;--> statement-breakpoint
CREATE INDEX `tasks_goal_idx` ON `tasks` (`goal_id`) WHERE "tasks"."goal_id" is not null;--> statement-breakpoint
CREATE INDEX `tasks_planned_date_idx` ON `tasks` (`planned_date`) WHERE "tasks"."planned_date" is not null;--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_task_id`) WHERE "tasks"."parent_task_id" is not null;--> statement-breakpoint
UPDATE `tasks`
SET `score` = round(
	cast(json_extract(`score_dimensions_json`, '$.impact') AS real) * 0.40 +
	cast(json_extract(`score_dimensions_json`, '$.urgency') AS real) * 0.35 +
	cast(json_extract(`score_dimensions_json`, '$.alignment') AS real) * 0.25,
	2
)
WHERE `score_dimensions_json` IS NOT NULL
	AND json_type(`score_dimensions_json`, '$.impact') IN ('integer', 'real')
	AND json_type(`score_dimensions_json`, '$.urgency') IN ('integer', 'real')
	AND json_type(`score_dimensions_json`, '$.alignment') IN ('integer', 'real');
