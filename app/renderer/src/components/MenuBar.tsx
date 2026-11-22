import { useEffect, useRef, useState } from "react";
import type { EngineInfo, RecentProject } from "../../../shared/api.ts";
import { api } from "../api.ts";
import type { Commands } from "../commands.ts";
import { hidden, simpleMode } from "../experience.ts";
import { t, type StringKey } from "../strings.ts";
import { LogoMark, Wordmark } from "./Brand.tsx";
import { Icon } from "./Icon.tsx";
import { MenuList, type MenuItem } from "./ui.tsx";

interface Props {
  cmd: Commands;
  projectName?: string;
  engines: EngineInfo[];
  engineId: string;
  onEngineChange: (id: string) => void;
}

/** Brand, the MCreator-style menus, the open workspace and the theme switch. */
export function MenuBar({ cmd, projectName, engines, engineId, onEngineChange }: Props) {
  const [open, setOpen] = useState<string>();
  /** The menu button that is the menu bar's one tab stop (arrows move it); the top buttons by menu id. */
  const [stop, setStop] = useState("file");
  const tops = useRef<Record<string, HTMLButtonElement | null>>({});
  /** What had the focus when Alt or F10 moved it into the menu bar, to give it back on Escape. */
  const returnTo = useRef<HTMLElement | null>(null);
  /** File > Open recent shows the recent projects in place of the File items (as the element menu's pages). */
  const [recentPage, setRecentPage] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  useEffect(() => {
    setRecentPage(false);
    if (open === "file") void api.recentProjects().then(setRecent);
  }, [open]);
  const p = cmd.hasProject;
  const when = (ok: boolean, fn: () => void) => (ok ? fn : undefined);
  const sep: MenuItem = { label: "", separator: true };
  /** A menu item named by its string key, which config/experience.json uses to hide it in Simple mode (Q244). */
  const k = (key: StringKey) => ({ id: key, label: t(key) });
  const menus: { id: string; label: string; items: MenuItem[] }[] = [
    {
      id: "file", label: t("menu.file"), items: recentPage ? [
        { label: `< ${t("menu.openRecent")}`, keepOpen: true, onClick: () => setRecentPage(false) },
        sep,
        ...(recent.length
          ? recent.map((r) => ({ label: `${r.name} · ${r.dir}`, onClick: r.missing ? undefined : () => cmd.openRecent(r.dir) }))
          : [{ ...k("welcome.noRecent") }]),
      ] : [
        { ...k("menu.newProject"), onClick: cmd.newProject },
        { ...k("menu.openProject"), onClick: cmd.openProject },
        { label: `${t("menu.openRecent")} >`, keepOpen: true, onClick: () => setRecentPage(true) },
        { ...k("menu.openExample"), onClick: cmd.openExample },
        { ...k("menu.importZip"), onClick: cmd.importProjectZip },
        sep,
        { ...k("menu.closeEditor"), shortcut: "Ctrl+W", onClick: cmd.closeEditor },
        { ...k("menu.closeProject"), onClick: when(p || cmd.codeMode, cmd.closeProject) },
        { ...k("menu.openProjectFolder"), onClick: when(p || cmd.codeMode, cmd.openProjectFolder) },
        sep,
        { ...k("menu.exportJar"), shortcut: "Ctrl+E", onClick: when(cmd.canBuild, cmd.exportJar) },
        { ...k("menu.exportWorkspace"), onClick: when(p, cmd.exportWorkspace) },
        sep,
        { ...k("menu.preferences"), shortcut: "Ctrl+,", onClick: cmd.showPreferences },
      ],
    },
    {
      id: "workspace", label: t("menu.workspace"), items: [
        { ...k("menu.newElement"), shortcut: "Ctrl+N", onClick: when(p, cmd.newElement) },
        { ...k("menu.quickOpen"), shortcut: "Ctrl+K", onClick: when(p, cmd.quickOpen) },
        sep,
        { ...k("section.settings"), onClick: when(p, () => cmd.go("settings")) },
        sep,
        { ...k("section.elements"), onClick: when(p, () => cmd.go("elements")) },
        { ...k("section.resources"), onClick: when(p, () => cmd.go("resources")) },
        { ...k("section.tags"), onClick: when(p, () => cmd.go("tags")) },
        { ...k("section.variables"), onClick: when(p, () => cmd.go("variables")) },
        { ...k("section.localization"), onClick: when(p, () => cmd.go("localization")) },
        { ...k("section.git"), onClick: when(p, () => cmd.go("git")) },
      ],
    },
    {
      id: "resources", label: t("menu.resources"), items: [
        { ...k("menu.importTextures"), onClick: when(p, () => cmd.go("resources")) },
        { ...k("menu.createTexture"), onClick: when(p, cmd.createTexture) },
        { ...k("menu.importSounds"), onClick: when(p, () => cmd.importResources("sound")) },
        { ...k("menu.importModel"), onClick: when(p, () => cmd.importResources("model")) },
        { ...k("menu.importStructure"), onClick: when(p, () => cmd.importResources("structure")) },
      ],
    },
    {
      id: "build", label: t("menu.buildRun"), items: [
        { ...k("top.run"), shortcut: "F5", onClick: when(cmd.canRun, cmd.run) },
        { ...k("top.stop"), shortcut: "Shift+F5", onClick: when(cmd.running, cmd.stop) },
        { ...k("menu.runAnotherClient"), onClick: when(p && !cmd.building, cmd.runAnotherClient) },
        { ...k("menu.joinServer"), onClick: when(p && !cmd.building && cmd.serverRunning, cmd.joinServer) },
        sep,
        { ...k("top.build"), shortcut: "Ctrl+B", onClick: when(cmd.canBuild, () => cmd.build(false)) },
        { ...k("top.buildAll"), shortcut: "Ctrl+Shift+B", onClick: when(cmd.canBuild, () => cmd.build(true)) },
        { ...k("menu.exportJar"), shortcut: "Ctrl+E", onClick: when(cmd.canBuild, cmd.exportJar) },
        { ...k("menu.regenerate"), onClick: when(p && !cmd.building, cmd.regenerate) },
        sep,
        { ...k("menu.debugClient"), onClick: when(cmd.canRun, cmd.debugClient) },
        cmd.serverRunning
          ? { ...k("menu.stopServer"), onClick: cmd.stopServer }
          : { ...k("menu.runServer"), onClick: when(p && !cmd.building, cmd.runServer) },
        sep,
        { ...k("menu.runGradleTask"), onClick: when(p && !cmd.building, cmd.runGradleTask) },
        { ...k("menu.cancelTask"), onClick: when(p && cmd.building, cmd.cancelTask) },
        { ...k("menu.clearCaches"), onClick: when(p && !cmd.building && !cmd.running, cmd.clearGradleCaches) },
      ],
    },
    {
      id: "tools", label: t("menu.tools"), items: [
        { ...k("menu.gradleConsole"), onClick: when(p, cmd.gradleConsole) },
        { ...k("menu.createPack"), onClick: when(p, cmd.createPack) },
        { ...k("menu.dataLists"), onClick: cmd.showDataLists },
        { ...k("menu.reloadGradle"), onClick: when(p && !cmd.building, cmd.reloadGradle) },
      ],
    },
    {
      id: "window", label: t("menu.window"), items: [
        { ...k("menu.preferences"), shortcut: "Ctrl+,", onClick: cmd.showPreferences },
        { ...k("menu.simpleMode"), checked: simpleMode(), onClick: cmd.toggleSimpleMode },
        sep,
        { ...k("menu.back"), shortcut: "Alt+Left", onClick: when(p, cmd.back) },
        { ...k("menu.forward"), shortcut: "Alt+Right", onClick: when(p, cmd.forward) },
        sep,
        { ...k("panel.build"), onClick: when(p, () => cmd.showPanel("build")) },
        { ...k("panel.problems"), onClick: when(p, () => cmd.showPanel("problems")) },
        { ...k("menu.aiPanel"), shortcut: "Ctrl+Shift+A", onClick: when(p, cmd.openAiPanel) },
      ],
    },
    {
      id: "help", label: t("menu.help"), items: [
        { ...k("menu.docs"), onClick: cmd.showDocs },
        { ...k("menu.tour"), onClick: cmd.startTour },
        { ...k("menu.shortcuts"), onClick: cmd.showShortcuts },
        { ...k("menu.developerDocs"), onClick: cmd.openDeveloperDocs },
        { ...k("menu.connectAgent"), onClick: cmd.connectAgent },
        { ...k("menu.reportBug"), onClick: cmd.reportBug },
        sep,
        { ...k("menu.checkUpdates"), onClick: cmd.checkUpdates },
        { ...k("menu.about"), onClick: cmd.showAbout },
      ],
    },
  ];

  const ids = menus.map((m) => m.id);
  const focusTop = (id: string) => {
    setStop(id);
    tops.current[id]?.focus();
  };
  /** Alt (pressed and released alone) or F10 moves the focus into the menu bar; again, or Escape, gives it back. */
  const leave = () => {
    setOpen(undefined);
    const back = returnTo.current;
    if (back && back !== document.body && back.isConnected) back.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  };
  const enterRef = useRef<() => void>(undefined);
  enterRef.current = () => {
    if (document.activeElement?.closest(".menus")) return leave();
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusTop(ids[0]);
  };
  useEffect(() => {
    let lone = false;
    const down = (e: KeyboardEvent) => {
      lone = e.key === "Alt" && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      if (e.key === "F10" && !e.ctrlKey && !e.shiftKey && !e.altKey && !document.querySelector(".backdrop")) (e.preventDefault(), enterRef.current?.());
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt" && lone && !document.querySelector(".backdrop")) (e.preventDefault(), enterRef.current?.());
      lone = false;
    };
    const cancel = () => (lone = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", cancel);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", cancel);
    };
  }, []);
  /** Keys on a top button: Left/Right move along the bar (opening the menu there when one is open), Down opens, Escape leaves. */
  const topKey = (e: React.KeyboardEvent, id: string) => {
    const at = ids.indexOf(id);
    const to = e.key === "ArrowRight" ? ids[(at + 1) % ids.length] : e.key === "ArrowLeft" ? ids[(at || ids.length) - 1] : e.key === "Home" ? ids[0] : e.key === "End" ? ids[ids.length - 1] : undefined;
    if (to) {
      e.preventDefault();
      focusTop(to);
      if (open) setOpen(to);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") (e.preventDefault(), setOpen(id));
    else if (e.key === "Escape" && !open) (e.preventDefault(), leave());
  };
  const side = (id: string) => (step: -1 | 1) => {
    const to = ids[(ids.indexOf(id) + step + ids.length) % ids.length];
    setStop(to);
    setOpen(to);
  };

  return (
    <header className="menubar">
      <div className="brand"><LogoMark /><Wordmark /></div>
      <nav className="menus" role="menubar" aria-label={t("menubar.label")}>
        {menus.map((m) => (
          <div key={m.id} className="menuwrap">
            <button ref={(el) => { tops.current[m.id] = el; }} className={`menu ${open === m.id ? "on" : ""}`} role="menuitem" aria-haspopup="menu" aria-expanded={open === m.id}
              tabIndex={stop === m.id ? 0 : -1} onFocus={() => setStop(m.id)} onKeyDown={(e) => topKey(e, m.id)}
              onClick={() => setOpen(open === m.id ? undefined : m.id)} onMouseEnter={() => open && setOpen(m.id)}>
              {m.label}
            </button>
            {open === m.id && <MenuList items={visible(m.items)} opener={tops.current[m.id]} onSide={side(m.id)} onClose={() => setOpen(undefined)} />}
          </div>
        ))}
      </nav>
      {projectName && (
        <div className="wsname">
          <span className="wsdot" /><span className="wsn" title={projectName}>{projectName}</span>
          {cmd.codeMode && <span className="dim">{t("code.mode")}</span>}
          <div className="tbtns">
            <button className="tbtn" title={`${t("top.build")} (Ctrl+B)`} aria-label={t("top.build")} data-testid="top-build"
              disabled={!cmd.canBuild} onClick={() => cmd.build(false)}><Icon name="hammer" /></button>
            <button className={`tbtn ${cmd.running ? "danger" : "go"}`} data-testid="top-run" aria-label={t(cmd.running ? "top.stop" : "top.run")}
              title={cmd.running ? `${t("top.stop")} (Shift+F5)` : `${t("top.run")} (F5)`}
              disabled={cmd.running ? false : !cmd.canRun} onClick={cmd.running ? cmd.stop : cmd.run}>
              <Icon name={cmd.running ? "stop" : "play"} />
            </button>
            {p && !hidden("menu", "menu.runAnotherClient") && (
              <button className="tbtn" data-testid="top-run-another" title={t("top.runAnother")} aria-label={t("top.runAnother")}
                disabled={cmd.building} onClick={cmd.runAnotherClient}><Icon name="players" /></button>
            )}
          </div>
          {engines.length > 0 && <div className="menuwrap">            <button className={`enginebtn ${open === "engine" ? "on" : ""}`} title={t("top.engine")} aria-haspopup="menu" aria-expanded={open === "engine"}
              onClick={() => setOpen(open === "engine" ? undefined : "engine")}>
              <span className="engname">{engines.find((e) => e.id === engineId)?.name}</span>
              <Icon name="chev" size={10} />
            </button>
            {open === "engine" && (
              <MenuList className="right" onClose={() => setOpen(undefined)}
                items={engines.map((e) => ({ label: e.name, checked: e.id === engineId, onClick: () => onEngineChange(e.id) }))} />
            )}
          </div>}
        </div>
      )}
      <button className="prefsbtn" data-testid="top-preferences" title={`${t("top.preferences")} (Ctrl+,)`} aria-label={t("top.preferences")}
        onClick={cmd.showPreferences}>
        <Icon name="gear" />
      </button>
      <button className="themebtn" title={t("top.theme")} aria-label={t("top.theme")} onClick={cmd.toggleTheme}>
        <Icon name={cmd.theme === "dark" ? "moon" : "sun"} />
      </button>
    </header>
  );
}

/** The items Simple mode keeps (config/experience.json), without separators left at an edge or next to each other. */
function visible(items: MenuItem[]): MenuItem[] {
  const kept = items.filter((item) => !item.id || !(hidden("menu", item.id) || (item.id.startsWith("section.") && hidden("sections", item.id.slice(8)))));
  return kept.filter((item, i) => !item.separator || (i > 0 && i < kept.length - 1 && !kept[i + 1].separator));
}
