# First-run setup and Simple mode (Q244)

## Setup

On the first start (no `level` in the preferences of this computer) a dialog asks two things over the welcome screen:
- the UI language, which switches the dialog at once;
- the user's modding experience: new to modding, some mods made, or writing Java mods.

Start saves `level` and the `mode` that answer turns on (`config/experience.json`, `levels`). New to modding turns on Simple mode; the other two answers turn on Advanced mode. Skip saves `level: "some"` with Advanced mode. Once a level is saved, the setup does not come back. Users who update from an older version are asked once.

## Modes

Advanced shows everything. Simple hides what `config/experience.json` lists under `simple`:

| Key | What it hides | Where |
| --- | --- | --- |
| `sections` | rail sections (Variables, Git) | `Rail.tsx`; the matching Workspace menu items |
| `panels` | bottom panel tabs (Gradle console, Scenarios) | `BottomPanel.tsx` |
| `menu` | menu items, by the string key of their label | `MenuBar.tsx` |
| `pages` | element editor pages by page id (advanced, tile entity, bounding boxes, ...) | `ElementEditor.tsx` |
| `elementTypes` | types offered in New element | `NewElementPopup.tsx` |

Nothing in the project changes. A hidden page that has a problem still shows its tab, so the problem can be fixed. The first page of a type always shows. Existing elements of a hidden type stay in the list. Shortcuts keep working. A hidden section or panel that is open (or opened by an agent) falls back to Elements or Build.

You can switch at any time in two places:
- Window > Simple mode;
- Preferences > Experience, which has the level and the interface mode.

## Agents

The level is shared with the agents:
- The app writes `level` and `mode` into `presence-app.json`.
- `collaborators` returns them with `hint`, which says how to explain things at that level.
- The in-app AI assistant gets the same line in the editor context of every message.

## Tests

`tools/ui-test/experience.ts` runs the whole flow with real clicks (en/tr, dark/light); its screenshots are in `design/244/`. UI tests start with the setup answered (`level: "java"`, Advanced) unless they pass `level: null`.

## First-mod tour (Q245)

A user who answers "I am new to modding" is offered a short tour on the start screen: make a block, paint its texture, test it. Help > Guided tour starts it for anyone, at any time.

- **Panel, not a dialog.** A small panel in the corner lists the steps. It never blocks the UI, outlines the part of the UI the current step points at, and works in Simple mode (the test step has its own button, so it does not need the hidden Scenarios tab).
- **Closing and skipping.** Close (x) pauses: Help > Guided tour continues where it stopped. Skip the tour, No thanks and Finish end it; Help > Guided tour then starts over.
- **Steps check themselves** against the project, not against clicks:
  - `element`: an element of the subject type that was not in the project when the tour started (the tour's block);
  - `texture`: its main texture is set, exists in the project and is not the one the block started with;
  - `scenario`: the tour's scenario passed. The Test button writes `scenarios/tour-<id>.json` (the same file the Scenarios tab lists) and runs it with the Scenarios runner on a headless dedicated server of the selected engine; the first run starts Gradle, so it takes a few minutes.
- **Config.** `config/tour.json` holds the subject type, the steps (check, the CSS selectors the step points at) and the scenario template; the texts are `tour.*` in `config/ui-strings`. Preferences keep only the bookkeeping (`tour`: status, project, the subject and whether its test passed).
- **Test.** `tools/ui-test/tour.ts` walks the tour with real clicks and keys, including a real scenario run (en, dark); screenshots are in `design/245/`.

## Build errors in plain words (Q246)

A failed build keeps its raw output, and above it each error a rule recognises is shown as three parts: what happened, where, and how to fix it. Build output tab, `BuildExplain.tsx`.

- **Rules are config.** `config/build-explanations.json` maps what the compiler (`kind: javac`, matched on one error's message) or Gradle (`kind: gradle`, matched on its "What went wrong" text) printed to an explanation id, and says which values to pick out (`params`, regexes with one group). The first matching rule wins. The texts are `buildError.<id>.what` (technical), `.plain` (no jargon, read by level `new`) and `.fix` in `config/ui-strings` en and tr. The rules only look at the tools' own wording, not at a project. An error no rule matches has no card and stays in the raw output.
- **Where.** The main process (`build:explain`, `explainBuild`) maps each compile error through the generator's source map (`out/<engine>/mcedge-sourcemap.json`, KUYRUK 145; the generated Java is not changed): the element whose class it is, for a procedure the Java block, and the element fields whose value is on the failing line. Gradle failures name the build setup, not an element. A code project has no source map: its errors are explained without a place.
- **Buttons.** Go to the element opens it; with a field it also shows the field's page and highlights its row (a procedure block opens the procedure, not the block). Ask the AI opens the AI assistant with the error and its place written into the input box (not sent), see `docs/AI-PANEL.md`.
- **Agents.** `build_errors` and `build` return the same `explain` `{ id, params, fix }` per error and `failures` for Gradle's own (`docs/MCP.md`).
- **Tests.** `tools/mcp-test/build-explain.ts` (real failing Gradle builds of copies of `examples/hello`: many compile errors, syntax errors, flow errors, and a build with no network); `tools/ui-test/build-explain.ts` (hidden window, screenshots in `design/246/`).
