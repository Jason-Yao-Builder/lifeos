import { describe, expect, it, vi } from "vitest";
import { calculateCompositeScore, mergeTags, openDatePicker } from "./utils";

describe("mergeTags", () => {
  it("keeps existing tags while adding comma-separated values", () => {
    expect(mergeTags(["个人成长"], "开发, 产品，复盘")).toEqual([
      "个人成长",
      "开发",
      "产品",
      "复盘",
    ]);
  });

  it("ignores empty and duplicate tags", () => {
    expect(mergeTags(["开发"], " 开发, ,学习 ")).toEqual(["开发", "学习"]);
  });

  it("enforces the contract limits", () => {
    const existing = Array.from({ length: 49 }, (_, index) => `标签${index}`);
    const result = mergeTags(existing, `${"长".repeat(60)},最后一个,被忽略`);
    expect(result).toHaveLength(50);
    expect(result[49]).toHaveLength(50);
  });
});

describe("priority scoring", () => {
  it("uses effort as a cost when previewing a manual score", () => {
    expect(calculateCompositeScore({ impact: 80, urgency: 60, alignment: 90, effort: 40 })).toBe(74.5);
  });
});

describe("date picker activation", () => {
  it("opens the picker without selecting a date segment first", () => {
    const showPicker = vi.fn();
    const focus = vi.fn();
    openDatePicker({ showPicker, focus } as unknown as HTMLInputElement);
    expect(showPicker).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
  });

  it("leaves native click handling untouched when showPicker is unavailable", () => {
    const focus = vi.fn();
    openDatePicker({ focus } as unknown as HTMLInputElement);
    expect(focus).not.toHaveBeenCalled();
  });
});
