import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

/**
 * Monaco's `.rendered-markdown li:has(input[type=checkbox])` makes every forced style recalculation of the page cost
 * ~4 ms instead of ~0.01 ms once a big Blockly program is on screen (Blockly measures each new field text with
 * getComputedStyle, thousands of times when it opens or shows a flyout). The rule only hides the bullet of task-list
 * items in Monaco's markdown hovers (MCEdge's hovers have no task lists); it is dropped (KUYRUK 185).
 */
const dropCostlyMonacoRule = (): Plugin => ({
  name: "mcedge-drop-costly-monaco-rule",
  enforce: "pre",
  transform(code, id) {
    if (!/renderedMarkdown\.css(\?|$)/.test(id)) return undefined;
    const next = code.replace(/\.rendered-markdown li:has\(input\[type=checkbox\]\)\s*\{[^}]*\}/, "");
    if (next === code) throw new Error("renderedMarkdown.css changed: review the dropped :has() rule");
    return { code: next, map: null };
  },
});

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, "app/main/index.ts") } } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "app/preload/index.ts") },
        // CommonJS preload keeps the renderer sandbox enabled.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "app/renderer"),
    build: { rollupOptions: { input: { index: resolve(__dirname, "app/renderer/index.html") } } },
    plugins: [dropCostlyMonacoRule(), react()],
  },
});
