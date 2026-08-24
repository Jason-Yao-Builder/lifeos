export const uiPrimitiveClassNames = {
  button: "ui-button",
  cluster: "ui-cluster",
  field: "ui-field",
  iconButton: "ui-icon-button",
  stack: "ui-stack",
  surface: "ui-surface",
} as const;

export const uiPrimitiveAttributes = {
  variant: "data-variant",
} as const;

export const uiButtonVariants = ["default", "primary", "ghost", "danger"] as const;

export type UiButtonVariant = (typeof uiButtonVariants)[number];
export type UiPrimitiveName = keyof typeof uiPrimitiveClassNames;
