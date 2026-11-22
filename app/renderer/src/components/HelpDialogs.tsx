import { useEffect, useRef, useState } from "react";
import type { AppInfo, McpCommand } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { language, t } from "../strings.ts";
import { LogoMark, Wordmark } from "./Brand.tsx";
import { Icon } from "./Icon.tsx";
import { FormGroup, FormRow, ShortcutsDialog, useDialogFocus, type Shortcut } from "./ui.tsx";

const HOMEPAGE = "https://github.com/SalihEfeTosunBayraktar/MCEdge";
const DEVELOPER_DOCS = `${HOMEPAGE}/tree/main/docs`;

/** Result of an action worth confirming (workspace exported, model imported with warnings). */
export interface Notice {
  title: string;
  lines: string[];
  /** File to show in its folder. */
  path?: string;
}

/** Inventory-panel modal with buttons at the bottom; Escape and the backdrop close it. */
export function Modal({ title, className = "", onClose, closeLabel, buttons, children }: {
  title: string;
  className?: string;
  onClose: () => void;
  /** Text of the closing button; "Close" by default. */
  closeLabel?: string;
  buttons?: React.ReactNode;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div ref={box} className={`dialog ${className}`} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ptitle">{title}</div>
        {children}
        <div className="dlg-buttons">
          {buttons}
          <button type="button" className="abtn" onClick={onClose} autoFocus><span>{closeLabel ?? t("dialog.close")}</span></button>
        </div>
      </div>
    </div>
  );
}

export function NoticeDialog({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <Modal title={notice.title} onClose={onClose} buttons={notice.path && (
      <button type="button" className="abtn primary" onClick={() => void api.openPath(notice.path!.replace(/[\\/][^\\/]+$/, ""))}>
        <Icon name="folder" /><span>{t("notice.showFolder")}</span>
      </button>
    )}>
      <FormGroup title={t("notice.details")}>
        <ul className="plain notice-lines">{notice.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
        {notice.path && <p className="hint"><code>{notice.path}</code></p>}
      </FormGroup>
    </Modal>
  );
}

/** Help > About MCEdge: version, runtime versions, author and project page. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AppInfo>();
  useEffect(() => void api.appInfo().then(setInfo), []);
  return (
    <Modal title={t("about.title")} className="aboutdlg" onClose={onClose} buttons={
      <button type="button" className="abtn primary" onClick={() => void api.openExternal(HOMEPAGE)}><Icon name="globe" /><span>{t("about.homepage")}</span></button>
    }>
      <div className="about-brand"><LogoMark px={4} /><Wordmark px={5} /></div>
      <p className="welcome-sub">{t("welcome.subtitle")}</p>
      <FormGroup title={t("about.versions")}>
        <FormRow label={t("about.version")}><div className="fval"><code>{info?.version ?? "-"}</code></div></FormRow>
        <FormRow label="Electron"><div className="fval"><code>{info?.electron ?? "-"}</code></div></FormRow>
        <FormRow label="Chromium"><div className="fval"><code>{info?.chrome ?? "-"}</code></div></FormRow>
        <FormRow label="Node.js"><div className="fval"><code>{info?.node ?? "-"}</code></div></FormRow>
        <FormRow label={t("about.platform")}><div className="fval"><code>{info?.platform ?? "-"}</code></div></FormRow>
      </FormGroup>
      <FormGroup title={t("about.credits")}>
        <FormRow label={t("about.author")}><div className="fval">Salih Efe Tosun</div></FormRow>
        <p className="hint">{t("about.note")}</p>
      </FormGroup>
    </Modal>
  );
}

/**
 * Help > User guide (KUYRUK 128): getting started, a first item, blocks and recipes, building and exporting, from
 * docs/guide/<language>. The developer documentation (element type format, MCP, roadmap) stays on the project page.
 */
export function DocsDialog({ onClose }: { onClose: () => void }) {
  const [docs, setDocs] = useState<{ file: string; title: string }[]>([]);
  const [file, setFile] = useState<string>();
  const [text, setText] = useState("");
  const lang = language();
  useEffect(() => void api.listDocs(lang).then((list) => (setDocs(list), setFile((f) => f ?? list[0]?.file))), [lang]);
  useEffect(() => void (file && api.readDoc(lang, file).then(setText)), [lang, file]);
  return (
    <Modal title={t("docs.title")} className="docsdlg" onClose={onClose} buttons={
      <button type="button" className="abtn" onClick={() => void api.openExternal(DEVELOPER_DOCS)}><Icon name="globe" /><span>{t("docs.developer")}</span></button>
    }>
      <div className="docsbody">
        <div className="listrows docslist" role="listbox" aria-label={t("docs.title")}>
          {docs.length === 0 && <p className="listempty">{t("docs.none")}</p>}
          {docs.map((d) => (
            <button key={d.file} type="button" role="option" aria-selected={d.file === file} className={`lrow ${d.file === file ? "sel" : ""}`} onClick={() => setFile(d.file)}>
              <span className="ltxt">{d.title}</span>
            </button>
          ))}
        </div>
        <article className="markdown">{markdown(text)}</article>
      </div>
    </Modal>
  );
}

/** Shortcuts that work anywhere in the app (Help > Keyboard shortcuts); editors list their own behind their keyboard button. */
export const globalShortcuts = (): Shortcut[] => [
  ["Ctrl+N", t("keys.new")],
  ["Ctrl+K", t("keys.quickOpen")],
  ["Ctrl+F", t("keys.find")],
  ["Enter", t("keys.open")],
  ["F2", t("keys.rename")],
  ["Delete", t("keys.delete")],
  ["Ctrl+W", t("keys.close")],
  ["Alt+Left", t("keys.back")],
  ["Alt+Right", t("keys.forward")],
  ["Ctrl+B", t("top.build")],
  ["Ctrl+Shift+B", t("top.buildAll")],
  ["Ctrl+E", t("export.title")],
  ["Ctrl+Shift+A", t("keys.aiPanel")],
  ["Ctrl+,", t("keys.preferences")],
  ["F5", t("top.run")],
  ["Shift+F5", t("top.stop")],
  ["F10 / Alt", t("keys.menubar")],
  ["Tab / Shift+Tab", t("keys.tab")],
  ["Arrows / Home / End", t("keys.arrows")],
  ["?", t("keys.editorKeys")],
  ["Escape", t("keys.escape")],
];

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  return <ShortcutsDialog shortcuts={globalShortcuts()} onClose={onClose} />;
}

