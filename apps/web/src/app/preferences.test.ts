import { describe, expect, it, vi } from "vitest";
import { loadRollForwardDate, saveRollForwardDate, validRollForwardDate } from "./preferences";

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
