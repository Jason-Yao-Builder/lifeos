# LifeOS UI 扩展

UI 层只接收视图数据与动作回调；任务规则、接口请求、路由和持久化留在 controller / app 层。换主题或 renderer 不应改业务代码。

## 结构

- `styles/tokens.css`：稳定的语义 token API。
- `styles/themes/*.css`：主题值，通过 `html[data-theme="..."]` 生效。
- `primitives/`：无品牌的基础控件契约。
- `registry.tsx`：主题 manifest 与 renderer slots。
- `examples/`：可直接编译的 Paper 主题与紧凑任务行示例。

## 切换主题与 renderer

```tsx
import { LifeOSUIProvider } from "./ui";
import { CompactTaskRow, paperTheme } from "./ui/examples";

<LifeOSUIProvider
  theme={paperTheme}
  renderers={{ TaskRow: CompactTaskRow }}
>
  <App />
</LifeOSUIProvider>
```

`paperTheme` 会加载自己的 CSS。自定义主题也可在 manifest 的 `tokens` 中直接提供语义 token，无需改组件。manifest 的 `uiApiVersion` 必须与 `LIFEOS_UI_API_VERSION` 一致。

renderer 以 `Partial<LifeOSRenderers>` 注入。未提供的 slot 自动回退默认实现，因此可以只替换 `TaskRow`，不必复制整个应用。

## 主题契约

```css
@layer themes {
:root[data-theme="my-theme"] {
  --ui-color-text: #202020;
  --ui-color-surface: #fff;
  --ui-color-accent: #315b96;
  --ui-font-family-sans: system-ui, sans-serif;
}
}
```

新增 primitive 与可扩展 renderer 只使用 `--ui-*` 语义 token。默认界面中尚未迁移的兼容样式仍在 `styles.css`；覆写完整 renderer 时不应依赖这些旧选择器。主题不应依赖任务数据或接口。

## 安全边界

- renderer 只通过 props 读视图数据，通过回调提交意图；不要直接调用 API、改全局 store 或读写 localStorage。
- 纯 model 不引用 CSS class、颜色或 DOM；React controller 只保留必要的交互几何，视觉计算留在 appearance / renderer。
- 外部主题 ID 只允许字母、数字、下划线和连字符；不兼容的 manifest 会被 Provider 拒绝。
- renderer 必须保留键盘、ARIA、拖动和禁用态语义。替换视觉不等于绕过交互约束。

具体过程：用户点击紧凑任务行的状态按钮 → renderer 调用 `onUpdate(task, patch)` → app/controller 执行业务更新 → 新任务数据再次作为 props 投影；renderer 不知道请求地址，也不持有业务真相。
