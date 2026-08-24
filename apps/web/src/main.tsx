import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LifeOSUIProvider } from "./ui";
import { initializeUiTheme } from "./ui/styles";
import "./ui/styles/index.css";
import "./ui/styles/reset.css";
import "./ui/styles/tokens.css";
import "./ui/primitives/primitives.css";
import "./styles.css";
import "./ui/styles/themes/lifeos.css";
import "./ui/styles/utilities.css";

initializeUiTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LifeOSUIProvider>
      <App />
    </LifeOSUIProvider>
  </StrictMode>,
);
