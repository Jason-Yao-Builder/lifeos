import { describe, expect, it, vi } from "vitest";
import {
  defaultTaskEditorPlaceholders,
  loadRollForwardDate,
  loadTaskEditorPlaceholders,
  saveRollForwardDate,
  saveTaskEditorPlaceholders,
  validRollForwardDate,
} from "./preferences";

describe("roll-forward preference", () => {
  it("defaults and clamps stale or invalid dates to today", () => {
    expect(validRollForwardDate(null, "2026-08-25")).toBe("2026-08-25");
    expect(validRollForwardDate("2026-08-24", "2026-08-25")).toBe("2026-08-25");
    expect(validRollForwardDate("not-a-date", "2026-08-25")).toBe("2026-08-25");
    expect(validRollForwardDate("2026-08-28", "2026-08-25")).toBe("2026-08-28");
  });

  it("loads and saves through injected storage", () => {
    expect(loadRollForwardDate("2026-08-25", { getItem: () => "2026-08-28" })).toBe("2026-08-28");
    const setItem = vi.fn();
    saveRollForwardDate("2026-08-29", { setItem });
    expect(setItem).toHaveBeenCalledWith("lifeos.rollForwardTargetDate", "2026-08-29");
  });
});

describe("task editor placeholder preference", () => {
  it("falls back safely and preserves per-field text and switches", () => {
    expect(loadTaskEditorPlaceholders()).toEqual(defaultTaskEditorPlaceholders);
    expect(loadTaskEditorPlaceholders({ getItem: () => "invalid json" }))
      .toEqual(defaultTaskEditorPlaceholders);
    expect(loadTaskEditorPlaceholders({
      getItem: () => JSON.stringify({
        title: { enabled: false, text: "写下任务" },
        tags: { enabled: true, text: "逗号分隔" },
      }),
    })).toEqual({
      title: { enabled: false, text: "写下任务" },
      description: defaultTaskEditorPlaceholders.description,
      tags: { enabled: true, text: "逗号分隔" },
    });
  });

  it("saves one preference payload", () => {
    const setItem = vi.fn();
    saveTaskEditorPlaceholders(defaultTaskEditorPlaceholders, { setItem });
    expect(setItem).toHaveBeenCalledWith(
      "lifeos.taskEditorPlaceholders",
      JSON.stringify(defaultTaskEditorPlaceholders),
    );
  });
});
