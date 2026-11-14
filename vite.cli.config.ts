import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * The core CLI and MCP server bundled for the installed app (app/cli/index.ts -> out/cli/index.js). A build of its own,
 * not a second input of electron-vite's main build: two entries would share a chunk holding ROOT, and a shared chunk
 * runs before either entry's env module sets MCEDGE_ROOT. Dependencies stay external and load from the app's
 * node_modules.
 */
export default defineConfig({
  build: {
    ssr: resolve(import.meta.dirname, "app/cli/index.ts"),
    outDir: "out/cli",
    target: "node22",
    rollupOptions: { output: { entryFileNames: "index.js" } },
  },
});
