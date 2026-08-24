import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LifeOSApi } from "./api";
import { CalendarView, scrollCalendarAtPointerEdge } from "./CalendarView";
import { calendarRange, moveTaskInCalendar } from "./features/calendar/useCalendarController";
import type { CalendarData, Task } from "./types";

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
    expect(markup).toContain('<h1 id="task-views-title">视图</h1>');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('id="task-view-tab-calendar"');
    expect(markup).toContain('aria-selected="true"');
  });

  it("auto-scrolls the calendar grid wrapper at either viewport edge", () => {
    const scrollBy = vi.fn();
    const closest = vi.fn(() => ({ scrollBy }));
    const currentTarget = { closest } as unknown as HTMLElement;

    scrollCalendarAtPointerEdge(currentTarget, 20, 390);
    scrollCalendarAtPointerEdge(currentTarget, 370, 390);
    scrollCalendarAtPointerEdge(currentTarget, 195, 390);

    expect(closest).toHaveBeenCalledTimes(2);
    expect(closest).toHaveBeenNthCalledWith(1, ".calendar-scroll");
    expect(closest).toHaveBeenNthCalledWith(2, ".calendar-scroll");
    expect(scrollBy).toHaveBeenNthCalledWith(1, { left: -18 });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { left: 18 });
  });

  it("keeps date projection logic independent from the renderer", () => {
    const task = {
      id: "task-1",
      plannedDate: "2026-08-24",
      repeatTemplateId: null,
    } as Task;
    const data: CalendarData = {
      days: {
        "2026-08-24": { tasks: [task], deadlineTasks: [], repeatTasks: [] },
      },
    };

    expect(calendarRange("2026-08-24", "week")).toHaveLength(7);
    expect(moveTaskInCalendar(data, task, "2026-08-25").days["2026-08-25"]?.tasks)
      .toMatchObject([{ id: task.id, plannedDate: "2026-08-25" }]);
    expect(data.days["2026-08-24"]?.tasks).toEqual([task]);
  });
});