/**
 * Help > Connect an AI agent (Q201): the command that starts this app's MCP server on the open project, and the same as
 * ready-to-paste setup for Claude Code, Codex and the clients that read an mcpServers JSON (Gemini CLI, Cursor, ...).
 */
export function ConnectAgentDialog({ dir, onClose }: { dir?: string; onClose: () => void }) {
  const [mcp, setMcp] = useState<McpCommand>();
  const [copied, setCopied] = useState<string>();
  useEffect(() => void api.mcpCommand().then(setMcp), []);
  const args = mcp ? [...mcp.args, "mcp", dir ?? t("connect.projectPlaceholder")] : [];
  const env = Object.entries(mcp?.env ?? {});
  const line = mcp ? [mcp.command, ...args].map((a) => `"${a}"`).join(" ") : "";
  // JSON strings are valid TOML basic strings, so both formats quote with JSON.stringify.
  const snippets = !mcp ? [] : [
    { id: "command", title: t("connect.command"), hint: t("connect.commandHint", { env: env.map(([k, v]) => `${k}=${v}`).join(" ") }), text: line },
    { id: "claude", title: "Claude Code", hint: t("connect.claudeHint"), text: `claude mcp add --transport stdio ${env.map(([k, v]) => `--env ${k}=${v} `).join("")}mcedge -- ${line}` },
    { id: "codex", title: "Codex", hint: t("connect.codexHint"), text: [
      "[mcp_servers.mcedge]",
      `command = ${JSON.stringify(mcp.command)}`,
      `args = [${args.map((a) => JSON.stringify(a)).join(", ")}]`,
      `env = { ${env.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")} }`,
    ].join("\n") },
    { id: "json", title: t("connect.json"), hint: t("connect.jsonHint"),
      text: JSON.stringify({ mcpServers: { mcedge: { command: mcp.command, args, env: mcp.env } } }, null, 2) },
  ];
  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
  };
  return (
    <Modal title={t("connect.title")} className="connectdlg" onClose={onClose}>
      <div className="connectbody" data-testid="connect-agent">
        <p className="hint">{t("connect.intro")}</p>
        {mcp?.portable && <p className="notice" data-testid="connect-portable">{t("connect.portable")}</p>}
        {!dir && <p className="notice">{t("connect.noProject")}</p>}
        {snippets.map((s) => (
          <FormGroup key={s.id} title={s.title}>
            <div className="connectsnippet" data-snippet={s.id}>
              <pre className="javapre">{s.text}</pre>
              <button type="button" className="mbtn" onClick={() => void copy(s.id, s.text)} aria-label={t("connect.copyLabel", { name: s.title })}>
                <Icon name={copied === s.id ? "check" : "copy"} size={12} /><span>{t(copied === s.id ? "dataLists.copied" : "dataLists.copy")}</span>
              </button>
            </div>
            <p className="hint">{s.hint}</p>
          </FormGroup>
        ))}
      </div>
    </Modal>
  );
}

/** Small Markdown renderer for the docs: headings, paragraphs, lists, tables, code blocks and inline code, bold, links. */
export function markdown(source: string): React.ReactNode[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      out.push(<pre key={i} className="javapre">{code.join("\n")}</pre>);
      i++;
    } else if (/^#{1,6}\s/.test(line)) {
      const level = /^#+/.exec(line)![0].length;
      const Tag = `h${Math.min(level + 1, 6)}` as "h2";
      out.push(<Tag key={i}>{inline(line.replace(/^#+\s*/, ""))}</Tag>);
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) {
        if (/^\|[\s:|-]+\|$/.test(lines[i].trim())) continue;
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")));
      }
      const [head, ...body] = rows;
      out.push(
        <table key={i} className="grid mdtable">
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      out.push(<ul key={i} className="plain">{items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>);
    } else if (!line.trim()) {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(#|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i]);
      out.push(<p key={i}>{inline(para.join(" "))}</p>);
    }
  }
  return out;
}

function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<code key={m.index}>{m[1]}</code>);
    else if (m[2] !== undefined) parts.push(<b key={m.index}>{m[2]}</b>);
    else if (/^https:\/\//.test(m[4])) parts.push(<button key={m.index} type="button" className="linkbtn" onClick={() => void api.openExternal(m[4])}>{m[3]}</button>);
    else parts.push(<span key={m.index}>{m[3]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
