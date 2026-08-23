# 数据维护脚本

## 目录

```text
scripts/reset/    清空全部状态或指定任务
scripts/inspect/  打印全局状态或指定任务时间线
```

## 重置

- `pnpm data:reset:all`：显示将被清理的表计数，不写数据库。
- `pnpm data:reset:all -- --confirm`：清除本地工作区的任务、事件、AI 运行、卡片、对话、消息及规则配置；保留数据库结构、工作区和用户，然后恢复三条默认规则。
- `pnpm data:reset:task -- --id <task-id>`：预览指定任务及直接关联数据。
- `pnpm data:reset:task -- --id <task-id> --confirm`：删除该任务、关联卡片、对话、消息及对应事件。

单任务清理不会删除关联 AI 运行，因为一个评分或总结批次可能同时涉及多个任务。脚本会打印保留数量。

## 过程检查

- `pnpm data:inspect -- --limit 50`：打印总量、状态/温度分布及最近事件。
- `pnpm data:inspect -- --json`：输出机器可读 JSON。
- `pnpm data:inspect:task -- --id <task-id>`：按时间打印任务、卡片、对话和 AI 运行事件，以及对话消息。
- `pnpm data:inspect:task -- --id <task-id> --json`：输出完整 JSON。

## 指定数据库

所有命令支持 `--database <path>`，优先级高于 `DATABASE_URL`。相对路径固定以 workspace 根目录为基准；不存在的数据库会直接报错，不会创建新文件。workspace 外的文件还必须显式增加 `--allow-external`。
