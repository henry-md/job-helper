import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installDebugChromeRuntime } from "./debug-chrome";
import "./index.css";

const shouldInstallDebugChromeRuntime =
  import.meta.env.DEV ||
  new URLSearchParams(globalThis.location.search).get("debugChrome") === "1";

if (shouldInstallDebugChromeRuntime) {
  installDebugChromeRuntime();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
