import type { LifeOSThemeManifest } from "../registry";
import "../styles/themes/paper.css";

export const paperTheme = {
  id: "paper",
  name: "Paper",
  uiApiVersion: 1,
} as const satisfies LifeOSThemeManifest;
