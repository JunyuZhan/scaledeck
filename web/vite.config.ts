import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The SPA is served by headscale itself under /ui, so the base path must match.
// Build output is written straight into the Go package so it can be embedded.
//
// In the GitHub Pages demo build (VITE_DEMO="1") we use a relative base so the
// static bundle works at the repository's Pages subpath (e.g. /scaledeck/)
// without any server-side rewrite rules.
const isDemo = process.env.VITE_DEMO === "1";

export default defineConfig({
  plugins: [react()],
  base: isDemo ? "./" : "/ui/",
  build: {
    outDir: "../hscontrol/webui/dist",
    emptyOutDir: true,
  },
});
