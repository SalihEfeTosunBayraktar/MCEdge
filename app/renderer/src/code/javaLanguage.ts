import type { JavaStatus, LspCompletionItem, LspDiagnostic, LspHover, LspRange, LspTextEdit } from "../../../../src/java/jdtls.ts";
import { matchResourceIds, stringAtCursor, type ResourceId } from "../../../../src/java/resourceIds.ts";
import { checkSides, type Side } from "../../../../src/java/sideCheck.ts";
import { api } from "../api.ts";
import { t, type StringKey } from "../strings.ts";
import { monaco } from "./monaco.ts";

const LSP_KINDS: (keyof typeof monaco.languages.CompletionItemKind)[] = [
  "Text", "Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module", "Property", "Unit", "Value", "Enum",
  "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter",
];
const SEVERITY = [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];
const SIDE_DELAY_MS = 300;

/**
 * Java editing of one code workspace: documents synced to the project's jdtls (main process), its completion,
 * hover and diagnostics in Monaco, the mod's own registry ids inside string literals, and side warnings
 * (client-only API in common/server code and the reverse) with the open file's side.
 */
export class JavaLanguage {
  private readonly dir: string;
  private readonly docs = new Map<monaco.editor.ITextModel, { path: string; dispose: () => void }>();
  private readonly lspItems = new WeakMap<monaco.languages.CompletionItem, LspCompletionItem>();
  private readonly disposables: { dispose(): void }[] = [];
  private resources?: Promise<ResourceId[]>;
  private onSide: (path: string, side: Side) => void;

  constructor(dir: string, onStatus: (status: JavaStatus) => void, onSide: (path: string, side: Side) => void) {
    this.dir = dir;
    this.onSide = onSide;
    const mine = (model: monaco.editor.ITextModel) => this.docs.get(model)?.path;
    this.disposables.push(
      monaco.languages.registerCompletionItemProvider("java", {
        triggerCharacters: [".", "\"", ":", "/", "@"],
        provideCompletionItems: (model, position) => {
          const path = mine(model);
          return path === undefined ? { suggestions: [] } : this.complete(model, path, position);
        },
        resolveCompletionItem: (item) => this.resolve(item),
      }),
      monaco.languages.registerHoverProvider("java", {
        provideHover: async (model, position) => {
          const path = mine(model);
          if (path === undefined) return null;
          const hover = await api.javaHover(dir, path, { line: position.lineNumber - 1, character: position.column - 1 });
          const contents = hoverContents(hover);
          return contents.length ? { contents, range: hover?.range && toRange(hover.range) } : null;
        },
      }),
      { dispose: api.onJavaStatus((status) => status.dir === dir && onStatus(status)) },
      { dispose: api.onJavaDiagnostics((event) => event.dir === dir && this.diagnostics(event.path, event.diagnostics)) },
    );
    void api.javaStatus(dir).then((status) => status && onStatus(status));
  }

