import { describe, expect, it } from "vitest";
import { mergeTags } from "./utils";

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
