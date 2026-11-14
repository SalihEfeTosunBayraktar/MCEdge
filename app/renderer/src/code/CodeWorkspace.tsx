import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeFile, CodeProjectInfo } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { ActionBar, ActionButton, Dialog, FindBar, FormGroup, FormRow, Separator } from "../components/ui.tsx";
import { beginSave } from "../saveStatus.ts";
import { t } from "../strings.ts";
import { languageOf, monaco } from "./monaco.ts";

interface OpenFile {
  path: string;
  model?: monaco.editor.ITextModel;
  binary: boolean;
  /** Edited here and not saved yet. */
  dirty: boolean;
  /** Changed on disk while it had unsaved edits here; the user picks which to keep. */
  diskChanged: boolean;
  /** The last outside change was loaded into the editor (shown briefly on the tab). */
  reloaded: boolean;
  view?: monaco.editor.ICodeEditorViewState | null;
}

interface Props {
  project: CodeProjectInfo;
  theme: "dark" | "light";
  building: boolean;
  running: boolean;
  onBuild: () => void;
  onRun: () => void;
  onStop: () => void;
  onExport: () => void;
}

/**
 * Code project mode: the file tree of a plain Gradle mod, Monaco tabs, and build / run / export with the mod's own
 * Gradle wrapper. Files changed on disk by someone else (an AI agent over MCP, git) reload in place; a file with
 * unsaved edits keeps them and offers Reload from disk instead.
 */
