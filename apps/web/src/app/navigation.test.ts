import { describe, expect, it } from "vitest";
import {
  emptyTaskFilters,
  pathForView,
  reviewRouteForPathname,
  taskFiltersForHistoryEntry,
  taskGroupPath,
  taskHistoryState,
  viewForPathname,
} from "./navigation";

describe("application navigation controller", () => {
  it("maps browser locations into stable application routes", () => {
    expect(viewForPathname("/review/weekly/2026-08-24")).toBe("review");
    expect(viewForPathname("/calendar")).toBe("calendar");
    expect(viewForPathname("/unknown")).toBe("tasks");
    expect(reviewRouteForPathname("/review/monthly/2026-08-01", "2026-08-24"))
      .toEqual({ type: "monthly", date: "2026-08-01" });
    expect(reviewRouteForPathname("/review/invalid/nope", "2026-08-24"))
      .toEqual({ type: "daily", date: "2026-08-24" });
    expect(pathForView("review", { type: "weekly", date: "2026-08-24" }))
      .toBe("/review/weekly/2026-08-24");
    expect(pathForView("settings", { type: "daily", date: "2026-08-24" }))
      .toBe("/settings");
  });

  it("keeps transient filters in history and URL facets authoritative", () => {
    const stored = {
      ...emptyTaskFilters,
      status: "in_progress" as const,
      tag: "API",
      time: "target_future" as const,
    };
    const state = taskHistoryState(stored, { preserved: true });
    expect(taskFiltersForHistoryEntry(
      "/tasks",
      "?group=workspace&temperature=hot",
      state,
    )).toEqual({ ...stored, group: "workspace", temperature: "hot" });
    expect(state.preserved).toBe(true);
    expect(taskGroupPath("workspace", "hot")).toBe("/tasks?group=workspace&temperature=hot");
  });
});
