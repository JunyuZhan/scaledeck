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
const Router = import.meta.env.VITE_DEMO ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router basename="/ui">
      <App />
    </Router>
  </React.StrictMode>,
);