  /** Starts syncing a Java model (opens jdtls on the first one) and checks its sides as it changes. */
  track(path: string, model: monaco.editor.ITextModel): void {
    if (model.getLanguageId() !== "java" || this.docs.has(model)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sides = () => {
      const report = checkSides(model.getValue());
      monaco.editor.setModelMarkers(model, "mcedge-side", report.markers.map((m) => ({
        severity: monaco.MarkerSeverity.Warning, source: "MCEdge",
        message: t(`java.side.${m.api}Api.${m.usedIn}` as StringKey, { name: m.name }),
        startLineNumber: m.line, startColumn: m.column, endLineNumber: m.line, endColumn: m.endColumn,
      })));
      this.onSide(path, report.side);
    };
    const listener = model.onDidChangeContent(() => {
      void api.javaChange(this.dir, path, model.getValue());
      clearTimeout(timer);
      timer = setTimeout(sides, SIDE_DELAY_MS);
    });
    this.docs.set(model, {
      path,
      dispose: () => {
        listener.dispose();
        clearTimeout(timer);
      },
    });
    void api.javaOpen(this.dir, path, model.getValue());
    sides();
  }

  untrack(model: monaco.editor.ITextModel): void {
    const doc = this.docs.get(model);
    if (!doc) return;
    doc.dispose();
    this.docs.delete(model);
    void api.javaClose(this.dir, doc.path);
  }

  /** Resource files changed: the registry ids are read again on the next completion. */
  invalidateResources(): void {
    this.resources = undefined;
  }

  dispose(): void {
    for (const model of [...this.docs.keys()]) this.untrack(model);
    this.disposables.forEach((d) => d.dispose());
    void api.javaStop(this.dir);
  }

  private async complete(model: monaco.editor.ITextModel, path: string, position: monaco.Position): Promise<monaco.languages.CompletionList> {
    const line = model.getLineContent(position.lineNumber);
    const inString = stringAtCursor(line, position.column - 1);
    if (inString) {
      // Inside a string: the mod's own ids and resource paths, replacing what is typed up to the closing quote.
      this.resources ??= api.javaResources(this.dir);
      const ids = matchResourceIds(await this.resources, inString.prefix);
      const close = line.indexOf("\"", position.column - 1);
      const insert = new monaco.Range(position.lineNumber, inString.start + 1, position.lineNumber, position.column);
      const replace = new monaco.Range(position.lineNumber, inString.start + 1, position.lineNumber, close < 0 ? position.column : close + 1);
      return {
        suggestions: ids.map((entry, i) => ({
          label: { label: entry.id, description: entry.kinds.map((k) => t(`java.kind.${k}` as StringKey)).join(", ") },
          kind: entry.kinds.includes("path") ? monaco.languages.CompletionItemKind.File : monaco.languages.CompletionItemKind.Value,
          detail: t("java.fromMod"), insertText: entry.id, filterText: entry.id, sortText: String(i).padStart(5, "0"), range: { insert, replace },
        })),
      };
    }
    const result = await api.javaComplete(this.dir, path, { line: position.lineNumber - 1, character: position.column - 1 });
    const word = model.getWordUntilPosition(position);
    const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column);
    const suggestions = result.items.map((item) => {
      const edit = item.textEdit;
      const range = !edit ? fallback : "range" in edit ? toRange(edit.range) : { insert: toRange(edit.insert), replace: toRange(edit.replace) };
      const suggestion: monaco.languages.CompletionItem = {
        label: item.labelDetails ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description } : item.label,
        kind: monaco.languages.CompletionItemKind[LSP_KINDS[item.kind ?? 1] ?? "Text"],
        detail: item.detail, documentation: doc(item.documentation), sortText: item.sortText, filterText: item.filterText,
        insertText: edit?.newText ?? item.insertText ?? item.label, range,
        insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        additionalTextEdits: item.additionalTextEdits?.map(toEdit),
      };
      this.lspItems.set(suggestion, item);
      return suggestion;
    });
    return { suggestions, incomplete: result.incomplete };
  }

  private async resolve(item: monaco.languages.CompletionItem): Promise<monaco.languages.CompletionItem> {
    const lsp = this.lspItems.get(item);
    if (!lsp) return item;
    const resolved = await api.javaResolve(this.dir, lsp);
    return {
      ...item, detail: resolved.detail ?? item.detail, documentation: doc(resolved.documentation) ?? item.documentation,
      additionalTextEdits: resolved.additionalTextEdits?.map(toEdit) ?? item.additionalTextEdits,
    };
  }

  private diagnostics(path: string, diagnostics: LspDiagnostic[]): void {
    const model = [...this.docs].find(([, d]) => d.path === path)?.[0];
    if (!model || model.isDisposed()) return;
    monaco.editor.setModelMarkers(model, "java", diagnostics.map((d) => ({
      ...toRange(d.range), severity: SEVERITY[d.severity ?? 1] ?? monaco.MarkerSeverity.Info, message: d.message, source: "Java",
      code: d.code === undefined ? undefined : String(d.code),
    })));
  }
}

function toRange(range: LspRange): monaco.IRange {
  return { startLineNumber: range.start.line + 1, startColumn: range.start.character + 1, endLineNumber: range.end.line + 1, endColumn: range.end.character + 1 };
}

function toEdit(edit: LspTextEdit): monaco.languages.TextEdit {
  return { range: toRange(edit.range), text: edit.newText };
}

function doc(documentation: LspCompletionItem["documentation"]): monaco.IMarkdownString | string | undefined {
  if (!documentation) return undefined;
  if (typeof documentation === "string") return documentation;
  return documentation.kind === "markdown" ? { value: documentation.value } : documentation.value;
}

function hoverContents(hover: LspHover | null): monaco.IMarkdownString[] {
  if (!hover) return [];
  const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  return parts
    .map((part) => (typeof part === "string" ? part : "language" in part && part.language ? `\`\`\`${part.language}\n${part.value}\n\`\`\`` : part.value))
    .filter((value) => value.trim())
    .map((value) => ({ value }));
}
