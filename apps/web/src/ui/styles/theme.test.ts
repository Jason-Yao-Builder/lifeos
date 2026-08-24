import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI_THEME,
  applyUiThemeTokens,
  getUiTheme,
  initializeUiTheme,
  normalizeUiThemeName,
  setUiTheme,
  uiThemeTokenNames,
} from "./theme";

function themeTarget(theme?: string): Pick<HTMLElement, "dataset"> {
  return { dataset: theme === undefined ? {} : { theme } } as Pick<HTMLElement, "dataset">;
}

describe("UI theme contract", () => {
  it("normalizes safe custom theme names and rejects selector-unsafe input", () => {
    expect(normalizeUiThemeName("  MIDNIGHT_blue-2 ")).toBe("midnight_blue-2");
    expect(normalizeUiThemeName("theme with spaces")).toBe(DEFAULT_UI_THEME);
    expect(normalizeUiThemeName("")).toBe(DEFAULT_UI_THEME);
  });

  it("reads, applies and initializes the data-theme contract", () => {
    const target = themeTarget();

    expect(initializeUiTheme(undefined, target)).toBe(DEFAULT_UI_THEME);
    expect(target.dataset.theme).toBe(DEFAULT_UI_THEME);
    expect(setUiTheme("contrast", target)).toBe("contrast");
    expect(getUiTheme(target)).toBe("contrast");
    expect(initializeUiTheme(undefined, target)).toBe("contrast");
  });

  it("declares every public token and fixes the cascade layer contract", () => {
    const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    const entry = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    const lifeosTheme = readFileSync(new URL("./themes/lifeos.css", import.meta.url), "utf8");

    for (const token of uiThemeTokenNames) {
      expect(tokens).toContain(`--${token}:`);
    }
    expect(entry).toContain("@layer reset, tokens, primitives, components, themes, utilities, overrides;");
    expect(lifeosTheme).toContain(':root[data-theme="lifeos"]');
  });

  it("applies manifest token values and removes only values it owns", () => {
    const values = new Map<string, string>();
    const target = {
      style: {
        setProperty: (name: string, value: string) => values.set(name, value),
        removeProperty: (name: string) => values.delete(name),
      },
    } as unknown as Pick<HTMLElement, "style">;

    const dispose = applyUiThemeTokens({
      "ui-color-accent": " #315b96 ",
      "ui-radius-md": "4px",
    }, target);
    expect(values.get("--ui-color-accent")).toBe("#315b96");
    expect(values.get("--ui-radius-md")).toBe("4px");

    dispose();
    expect(values.size).toBe(0);
  });
});
