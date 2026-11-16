import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/java/register.js";
import "monaco-editor/languages/definitions/kotlin/register.js";
import "monaco-editor/languages/definitions/ini/register.js";
import "monaco-editor/languages/definitions/xml/register.js";
import "monaco-editor/languages/definitions/yaml/register.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/definitions/shell/register.js";
import "monaco-editor/languages/definitions/bat/register.js";
import "monaco-editor/languages/features/json/register.js";
// editor.api has no editor contributions; Java completion (Q240) needs the suggest widget, snippet insertion and hover.
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";

/* Monaco for code project mode: syntax colouring for mod sources, Workbench colours, no network. */

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: (_id, label) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};

monaco.editor.defineTheme("mcedge-dark", {
  base: "vs-dark", inherit: true, rules: [
    { token: "keyword", foreground: "f2a53a" }, { token: "string", foreground: "9fd067" }, { token: "number", foreground: "ffcf7a" },
    { token: "comment", foreground: "8a7660", fontStyle: "italic" }, { token: "type", foreground: "e6c48f" }, { token: "annotation", foreground: "d38cf0" },
  ],
  colors: {
    "editor.background": "#15100c", "editor.foreground": "#f4e8d6", "editorLineNumber.foreground": "#6b5840", "editorLineNumber.activeForeground": "#f2a53a",
    "editor.lineHighlightBackground": "#261d16", "editor.selectionBackground": "#7a451288", "editorCursor.foreground": "#f2a53a",
    "editorWidget.background": "#2e2319", "editorIndentGuide.background1": "#2a2018", "scrollbarSlider.background": "#4d3b2a88",
  },
});
monaco.editor.defineTheme("mcedge-light", {
  base: "vs", inherit: true, rules: [
    { token: "keyword", foreground: "b05d06" }, { token: "string", foreground: "3f7a1a" }, { token: "number", foreground: "8a6400" },
    { token: "comment", foreground: "8a7a62", fontStyle: "italic" }, { token: "type", foreground: "6a3500" }, { token: "annotation", foreground: "8a3aa8" },
  ],
  colors: {
    "editor.background": "#f7f0e2", "editor.foreground": "#231a10", "editorLineNumber.foreground": "#a8957a", "editorLineNumber.activeForeground": "#b05d06",
    "editor.lineHighlightBackground": "#efe5d2", "editor.selectionBackground": "#d98a2b55", "editorCursor.foreground": "#b05d06",
    "editorWidget.background": "#f3ead9",
  },
});

const LANGUAGES: Record<string, string> = {
  java: "java", kt: "kotlin", kts: "kotlin", gradle: "java", json: "json", mcmeta: "json", properties: "ini", toml: "ini", cfg: "ini",
  xml: "xml", yml: "yaml", yaml: "yaml", md: "markdown", sh: "shell", bat: "bat", cmd: "bat", lang: "ini",
};

export function languageOf(path: string): string {
  if (/(^|\/)gradlew$/.test(path)) return "shell";
  return LANGUAGES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "plaintext";
}

export { monaco };
