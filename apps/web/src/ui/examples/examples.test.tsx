import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Task, TaskGroup } from "../../types";
import type { TaskRowRendererProps } from "../../features/tasks";
import { CompactTaskRow } from "./CompactTaskRow";
import { paperTheme } from "./paperTheme";

const task: Task = {
  id: "task-1",
  version: 1,
  title: "替代 renderer 证明",
  description: null,
  temperature: "warm",
  status: "todo",
  hardness: "soft",
  deadline: null,
  plannedDate: null,
  groupId: "group-1",
  tags: [],
  score: null,
  rank: 1,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
};

const group: TaskGroup = {
  id: "group-1",
  workspaceId: "workspace-1",
  name: "示例分组",
  color: "#315b96",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
};

const props = {
  task,
  parentTask: null,
  group,
  depth: 1,
  ancestorTitles: [],
  lineageIssue: null,
  hasChildren: false,
  childrenExpanded: false,
  canReorder: true,
  dragging: false,
  dropPosition: null,
  completionMotion: null,
  onUpdate: async () => undefined,
  onInheritParent: async () => undefined,
  onOpen: () => undefined,
  onSelectGroup: () => undefined,
  onToggleChildren: () => undefined,
  onDragStart: () => undefined,
  onDragEnd: () => undefined,
  onDragOver: () => undefined,
  onDrop: () => undefined,
  onPointerStart: () => undefined,
  onPointerMove: () => undefined,
  onPointerEnd: () => undefined,
  onKeyboardReorder: () => undefined,
} satisfies TaskRowRendererProps;

describe("UI extension examples", () => {
  it("ships a compatible alternate theme manifest and semantic token sheet", () => {
    const css = readFileSync(new URL("../styles/themes/paper.css", import.meta.url), "utf8");

    expect(paperTheme).toEqual({ id: "paper", name: "Paper", uiApiVersion: 1 });
    expect(css).toContain(':root[data-theme="paper"]');
    expect(css).toContain("--ui-color-accent:");
    expect(css).toContain("--ui-radius-md:");
  });

  it("renders a replaceable task row using only its public props", () => {
    const markup = renderToStaticMarkup(<CompactTaskRow {...props} />);
    const source = readFileSync(new URL("./CompactTaskRow.tsx", import.meta.url), "utf8");

    expect(markup).toContain("替代 renderer 证明");
    expect(markup).toContain("示例分组");
    expect(markup).toContain('role="treeitem"');
    expect(source).not.toMatch(/fetch\(|\/api\//);
  });
});
