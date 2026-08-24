import { describe, expect, it } from "vitest";
import {
  uiButtonVariants,
  uiPrimitiveAttributes,
  uiPrimitiveClassNames,
} from "./contracts";

describe("unbranded UI primitive contract", () => {
  it("exposes stable semantic classes and variant attributes", () => {
    expect(uiPrimitiveClassNames).toEqual({
      button: "ui-button",
      cluster: "ui-cluster",
      field: "ui-field",
      iconButton: "ui-icon-button",
      stack: "ui-stack",
      surface: "ui-surface",
    });
    expect(uiPrimitiveAttributes.variant).toBe("data-variant");
    expect(uiButtonVariants).toEqual(["default", "primary", "ghost", "danger"]);
  });
});
