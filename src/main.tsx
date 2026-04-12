import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SplashScreen from "./SplashScreen";
import { LOCK_SPLASH_FOR_DEV } from "./devFlags";
import "./index.css";

const isTauriRuntime = Boolean(
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
);

const RootComponent = LOCK_SPLASH_FOR_DEV && !isTauriRuntime ? SplashScreen : App;

if (RootComponent === SplashScreen) {
  document.documentElement.dataset.splash = 'true';
  document.body.dataset.splash = 'true';
} else {
  delete document.documentElement.dataset.splash;
  delete document.body.dataset.splash;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
