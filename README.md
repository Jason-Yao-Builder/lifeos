# LifeOS v0.2

LifeOS 是一个本地优先的任务与日程管理系统。v0.2 在任务闭环上补齐了时间视图、任务结构、重复任务、目标与复盘节律。

## 快速启动

要求：Node.js ≥ 22.12、pnpm 10。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

启动后：

- Web：`http://127.0.0.1:5173/today`
- API：`http://127.0.0.1:4310/api/v1`
- OpenAPI：`http://127.0.0.1:4310/docs`
- 健康检查：`http://127.0.0.1:4310/api/v1/debug/health`

首次启动会自动迁移、初始化数据库，并为启用的重复模板补齐未来 28 天实例；运行期间每小时检查一次。默认数据库位于操作系统用户数据目录（macOS：`~/Library/Application Support/LifeOS/lifeos.db`），不进入源码仓库；默认工作区时区是 `Asia/Shanghai`。

## 已实现

- 实验性自适应 AI 提案框架：安全排程、任务拆解、冻结时域、人工审批、原子提交、留出集记忆校验与对抗评测；详见 `docs/自适应AI日程框架-v0.3.md`。

- 任务 CRUD、三层可视化分解、前后依赖、阻塞态、父任务进度与关键路径。
- 任务列表、今日、月/周/日日历、可编辑甘特图，以及桌面与触屏拖拽。
- 长期目标 CRUD、任务关联、按目标汇总进度。
- Cron 重复模板、28 天滚动实例化；实例生成后与模板独立。
- 晨起规划、遗留任务批量决策、每日复盘、周复盘与月复盘。
- 影响力 40% + 紧迫度 35% + 方向一致性 25% 的可解释三维评分；effort 仅保留为元数据。
- 今日清单：计划到今天，以及今天到期或已逾期的未完成硬任务。
- 操作、观察、生成卡片；接受、拒绝、讨论与刷新恢复。
- 每日总结、对话回复、滞留观察。
- deadline 升温、滞留观察、周五复核三条预设规则。
- 乐观锁、事务、全量事件审计、调试统计与 OpenAPI。
- 默认 deterministic AI，无密钥也能离线工作；支持显式 Demo 模式。

## 常用命令

```bash
pnpm verify       # lint + 类型检查 + 测试 + 生产构建
pnpm test         # 全部自动化测试
pnpm db:migrate   # 手动执行迁移；通常不需要
pnpm db:seed      # 手动补齐默认工作区、用户和规则
pnpm build        # 构建 API 与 Web
```

## 从 v0.1 升级

先停止服务并备份用户数据目录中的 `lifeos.db`，再执行 `pnpm install --frozen-lockfile && pnpm db:migrate && pnpm verify`。迁移会新增 v0.2 结构，并按三维公式重算现有任务分数；effort 元数据保留。验证通过后运行 `pnpm dev`，检查 `/api/v1/debug/health`。如需回滚，停止服务并恢复升级前的数据库备份。

## 测试数据维护

维护脚本默认读取操作系统用户数据目录中的数据库，也支持 `LIFEOS_DATA_DIR`、`DATABASE_URL` 或 `--database <path>`。重置命令默认只预览，必须增加 `--confirm` 才会写库。

```bash
pnpm data:inspect                                  # 全局状态、分布和最近事件
pnpm data:inspect:task -- --id <task-id>           # 单任务过程时间线
pnpm data:reset:all                                # 预览全量重置
pnpm data:reset:all -- --confirm                   # 清空业务状态并恢复三条默认规则
pnpm data:reset:task -- --id <task-id>             # 预览单任务清理
pnpm data:reset:task -- --id <task-id> --confirm   # 清理任务及直接关联记录
```

目录与安全语义见 `scripts/README.md`。选择性清理会保留可能被其他任务共享的 AI 运行批次。
用户数据位置、浏览器存储与 Git 检查方法见 `docs/用户数据与源码分离.md`。

## 配置

默认配置无需 `.env`。需要覆盖时，以 `.env.example` 为模板导出环境变量后启动。

| 变量 | 用途 |
|---|---|
| `LIFEOS_DATA_DIR` | 用户数据目录；默认采用操作系统规范目录 |
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

依赖方向是 `contracts ← domain/db/ai ← api`；Web 仅通过 REST 使用数据。v0.2 不包含真实模型接入、日内时间块 UI、外部日历同步、推送、多用户协作、看板、插件沙箱和向量召回。

完整范围与逐项验收口径见 `../方案/版本规划与核验标准-v0.2.md`；本轮结果见 `docs/验收结果-v0.2.md`。