export function CodeWorkspace({ project, theme, building, running, onBuild, onRun, onStop, onExport }: Props) {
  const dir = project.dir;
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["src", "src/main", "src/main/java", "src/main/resources"]));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string>();
  const [creating, setCreating] = useState<"file" | "folder">();
  const [deleting, setDeleting] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  const activeRef = useRef(active);
  activeRef.current = active;

  const patch = (path: string, change: Partial<OpenFile>) => setOpen((list) => list.map((f) => (f.path === path ? { ...f, ...change } : f)));

  // ---- editor ----
  useEffect(() => {
    editor.current = monaco.editor.create(host.current!, {
      automaticLayout: true, fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono"), fontSize: 13,
      minimap: { enabled: true, scale: 1 }, scrollBeyondLastLine: false, theme: theme === "dark" ? "mcedge-dark" : "mcedge-light",
      model: null, tabSize: 4, insertSpaces: true,
      // Ctrl + wheel changes the code's font size (KUYRUK 179).
      mouseWheelZoom: true,
    });
    editor.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save(activeRef.current));
    return () => {
      editor.current?.dispose();
      openRef.current.forEach((f) => f.model?.dispose());
    };
    // One editor per code workspace; files swap models.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => monaco.editor.setTheme(theme === "dark" ? "mcedge-dark" : "mcedge-light"), [theme]);
  useEffect(() => {
    const file = open.find((f) => f.path === active);
    const e = editor.current;
    if (!e) return;
    e.setModel(file?.model ?? null);
    if (file?.view) e.restoreViewState(file.view);
    if (file?.model) e.focus();
    // Switching tabs only; edits do not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- files ----
  const refreshTree = () => api.codeTree(dir).then(setFiles);
  useEffect(() => void refreshTree(), [dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = async (path: string) => {
    const existing = openRef.current.find((f) => f.path === path);
    if (existing) return switchTo(path);
    const { text, binary } = await api.codeRead(dir, path);
    const model = binary ? undefined : monaco.editor.createModel(text, languageOf(path), monaco.Uri.file(`${dir}/${path}`));
    model?.onDidChangeContent(() => {
      if (!(model as { mcedgeLoading?: boolean }).mcedgeLoading) patch(path, { dirty: true, reloaded: false });
    });
    setOpen((list) => [...list, { path, model, binary, dirty: false, diskChanged: false, reloaded: false }]);
    switchTo(path);
  };
  const switchTo = (path: string) => {
    const current = openRef.current.find((f) => f.path === activeRef.current);
    if (current && editor.current) current.view = editor.current.saveViewState();
    setActive(path);
  };
  const close = (path: string) => {
    const file = openRef.current.find((f) => f.path === path);
    file?.model?.dispose();
    const rest = openRef.current.filter((f) => f.path !== path);
    setOpen(rest);
    if (activeRef.current === path) setActive(rest.at(-1)?.path);
  };
  /** Replaces a model's text from disk as one undoable edit, keeping the cursor where it was. */
  const load = (model: monaco.editor.ITextModel, text: string) => {
    if (model.getValue() === text) return;
    const flagged = model as { mcedgeLoading?: boolean };
    flagged.mcedgeLoading = true;
    const selections = editor.current?.getModel() === model ? editor.current.getSelections() : null;
    model.pushEditOperations(selections ?? [], [{ range: model.getFullModelRange(), text }], () => selections);
    flagged.mcedgeLoading = false;
  };
  const save = async (path?: string) => {
    const file = openRef.current.find((f) => f.path === path);
    if (!file?.model) return;
    const end = beginSave();
    try {
      await api.codeWrite(dir, file.path, file.model.getValue());
      patch(file.path, { dirty: false, diskChanged: false });
    } finally {
      end();
    }
  };
  const reloadFromDisk = async (path?: string) => {
    const file = openRef.current.find((f) => f.path === path);
    if (!file?.model) return;
    load(file.model, (await api.codeRead(dir, file.path)).text);
    patch(file.path, { dirty: false, diskChanged: false, reloaded: true });
  };

  // ---- outside changes: MCP, other editors, git ----
  useEffect(() => api.onFsChange(async (change) => {
    if (change.dir !== dir) return;
    void refreshTree();
    for (const path of change.paths) {
      const file = openRef.current.find((f) => f.path === path);
      if (!file?.model) continue;
      let text: string;
      try {
        text = (await api.codeRead(dir, path)).text;
      } catch {
        patch(path, { diskChanged: true });
        continue;
      }
      if (text === file.model.getValue()) continue;
      if (file.dirty) patch(path, { diskChanged: true });
      else (load(file.model, text), patch(path, { reloaded: true, dirty: false }));
    }
  }), [dir]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- tree ----
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (q) return files.filter((f) => !f.folder && f.path.toLowerCase().includes(q));
    return files.filter((f) => {
      const parts = f.path.split("/");
      return parts.slice(0, -1).every((_, i) => expanded.has(parts.slice(0, i + 1).join("/")));
    });
  }, [files, expanded, q]);
  const toggle = (path: string) => setExpanded((set) => {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  const selectedFile = files.find((f) => f.path === selected);
  const baseFolder = selectedFile ? (selectedFile.folder ? selectedFile.path : selectedFile.path.split("/").slice(0, -1).join("/")) : "";
  const current = open.find((f) => f.path === active);

  return (
    <section className="view codeview">
      <FindBar query={query} onQuery={setQuery} placeholder={t("code.search")} meta={t("code.meta", { jdk: project.jdk, dir })} />
      <ActionBar>
        <ActionButton icon="check" label={t("code.save")} title="Ctrl+S" tone="primary" disabled={!current?.dirty} onClick={() => void save(active)} />
        <ActionButton icon="undo" label={t("code.reload")} disabled={!current?.diskChanged} onClick={() => void reloadFromDisk(active)} />
        <Separator />
        <ActionButton icon="plus" label={t("code.newFile")} onClick={() => setCreating("file")} />
        <ActionButton icon="folder" label={t("code.newFolder")} onClick={() => setCreating("folder")} />
        <ActionButton icon="trash" label={t("action.deleteSelected")} tone="danger" disabled={!selected} onClick={() => setDeleting(true)} />
        <Separator />
        <ActionButton icon="hammer" label={t("top.build")} disabled={building || !project.wrapper} onClick={onBuild} />
        {running
          ? <ActionButton icon="stop" label={t("top.stop")} tone="danger" onClick={onStop} />
          : <ActionButton icon="play" label={t("top.run")} disabled={building || !project.wrapper} onClick={onRun} />}
        <ActionButton icon="jar" label={t("code.export")} disabled={building || !project.wrapper} onClick={onExport} />
      </ActionBar>
      {!project.wrapper && <p className="notice codenotice">{t("code.noWrapper")}</p>}
      <div className="codebody">
        <nav className="codetree" role="tree" aria-label={t("code.files")}>
          {visible.map((f) => {
            const name = q ? f.path : f.path.slice(f.path.lastIndexOf("/") + 1);
            return (
              <button key={f.path} role="treeitem" aria-selected={f.path === selected} aria-expanded={f.folder ? expanded.has(f.path) : undefined}
                className={`trow ${f.path === selected ? "sel" : ""} ${f.path === active ? "act" : ""}`} title={f.path}
                style={{ paddingLeft: 8 + (q ? 0 : f.depth * 14) }}
                onClick={() => (setSelected(f.path), f.folder ? toggle(f.path) : void openFile(f.path))}>
                {f.folder ? <span className={`tchev ${expanded.has(f.path) ? "open" : ""}`}><Icon name="chev" size={10} /></span> : <span className="tchev" />}
                <Icon name={f.folder ? "folder" : "code"} size={12} />
                <span className="tname">{name}</span>
              </button>
            );
          })}
        </nav>
        <div className="codemain">
          <div className="codetabs" role="tablist">
            {open.map((f) => (
              <div key={f.path} role="tab" aria-selected={f.path === active} className={`ctab ${f.path === active ? "on" : ""} ${f.diskChanged ? "conflict" : ""}`}
                title={f.diskChanged ? t("code.changedOnDisk") : f.path} onClick={() => switchTo(f.path)}>
                <span>{f.path.slice(f.path.lastIndexOf("/") + 1)}</span>
                {f.dirty && <i className="cdirty" aria-label={t("code.unsaved")} />}
                {f.reloaded && !f.dirty && <span className="creload">{t("code.reloaded")}</span>}
                <button type="button" className="cclose" title={t("code.close")} onClick={(e) => (e.stopPropagation(), close(f.path))}><Icon name="close" size={10} /></button>
              </div>
            ))}
          </div>
          {current?.diskChanged && <p className="notice codenotice">{t("code.conflict")}</p>}
          <div className="codeeditor">
            <div ref={host} className="monacohost" style={{ visibility: current?.model ? "visible" : "hidden" }} />
            {!current && <p className="empty-note codeempty">{t("code.openHint")}</p>}
            {current?.binary && <p className="empty-note codeempty">{t("code.binary")}</p>}
          </div>
        </div>
      </div>
      {creating && (
        <NewEntryDialog folder={baseFolder} kind={creating} onCancel={() => setCreating(undefined)} onCreate={async (path) => {
          setFiles(await api.codeCreate(dir, path, creating === "folder"));
          setCreating(undefined);
          setExpanded((set) => new Set([...set, ...path.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))]));
          setSelected(path);
          if (creating === "file") void openFile(path);
        }} />
      )}
      {deleting && selected && (
        <Dialog title={t("code.deleteTitle")} okLabel={t("code.delete")} canOk onCancel={() => setDeleting(false)} onOk={async () => {
          setFiles(await api.codeDelete(dir, selected));
          openRef.current.filter((f) => f.path === selected || f.path.startsWith(`${selected}/`)).forEach((f) => close(f.path));
          setSelected(undefined);
          setDeleting(false);
        }}>
          <p className="hint">{t("code.deleteConfirm", { path: selected })}</p>
        </Dialog>
      )}
    </section>
  );
}

function NewEntryDialog({ folder, kind, onCancel, onCreate }: { folder: string; kind: "file" | "folder"; onCancel: () => void; onCreate: (path: string) => void }) {
  const [name, setName] = useState("");
  const path = [folder, name.trim()].filter(Boolean).join("/");
  const valid = /^[^\\:*?"<>|]+$/.test(name.trim()) && !name.includes("..");
  return (
    <Dialog title={t(kind === "file" ? "code.newFile" : "code.newFolder")} okLabel={t("code.create")} canOk={valid} onOk={() => onCreate(path)} onCancel={onCancel}>
      <FormGroup title={t("code.location")}>
        <FormRow label={t("code.name")}><input autoFocus value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} /></FormRow>
        <FormRow label={t("resources.path")}><div className="fval"><code>{path || "-"}</code></div></FormRow>
      </FormGroup>
    </Dialog>
  );
}
