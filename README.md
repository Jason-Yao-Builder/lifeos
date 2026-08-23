# LifeOS v0.1

LifeOS 是一个本地优先的任务与日程管理 MVP。当前版本已跑通：任务捕获 → 温度/评分/排序 → 今日执行 → AI 建议与总结 → 人工决策 → 全量审计。

## 快速启动

要求：Node.js ≥ 22.12、pnpm 10。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

启动后：

- Web：`http://127.0.0.1:5173/tasks`
- API：`http://127.0.0.1:4310/api/v1`
- OpenAPI：`http://127.0.0.1:4310/docs`
- 健康检查：`http://127.0.0.1:4310/api/v1/debug/health`

首次启动会自动迁移并初始化数据库。默认数据文件是 `data/lifeos.db`，默认工作区时区是 `Asia/Shanghai`。

## 已实现

- 任务 CRUD、温度、deadline 派生硬度、标签、状态、计划日和用时字段。
- 主列表筛选、行内编辑、人工拖动排序和偏好事件。
- 今日清单：计划到今天，以及今天到期或已逾期的未完成硬任务。
- 可解释四维评分；默认 deterministic AI，无密钥也能离线工作。
- 操作、观察、生成卡片；接受、拒绝、讨论与刷新恢复。
- 每日总结、对话回复、滞留观察。
- deadline 升温、滞留观察、周五复核三条预设规则。
- 乐观锁、事务、全量事件审计、调试统计与 OpenAPI。
- 桌面与窄屏 Web 界面；显式 Demo 模式。

## 常用命令

```bash
pnpm verify       # lint + 类型检查 + 测试 + 生产构建
pnpm test         # 全部自动化测试
pnpm db:migrate   # 手动执行迁移；通常不需要
pnpm db:seed      # 手动补齐默认工作区、用户和规则
pnpm build        # 构建 API 与 Web
```

## 测试数据维护

维护脚本默认读取 `data/lifeos.db`，也支持 `DATABASE_URL` 或 `--database <path>`。重置命令默认只预览，必须增加 `--confirm` 才会写库。

```bash
pnpm data:inspect                                  # 全局状态、分布和最近事件
pnpm data:inspect:task -- --id <task-id>           # 单任务过程时间线
pnpm data:reset:all                                # 预览全量重置
pnpm data:reset:all -- --confirm                   # 清空业务状态并恢复三条默认规则
pnpm data:reset:task -- --id <task-id>             # 预览单任务清理
pnpm data:reset:task -- --id <task-id> --confirm   # 清理任务及直接关联记录
```

目录与安全语义见 `scripts/README.md`。选择性清理会保留可能被其他任务共享的 AI 运行批次。

## 配置

默认配置无需 `.env`。需要覆盖时，以 `.env.example` 为模板导出环境变量后启动。

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | SQLite 文件路径或 `:memory:` |
| `PORT` / `HOST` | API 监听地址 |
| `WORKSPACE_TIMEZONE` | 今日与规则切日时区 |
| `DEBUG_API_ENABLED` | 是否注册 debug 路由 |
| `DEBUG_API_KEY` | 可选的 debug API key |
| `CORS_ORIGIN` | 允许的 Web 来源 |
| `VITE_API_URL` | Web 的 API 基址，可省略并使用开发代理 |
| `VITE_DEMO_MODE` | 设为 `true` 才启用浏览器本地演示数据 |

## 工程边界

```text
apps/api          Fastify 路由与应用服务
apps/web          React + Vite SPA
packages/contracts  Zod API 契约
packages/domain     无框架领域逻辑
packages/db         Drizzle + SQLite、迁移、审计 store
packages/ai         可替换 AI adapter 与离线实现
```

依赖方向是 `contracts ← domain/db/ai ← api`；Web 仅通过 REST 使用数据。v0.1 不包含甘特图、周/月复盘、多用户 UI、任务依赖、重复任务、外部插件沙箱、推送和向量召回。

完整范围与逐项验收口径见上级目录的 `版本规划与核验标准-v0.1.md`；本轮结果见 `docs/验收结果-v0.1.md`。
