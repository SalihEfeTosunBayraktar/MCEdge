import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { watchListKeys, watchRowLabels } from "./a11y.ts";
import { restorePanelWidth } from "./components/ui.tsx";
import "./styles.css";

restorePanelWidth();
watchRowLabels();
watchListKeys();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
