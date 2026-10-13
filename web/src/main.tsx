import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { initTheme } from "./lib/theme";
import { installMock } from "./api/mock";

initTheme();
// In the GitHub Pages demo build, replace the real backend with an in-memory
// mock so the UI runs entirely client-side. No-op in a normal build.
installMock();

// GitHub Pages serves under a subpath (https://<user>.github.io/scaledeck/).
// HashRouter keeps every route client-side so deep links work with zero server
// configuration; the production build keeps the cleaner BrowserRouter.
//
// The basename only applies to the real deployment, which headscale serves
// under /ui. The demo lives at /scaledeck/ and carries its route in the hash,
// so basename="/ui" there would not match (the hash path is "/"), and
// react-router renders nothing -> a blank page. Only set it for production.
const isDemo = import.meta.env.VITE_DEMO === "1";
const Router = isDemo ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router basename={isDemo ? undefined : "/ui"}>
      <App />
    </Router>
  </React.StrictMode>,
);
