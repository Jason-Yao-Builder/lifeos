import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LifeOSApi } from "./api";
import { CalendarView } from "./CalendarView";

describe("CalendarView", () => {
  it("renders an SSR-safe full-title month picker", () => {
    const markup = renderToStaticMarkup(createElement(CalendarView, {
      api: {} as LifeOSApi,
      tasks: [],
      onOpen: vi.fn(),
      onTaskSaved: vi.fn(),
      onToast: vi.fn(),
    }));

    expect(markup).toContain("calendar-period-trigger");
    expect(markup).toContain('type="month"');
    expect(markup).toContain('aria-label="选择年月');
  });
});
