import { describe, expect, it } from "vitest";
import { isSettingsArea, viewForPathname } from "./App";

describe("application navigation", () => {
  it("keeps settings and goals as distinct direct routes", () => {
    expect(viewForPathname("/settings")).toBe("settings");
    expect(viewForPathname("/goals")).toBe("goals");
    expect(viewForPathname("/review/weekly/2026-08-24")).toBe("review");
    expect(viewForPathname("/unknown")).toBe("tasks");
  });

  it("treats goals as part of the settings area for navigation state", () => {
    expect(isSettingsArea("settings")).toBe(true);
    expect(isSettingsArea("goals")).toBe(true);
    expect(isSettingsArea("tasks")).toBe(false);
  });
});
