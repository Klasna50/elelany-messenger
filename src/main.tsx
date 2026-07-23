import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import InstallPrompt from "./InstallPrompt";
import "./index.css";

// Register the service worker only on the web. The Electron desktop build is
// served over file://, where service workers don't apply and registering one
// throws; the desktop app already updates itself through electron-updater.
if (typeof window !== "undefined" && window.location.protocol.startsWith("http")) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <InstallPrompt />
  </StrictMode>
);
