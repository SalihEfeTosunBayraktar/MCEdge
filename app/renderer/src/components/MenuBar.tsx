import { useEffect, useState } from "react";
import type { EngineInfo, RecentProject } from "../../../shared/api.ts";
import { api } from "../api.ts";
import type { Commands } from "../commands.ts";
import { t } from "../strings.ts";
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
  const menus: { id: string; label: string; items: MenuItem[] }[] = [
    {
      id: "file", label: t("menu.file"), items: recentPage ? [
        { label: `< ${t("menu.openRecent")}`, keepOpen: true, onClick: () => setRecentPage(false) },
        sep,
        ...(recent.length
          ? recent.map((r) => ({ label: `${r.name} · ${r.dir}`, onClick: r.missing ? undefined : () => cmd.openRecent(r.dir) }))
          : [{ label: t("welcome.noRecent") }]),
      ] : [
        { label: t("menu.newProject"), onClick: cmd.newProject },
        { label: t("menu.openProject"), onClick: cmd.openProject },
        { label: `${t("menu.openRecent")} >`, keepOpen: true, onClick: () => setRecentPage(true) },
        { label: t("menu.openExample"), onClick: cmd.openExample },
        { label: t("menu.importZip"), onClick: cmd.importProjectZip },
        sep,
        { label: t("menu.closeEditor"), shortcut: "Ctrl+W", onClick: cmd.closeEditor },
        { label: t("menu.closeProject"), onClick: when(p || cmd.codeMode, cmd.closeProject) },
        { label: t("menu.openProjectFolder"), onClick: when(p || cmd.codeMode, cmd.openProjectFolder) },
        sep,
        { label: t("menu.exportJar"), shortcut: "Ctrl+E", onClick: when(cmd.canBuild, cmd.exportJar) },
        { label: t("menu.exportWorkspace"), onClick: when(p, cmd.exportWorkspace) },
      ],
    },
    {
      id: "workspace", label: t("menu.workspace"), items: [
        { label: t("menu.newElement"), shortcut: "Ctrl+N", onClick: when(p, cmd.newElement) },
        { label: t("menu.quickOpen"), shortcut: "Ctrl+K", onClick: when(p, cmd.quickOpen) },
        sep,
        { label: t("section.settings"), onClick: when(p, () => cmd.go("settings")) },
        sep,
        { label: t("section.elements"), onClick: when(p, () => cmd.go("elements")) },
        { label: t("section.resources"), onClick: when(p, () => cmd.go("resources")) },
        { label: t("section.tags"), onClick: when(p, () => cmd.go("tags")) },
        { label: t("section.variables"), onClick: when(p, () => cmd.go("variables")) },
        { label: t("section.localization"), onClick: when(p, () => cmd.go("localization")) },
        { label: t("section.git"), onClick: when(p, () => cmd.go("git")) },
      ],
    },
    {
      id: "resources", label: t("menu.resources"), items: [
        { label: t("menu.importTextures"), onClick: when(p, () => cmd.go("resources")) },
        { label: t("menu.createTexture"), onClick: when(p, cmd.createTexture) },
        { label: t("menu.importSounds"), onClick: when(p, () => cmd.importResources("sound")) },
        { label: t("menu.importModel"), onClick: when(p, () => cmd.importResources("model")) },
        { label: t("menu.importStructure"), onClick: when(p, () => cmd.importResources("structure")) },
      ],
    },
    {
      id: "build", label: t("menu.buildRun"), items: [
        { label: t("top.run"), shortcut: "F5", onClick: when(cmd.canRun, cmd.run) },
        { label: t("top.stop"), shortcut: "Shift+F5", onClick: when(cmd.running, cmd.stop) },
        { label: t("menu.runAnotherClient"), onClick: when(p && !cmd.building, cmd.runAnotherClient) },
        { label: t("menu.joinServer"), onClick: when(p && !cmd.building && cmd.serverRunning, cmd.joinServer) },
        sep,
        { label: t("top.build"), shortcut: "Ctrl+B", onClick: when(cmd.canBuild, () => cmd.build(false)) },
        { label: t("top.buildAll"), shortcut: "Ctrl+Shift+B", onClick: when(cmd.canBuild, () => cmd.build(true)) },
        { label: t("menu.exportJar"), shortcut: "Ctrl+E", onClick: when(cmd.canBuild, cmd.exportJar) },
        { label: t("menu.regenerate"), onClick: when(p && !cmd.building, cmd.regenerate) },
        sep,
        { label: t("menu.debugClient"), onClick: when(cmd.canRun, cmd.debugClient) },
        cmd.serverRunning
          ? { label: t("menu.stopServer"), onClick: cmd.stopServer }
          : { label: t("menu.runServer"), onClick: when(p && !cmd.building, cmd.runServer) },
        sep,
        { label: t("menu.runGradleTask"), onClick: when(p && !cmd.building, cmd.runGradleTask) },
        { label: t("menu.cancelTask"), onClick: when(p && cmd.building, cmd.cancelTask) },
        { label: t("menu.clearCaches"), onClick: when(p && !cmd.building && !cmd.running, cmd.clearGradleCaches) },
      ],
    },
    {
      id: "tools", label: t("menu.tools"), items: [
        { label: t("menu.gradleConsole"), onClick: when(p, cmd.gradleConsole) },
        { label: t("menu.createPack"), onClick: when(p, cmd.createPack) },
        { label: t("menu.dataLists"), onClick: cmd.showDataLists },
        { label: t("menu.reloadGradle"), onClick: when(p && !cmd.building, cmd.reloadGradle) },
      ],
    },
    {
      id: "window", label: t("menu.window"), items: [
        { label: t("menu.preferences"), onClick: cmd.showPreferences },
        sep,
        { label: t("menu.back"), shortcut: "Alt+Left", onClick: when(p, cmd.back) },
        { label: t("menu.forward"), shortcut: "Alt+Right", onClick: when(p, cmd.forward) },
        sep,
        { label: t("panel.build"), onClick: when(p, () => cmd.showPanel("build")) },
        { label: t("panel.problems"), onClick: when(p, () => cmd.showPanel("problems")) },
      ],
    },
    {
      id: "help", label: t("menu.help"), items: [
        { label: t("menu.docs"), onClick: cmd.showDocs },
        { label: t("menu.shortcuts"), onClick: cmd.showShortcuts },
        { label: t("menu.developerDocs"), onClick: cmd.openDeveloperDocs },
        { label: t("menu.connectAgent"), onClick: cmd.connectAgent },
        { label: t("menu.reportBug"), onClick: cmd.reportBug },
        sep,
        { label: t("menu.checkUpdates"), onClick: cmd.checkUpdates },
        { label: t("menu.about"), onClick: cmd.showAbout },
      ],
    },
  ];

  return (
    <header className="menubar">
      <div className="brand"><LogoMark /><Wordmark /></div>
      <nav className="menus">
        {menus.map((m) => (
          <div key={m.id} className="menuwrap">
            <button className={`menu ${open === m.id ? "on" : ""}`} onClick={() => setOpen(open === m.id ? undefined : m.id)}
              onMouseEnter={() => open && setOpen(m.id)}>
              {m.label}
            </button>
            {open === m.id && <MenuList items={m.items} onClose={() => setOpen(undefined)} />}
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
            {p && (
              <button className="tbtn" data-testid="top-run-another" title={t("top.runAnother")} aria-label={t("top.runAnother")}
                disabled={cmd.building} onClick={cmd.runAnotherClient}><Icon name="players" /></button>
            )}
          </div>
          {engines.length > 0 && <div className="menuwrap">            <button className={`enginebtn ${open === "engine" ? "on" : ""}`} title={t("top.engine")}
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
      <button className="themebtn" title={t("top.theme")} aria-label={t("top.theme")} onClick={cmd.toggleTheme}>
        <Icon name={cmd.theme === "dark" ? "moon" : "sun"} />
      </button>
    </header>
  );
}
