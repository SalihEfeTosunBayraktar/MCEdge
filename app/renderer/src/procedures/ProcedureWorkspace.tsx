import * as Blockly from "blockly/core";
import { useEffect, useRef } from "react";
import type { BlockDef } from "../../../../src/procedures/blockTypes.ts";
import type { LocalVariable, ProcedureIR } from "../../../../src/procedures/model.ts";
import { language, t } from "../strings.ts";
import type { ChoiceSource } from "./blocklySetup.ts";
import { BLOCKS_BY_ID, calledProcedure, isFavourite, noteUsed, searchBlocks, setChoiceSource, setupBlockly, toggleFavourite, toolbox, workbenchTheme } from "./blocklySetup.ts";
import { blocklyToIr, irToBlockly } from "./convert.ts";
import { cullOffscreenBlocks } from "./cull.ts";
import { loadProgram } from "./fastLoad.ts";

/** What the surrounding toolbar can do with the workspace. */
export interface WorkspaceApi {
  undo(): void;
  redo(): void;
  zoom(steps: number): void;
  fit(): void;
  tidy(): void;
  search(query: string): void;
  /** Adds the first search result under the selected block (else at the end of the start stack); false when nothing matches. */
  addFirst(query: string): boolean;
  /** Replaces the local variables; `rename` also updates the blocks using the old name. */
  setVariables(variables: LocalVariable[], rename?: { from: string; to: string }): void;
}

export interface BlockWarning {
  path: string;
  message: string;
}

interface Props {
  /** Program shown when the workspace mounts; later changes come from the workspace itself. */
  initial: ProcedureIR;
  onChange: (ir: ProcedureIR) => void;
  /** Warnings of a program, by block path; run after every change. */
  check: (ir: ProcedureIR) => BlockWarning[];
  onReady?: (api: WorkspaceApi) => void;
  hidden?: (def: BlockDef) => boolean;
  /** The project's globals and procedures, for block dropdowns and the Variables category. */
  choices?: Omit<ChoiceSource, "locals">;
  className?: string;
  /** Opens a procedure a block calls (right click > Open); without it the menu item is not offered. */
  onOpenProcedure?: (id: string) => void;
}

const CHANGE_DELAY_MS = 300;

/** What the shared context menu items do in each mounted workspace. */
const handlers = new WeakMap<Blockly.WorkspaceSvg, { refresh(): void; openProcedure?: (id: string) => void }>();
const handlersOf = (block: Blockly.BlockSvg) => {
  const ws = block.workspace as Blockly.WorkspaceSvg;
  return handlers.get(ws.isFlyout ? (ws.targetWorkspace ?? ws) : ws);
};
let menuRegistered = false;

/** Right-click items on blocks: add to or remove from Favourites, and open the procedure a block runs. */
function registerMenu(): void {
  if (menuRegistered) return;
  menuRegistered = true;
  const { registry, ScopeType } = Blockly.ContextMenuRegistry;
  registry.register({
    id: "mcedge_open_procedure",
    scopeType: ScopeType.BLOCK,
    weight: -2,
    displayText: (scope) => t("proc.openCalled", { name: (scope.block && calledProcedure(scope.block)) ?? "" }),
    preconditionFn: (scope) => (scope.block && calledProcedure(scope.block) && handlersOf(scope.block)?.openProcedure ? "enabled" : "hidden"),
    callback: (scope) => scope.block && handlersOf(scope.block)?.openProcedure?.(calledProcedure(scope.block)!),
  });
  registry.register({
    id: "mcedge_favourite",
    scopeType: ScopeType.BLOCK,
    weight: -1,
    displayText: (scope) => t(scope.block && isFavourite(scope.block.type) ? "proc.unfavourite" : "proc.favourite"),
    preconditionFn: (scope) => (scope.block && BLOCKS_BY_ID.has(scope.block.type) && scope.block.type !== "start" && !scope.block.isShadow() ? "enabled" : "hidden"),
    callback: (scope) => {
      if (!scope.block) return;
      toggleFavourite(scope.block.type);
      handlersOf(scope.block)?.refresh();
    },
  });
}

