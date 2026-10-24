import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter"; // self-hosted font, no Google Fonts request
import "./index.css";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import { StoreProvider } from "./lib/store";
import { ToastProvider } from "./components/ui";

createRoot(document.getElementById("root")!).render(
  <I18nProvider><ToastProvider><StoreProvider><App /></StoreProvider></ToastProvider></I18nProvider>,
);

// Service worker: relative URL -> scope follows the install path. A new release ships a new
// cache version; the new worker takes over and the page reloads once.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker?.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => { if (w.state === "activated" && navigator.serviceWorker.controller) location.reload(); });
      });
    }).catch(() => {});
  });
}
