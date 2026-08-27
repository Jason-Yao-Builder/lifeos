import type {
  ComponentType,
  DragEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  Task,
  TaskGroup,
  TaskStatus,
  Temperature,
  UpdateTask,
} from "../../types";
import type { TaskDropPosition, TaskTimeFilter } from "../../v02-utils";

export interface TaskFilters {
  temperature: "all" | Temperature;
  status: "all" | TaskStatus;
  tag: string;
  time: TaskTimeFilter;
  group: "all" | "ungrouped" | string;
}

export type TaskCompletionMotion = "exiting" | "entering" | "restoring";

export interface TaskRowRendererProps {
  task: Task;
  parentTask: Task | null;
  group: TaskGroup | null;
  depth: number;
  ancestorTitles: string[];
  lineageIssue: "missing" | "cycle" | null;
  hasChildren: boolean;
  childrenExpanded: boolean;
  canReorder: boolean;
  dragging: boolean;
  dropPosition: TaskDropPosition | null;
  completionMotion: TaskCompletionMotion | null;
  onUpdate: TaskBoardProps["onUpdate"];
  onInheritParent: TaskBoardProps["onInheritParent"];
  onOpen: TaskBoardProps["onOpen"];
  onSelectGroup: (groupId: string) => void;
  onToggleChildren: (taskId: string) => void;
  onDragStart: (event: DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent, id: string) => void;
  onDrop: (event: DragEvent, id: string) => void;
  onPointerStart: (event: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLButtonElement>, cancelled?: boolean) => void;
  onKeyboardReorder: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void;
}

export interface TaskBoardRenderers {
  TaskRow: ComponentType<TaskRowRendererProps>;
}

export interface TaskBoardProps {
  view: "tasks" | "today";
  tasks: Task[];
  allTasks: Task[];
  taskGroups: TaskGroup[];
  filters: TaskFilters;
  tags: string[];
  onViewChange: (view: "tasks" | "today") => void;
  onFiltersChange: (filters: TaskFilters) => void;
  onCreateTask: () => void;
  onCreateTaskGroup: (input: Pick<TaskGroup, "name" | "color">) => Promise<TaskGroup>;
  onUpdateTaskGroup: (
    id: string,
    patch: Partial<Pick<TaskGroup, "name" | "color">>,
  ) => Promise<TaskGroup>;
  onUpdate: (task: Task, patch: UpdateTask) => Promise<boolean | void>;
  rollForwardTargetDate: string;
  onRollForwardOverdue: (tasks: Task[]) => Promise<void>;
  onInheritParent: (task: Task) => Promise<void>;
  completionMotions?: Readonly<Partial<Record<string, TaskCompletionMotion>>>;
  onOpen: (task: Task) => void;
  onReorder: (
    sourceId: string,
    targetId: string,
    position: TaskDropPosition,
    scopeIds: string[],
  ) => Promise<void>;
  renderers?: Partial<TaskBoardRenderers>;
}