const variableLabels = () => ({ local: t("proc.varsLocal"), global: t("proc.varsGlobal"), player: t("proc.varsPlayer"), none: t("proc.varsNone"), more: t("proc.varsMore") });
const personal = () => ({ favourites: t("proc.favourites"), favouritesEmpty: t("proc.favouritesEmpty"), recent: t("proc.recent"), recentEmpty: t("proc.recentEmpty") });

/**
 * Blockly makes an AudioContext for every workspace (this one and its flyout) even with `sounds: false`, ~30 ms each,
 * and Chromium allows only a few at once. Sounds are off, so none is wanted: it runs `make` without the constructor (Q280).
 */
function withoutAudioContext<T>(make: () => T): T {
  const audio = window.AudioContext;
  (window as { AudioContext?: unknown }).AudioContext = undefined;
  try {
    return make();
  } finally {
    window.AudioContext = audio;
  }
}

/**
 * Blockly canvas editing a procedure IR. The program is loaded once; edits are converted back to IR after a
 * short pause and reported with onChange, and warnings are placed on the blocks they concern.
 */
export function ProcedureWorkspace({ initial, onChange, check, onReady, hidden, choices, className, onOpenProcedure }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const checkRef = useRef(check);
  checkRef.current = check;
  const openRef = useRef(onOpenProcedure);
  openRef.current = onOpenProcedure;
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  useEffect(() => {
    const div = host.current!;
    setupBlockly(language());
    registerMenu();
    // Dropdowns of variable and procedure blocks read these lists when opened; the locals are this editor's own.
    let variables: LocalVariable[] = initial.variables;
    setChoiceSource({
      locals: (type) => variables.filter((v) => v.type === type).map((v) => v.name),
      globals: (scope, type) => choicesRef.current?.globals(scope, type) ?? [],
      procedures: () => choicesRef.current?.procedures() ?? [],
      allGlobals: () => choicesRef.current?.allGlobals() ?? [],
    });
    const variableList = () => ({ locals: variables, globals: choicesRef.current?.allGlobals() ?? [], labels: variableLabels() });
    const theme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
    const workspace = withoutAudioContext(() => Blockly.inject(div, {
      toolbox: toolbox({ hidden, personal: personal(), variables: variableList() }),
      theme: workbenchTheme(theme()),
      renderer: "thrasos",
      zoom: { controls: false, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.3, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: getComputedStyle(document.documentElement).getPropertyValue("--line").trim(), snap: false },
      trashcan: false,
      sounds: false,
      maxInstances: { start: 1 },
      oneBasedIndex: false,
    }));
    const started = performance.now();
    const state = irToBlockly(initial);
    loadProgram(state, workspace);
    const loadMs = Math.round(performance.now() - started);
    div.dataset.loadMs = String(loadMs);
    div.dataset.blocks = String(workspace.getAllBlocks(false).length);
    // Inspection hook for automated UI checks (CDP); the workspace is otherwise private to this component.
    Object.defineProperty(div, "blocklyWorkspace", { value: workspace, configurable: true });
    Object.defineProperty(div, "blockly", { value: Blockly, configurable: true });
    Object.defineProperty(div, "blocklyLoaded", { value: state, configurable: true });

    const shownWarnings = new Map<string, string | null>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const convert = () => {
      const paths = new Map<string, string>();
      const ir = blocklyToIr(Blockly.serialization.workspaces.save(workspace) as never, variables, paths);
      return { ir, paths };
    };
    const applyWarnings = (ir: ProcedureIR, paths: Map<string, string>) => {
      const byPath = new Map<string, string[]>();
      for (const w of checkRef.current(ir)) byPath.set(w.path, [...(byPath.get(w.path) ?? []), w.message]);
      Blockly.Events.disable();
      try {
        for (const [id, path] of paths) {
          const block = workspace.getBlockById(id);
          if (!block || block.isShadow()) continue;
          const text = byPath.get(path)?.join("\n") ?? null;
          if ((shownWarnings.get(id) ?? null) === text) continue;
          shownWarnings.set(id, text);
          block.setWarningText(text);
        }
      } finally {
        Blockly.Events.enable();
      }
      div.dataset.warnings = String([...shownWarnings.values()].filter(Boolean).length);
    };
    const flush = () => {
      timer = undefined;
      const { ir, paths } = convert();
      onChangeRef.current(ir);
      applyWarnings(ir, paths);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, CHANGE_DELAY_MS);
    };
    // Warnings of the loaded program right away; nothing is saved until the user edits.
    const first = convert();
    applyWarnings(first.ir, first.paths);
    const refreshToolbox = () => workspace.updateToolbox(toolbox({ hidden, personal: personal(), variables: variableList() }));
    handlers.set(workspace, { refresh: refreshToolbox, openProcedure: openRef.current && ((id) => openRef.current?.(id)) });
    // Blocks taken from the toolbox go first in Recently used; the toolbox is rebuilt once the drag ends.
    let recentChanged = false;
    workspace.addChangeListener((event: Blockly.Events.Abstract) => {
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        const block = workspace.getBlockById((event as Blockly.Events.BlockCreate).blockId ?? "");
        if (block && !block.isShadow() && noteUsed(block.type)) recentChanged = true;
      }
      if (event.type === Blockly.Events.BLOCK_DRAG && !(event as Blockly.Events.BlockDrag).isStart && recentChanged) {
        recentChanged = false;
        setTimeout(refreshToolbox);
      }
      if (event.isUiEvent || event.type === Blockly.Events.FINISHED_LOADING) return;
      schedule();
    });

    const stopCulling = cullOffscreenBlocks(workspace);
    const resize = new ResizeObserver(() => Blockly.svgResize(workspace));
    resize.observe(div);
    const themeWatch = new MutationObserver(() => workspace.setTheme(workbenchTheme(theme())));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    onReady?.({
      undo: () => workspace.undo(false),
      redo: () => workspace.undo(true),
      zoom: (steps) => workspace.zoomCenter(steps),
      fit: () => workspace.zoomToFit(),
      tidy: () => workspace.cleanUp(),
      search: (query) => {
        const flyout = workspace.getToolbox()?.getFlyout();
        if (!flyout) return;
        const results = searchBlocks(query, hidden);
        if (!results.length) flyout.hide();
        else {
          (workspace.getToolbox() as Blockly.Toolbox | null)?.clearSelection();
          flyout.show(results);
        }
      },
      addFirst: (query) => {
        const { kind: _kind, ...state } = (searchBlocks(query, hidden)[0] ?? {}) as { kind?: string; type?: string };
        if (!state.type) return false;
        const block = Blockly.serialization.blocks.append(state as never, workspace, { recordUndo: true }) as Blockly.BlockSvg;
        const picked = Blockly.getSelected();
        let after = picked instanceof Blockly.BlockSvg && picked.nextConnection && !picked.isShadow() ? picked : undefined;
        if (!after) {
          after = workspace.getTopBlocks(false).find((b) => b.type === "start") as Blockly.BlockSvg | undefined;
          while (after?.getNextBlock()) after = after.getNextBlock() as Blockly.BlockSvg;
        }
        if (block.previousConnection && after?.nextConnection) after.nextConnection.connect(block.previousConnection);
        else {
          const box = workspace.getBlocksBoundingBox();
          block.moveTo(new Blockly.utils.Coordinate(box.left, box.bottom + 24));
        }
        Blockly.common.setSelected(block);
        if (recentChanged) (recentChanged = false, setTimeout(refreshToolbox));
        return true;
      },
      setVariables: (next, rename) => {
        variables = next;
        refreshToolbox();
        if (rename) {
          for (const block of workspace.getAllBlocks(false)) {
            for (const input of block.inputList) {
              for (const field of input.fieldRow) {
                if (field instanceof Blockly.FieldDropdown && field.getValue() === rename.from && /^(var|index)$/.test(field.name ?? "")) field.setValue(rename.to);
              }
            }
          }
        }
        flush();
      },
    });

    return () => {
      clearTimeout(timer);
      // A change waiting for its pause is kept.
      if (timer) onChangeRef.current(convert().ir);
      stopCulling();
      resize.disconnect();
      themeWatch.disconnect();
      workspace.dispose();
    };
    // The workspace is created once per mount; the program and options are read at that time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className={`blocklyhost ${className ?? ""}`} />;
}
