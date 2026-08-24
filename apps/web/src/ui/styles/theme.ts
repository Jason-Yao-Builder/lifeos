export const DEFAULT_UI_THEME = "lifeos";
export const UI_THEME_ATTRIBUTE = "data-theme";

export const uiThemeTokenNames = [
  "ui-color-text",
  "ui-color-text-muted",
  "ui-color-text-subtle",
  "ui-color-border",
  "ui-color-border-strong",
  "ui-color-surface",
  "ui-color-surface-subtle",
  "ui-color-document",
  "ui-color-canvas",
  "ui-color-accent",
  "ui-color-accent-strong",
  "ui-color-accent-soft",
  "ui-color-on-accent",
  "ui-color-danger",
  "ui-color-focus-ring",
  "ui-color-overlay",
  "ui-font-family-sans",
  "ui-font-size-xs",
  "ui-font-size-sm",
  "ui-font-size-md",
  "ui-font-size-lg",
  "ui-font-size-xl",
  "ui-font-size-2xl",
  "ui-font-weight-regular",
  "ui-font-weight-medium",
  "ui-font-weight-semibold",
  "ui-font-weight-bold",
  "ui-line-height-tight",
  "ui-line-height-normal",
  "ui-space-0",
  "ui-space-1",
  "ui-space-2",
  "ui-space-3",
  "ui-space-4",
  "ui-space-5",
  "ui-space-6",
  "ui-space-7",
  "ui-space-8",
  "ui-space-10",
  "ui-space-12",
  "ui-radius-xs",
  "ui-radius-sm",
  "ui-radius-md",
  "ui-radius-lg",
  "ui-radius-xl",
  "ui-radius-round",
  "ui-shadow-sm",
  "ui-shadow-md",
  "ui-shadow-lg",
  "ui-duration-instant",
  "ui-duration-fast",
  "ui-duration-normal",
  "ui-duration-slow",
  "ui-ease-standard",
  "ui-ease-enter",
  "ui-ease-exit",
  "ui-z-base",
  "ui-z-sticky",
  "ui-z-popover",
  "ui-z-overlay",
  "ui-z-drawer",
  "ui-z-toast",
  "ui-z-modal",
  "ui-size-control-sm",
  "ui-size-control-md",
  "ui-size-control-lg",
  "ui-size-sidebar",
  "ui-size-content-max",
  "ui-opacity-disabled",
] as const;

export type UiThemeTokenName = (typeof uiThemeTokenNames)[number];
export type UiThemeTarget = Pick<HTMLElement, "dataset">;
export type UiThemeStyleTarget = Pick<HTMLElement, "style">;
export type UiThemeTokenValues = Readonly<Partial<Record<UiThemeTokenName, string>>>;

export function normalizeUiThemeName(theme: string | null | undefined): string {
  const candidate = theme?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9_-]*$/.test(candidate) ? candidate : DEFAULT_UI_THEME;
}

export function getUiTheme(target: UiThemeTarget = document.documentElement): string {
  return normalizeUiThemeName(target.dataset.theme);
}

export function setUiTheme(
  theme: string,
  target: UiThemeTarget = document.documentElement,
): string {
  const normalized = normalizeUiThemeName(theme);
  target.dataset.theme = normalized;
  return normalized;
}

export function initializeUiTheme(
  theme?: string | null,
  target: UiThemeTarget = document.documentElement,
): string {
  return setUiTheme(theme ?? target.dataset.theme ?? DEFAULT_UI_THEME, target);
}

export function applyUiThemeTokens(
  tokens: UiThemeTokenValues | undefined,
  target: UiThemeStyleTarget = document.documentElement,
): () => void {
  const applied: string[] = [];
  for (const name of uiThemeTokenNames) {
    const value = tokens?.[name]?.trim();
    if (!value) continue;
    const property = `--${name}`;
    target.style.setProperty(property, value);
    applied.push(property);
  }
  return () => {
    for (const property of applied) target.style.removeProperty(property);
  };
}
