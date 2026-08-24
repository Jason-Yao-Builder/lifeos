import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { CalendarView, type CalendarViewProps } from "../CalendarView";
import {
  AiDrawer,
  RulesDrawer,
  TaskDrawer,
  type AiDrawerProps,
  type RulesDrawerProps,
  type TaskDrawerProps,
} from "../Drawers";
import { GanttView, type GanttViewProps } from "../GanttView";
import { DefaultTaskRow, TaskBoard } from "../TaskBoard";
import type {
  TaskBoardProps,
  TaskRowRendererProps,
} from "../features/tasks";
import { AppSidebar, type AppSidebarProps } from "../features/shell";
import { DEFAULT_UI_THEME, applyUiThemeTokens, setUiTheme } from "./styles";
import type { UiThemeTokenValues } from "./styles";

export const LIFEOS_UI_API_VERSION = 1;

export const lifeOSRendererSlots = [
  "AppSidebar",
  "TaskBoard",
  "TaskRow",
  "TaskDrawer",
  "AiDrawer",
  "RulesDrawer",
  "CalendarView",
  "GanttView",
] as const;

export type LifeOSRendererSlot = (typeof lifeOSRendererSlots)[number];

export interface LifeOSThemeManifest {
  id: string;
  name: string;
  uiApiVersion: typeof LIFEOS_UI_API_VERSION;
  tokens?: UiThemeTokenValues;
}

export interface LifeOSRenderers {
  AppSidebar: ComponentType<AppSidebarProps>;
  TaskDrawer: ComponentType<TaskDrawerProps>;
  AiDrawer: ComponentType<AiDrawerProps>;
  RulesDrawer: ComponentType<RulesDrawerProps>;
  TaskBoard: ComponentType<TaskBoardProps>;
  TaskRow: ComponentType<TaskRowRendererProps>;
  CalendarView: ComponentType<CalendarViewProps>;
  GanttView: ComponentType<GanttViewProps>;
}

export interface LifeOSUIRegistry {
  theme: LifeOSThemeManifest;
  renderers: LifeOSRenderers;
}

export const defaultLifeOSTheme: LifeOSThemeManifest = {
  id: DEFAULT_UI_THEME,
  name: "LifeOS",
  uiApiVersion: LIFEOS_UI_API_VERSION,
};

export const defaultLifeOSRenderers: LifeOSRenderers = {
  AppSidebar,
  TaskDrawer,
  AiDrawer,
  RulesDrawer,
  TaskBoard,
  TaskRow: DefaultTaskRow,
  CalendarView,
  GanttView,
};

const defaultRegistry: LifeOSUIRegistry = {
  theme: defaultLifeOSTheme,
  renderers: defaultLifeOSRenderers,
};

const LifeOSUIContext = createContext<LifeOSUIRegistry>(defaultRegistry);

export interface LifeOSUIProviderProps {
  children: ReactNode;
  theme?: LifeOSThemeManifest;
  renderers?: Partial<LifeOSRenderers>;
}

export function LifeOSUIProvider({
  children,
  theme = defaultLifeOSTheme,
  renderers,
}: LifeOSUIProviderProps): ReactElement {
  if (theme.uiApiVersion !== LIFEOS_UI_API_VERSION) {
    throw new Error(`UI theme ${theme.id} requires unsupported API ${theme.uiApiVersion}`);
  }
  const value = useMemo<LifeOSUIRegistry>(() => ({
    theme,
    renderers: { ...defaultLifeOSRenderers, ...renderers },
  }), [renderers, theme]);

  useEffect(() => {
    setUiTheme(theme.id);
    return applyUiThemeTokens(theme.tokens);
  }, [theme.id, theme.tokens]);

  return <LifeOSUIContext.Provider value={value}>{children}</LifeOSUIContext.Provider>;
}

export function useLifeOSUI(): LifeOSUIRegistry {
  return useContext(LifeOSUIContext);
}
