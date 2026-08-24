import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LIFEOS_UI_API_VERSION,
  LifeOSUIProvider,
  defaultLifeOSRenderers,
  lifeOSRendererSlots,
  useLifeOSUI,
  type LifeOSRenderers,
} from "./registry";

function Probe(): ReactElement {
  const ui = useLifeOSUI();
  return <span>{ui.theme.id}:{ui.renderers.TaskRow.name}</span>;
}

describe("LifeOS UI registry", () => {
  it("provides default renderers without requiring a provider", () => {
    expect(Object.keys(defaultLifeOSRenderers).sort()).toEqual([...lifeOSRendererSlots].sort());
    expect(defaultLifeOSRenderers.AppSidebar).toBeTypeOf("function");
    expect(defaultLifeOSRenderers.TaskDrawer).toBeTypeOf("function");
    expect(defaultLifeOSRenderers.AiDrawer).toBeTypeOf("function");
    expect(defaultLifeOSRenderers.RulesDrawer).toBeTypeOf("function");
    expect(defaultLifeOSRenderers.TaskBoard).toBeTypeOf("function");
    expect(defaultLifeOSRenderers.CalendarView).toBeTypeOf("function");
    expect(defaultLifeOSRenderers.GanttView).toBeTypeOf("function");
  });

  it("merges a renderer override while retaining every default slot", () => {
    function AlternateTaskRow(): ReactElement {
      return <div data-slot="alternate-task-row" />;
    }
    const markup = renderToStaticMarkup(createElement(LifeOSUIProvider, {
      theme: { id: "test", name: "Test", uiApiVersion: LIFEOS_UI_API_VERSION },
      renderers: { TaskRow: AlternateTaskRow } satisfies Partial<LifeOSRenderers>,
      children: <Probe />,
    }));

    expect(markup).toContain("test:AlternateTaskRow");
  });

  it("rejects a theme built against an incompatible UI API", () => {
    expect(() => renderToStaticMarkup(createElement(LifeOSUIProvider, {
      theme: { id: "future", name: "Future", uiApiVersion: 2 as 1 },
      children: <Probe />,
    }))).toThrow("unsupported API");
  });
});
