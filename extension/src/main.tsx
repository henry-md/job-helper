import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installDebugChromeRuntime } from "./debug-chrome";
import "./index.css";

if (import.meta.env.DEV) {
  installDebugChromeRuntime();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
