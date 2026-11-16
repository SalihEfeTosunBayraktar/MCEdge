# Modules: design (Q236)

Status: design, nothing built yet. This document decides what a module is, how one is written, checked, published
and installed, and in which order to build it.

## 1. Goal

Users build features the way MCEdge builds bubbles, radial menus and seats, publish them, and other users add them
to their projects from inside the app. A module is the unit of sharing. MCEdge itself moves its own bubbles, radial
menus and seats into modules first: the format is proven on real features before anyone else depends on it.

Non-goals for the first versions: paid modules, modules that change the MCEdge app itself (its menus, views or
build pipeline), and arbitrary code running inside MCEdge.

## 2. What exists today

A feature is already split into the parts a module needs:

| Part | Bubbles | Radial menus | Seats |
| --- | --- | --- | --- |
| Data shape and form | `element-types/bubble/type.json` | `element-types/radial_menu/type.json` | `seat` page of `element-types/block/type.json` |
| Element context | `src/generator/types/bubble.ts` (9 lines) | `src/generator/types/radial_menu.ts` (11 lines) | `src/elements/seats.ts` and the block generator |
| Shared runtime (Java emitted from TS) | `src/generator/bubbles.ts` (723 lines) | `src/generator/radial.ts` (1318 lines) | `src/generator/seats.ts` + `multiBlock.ts` (826 lines) |
| Editor preview | `BubblePreview.tsx` | `RadialPreview.tsx` | `models/SeatPreview.tsx` (3D, click and drag points) |
| Procedure blocks | `bubble_show`, ... | `radial_open`, ... | `entity_is_sitting`, ... (`src/procedures/blocks/minecraft.ts`) |
| Guide | `docs/guide/en/05-bubbles.md` | `07-radial-menus.md` | `06-seats.md` |
| Checks | `tools/codegen-test/bubble-*` | `radial-*` | `seat-*` |

The pattern (one runtime per mod, data per element, no Java per element) is the right one. What blocks sharing:

- The runtime is TypeScript that writes Java strings, with branches per engine (`env.gen === "1.16.5"`,
  `env.loader === "fabric"`). A module author would have to write TypeScript that MCEdge runs, and know five engines.
- Previews are React components wired by type id in `ElementEditor.tsx`.
- Procedure blocks are registered in core code.
- Seats are not a type of their own but a page added to the block type.

## 3. Module kinds

| Kind | Contains | Runs code in MCEdge | Runs code in the game | First version |
| --- | --- | --- | --- | --- |
| **Pack** | Elements, textures, models, sounds, procedures of a project (an "emoji radial menu with 20 bubbles") | no | only what MCEdge generates | yes |
| **Element type** | A new type: `type.json`, templates, Java runtime, preview settings, blocks, guide | no | yes, the module's Java | yes |
| **Extension** | Fields, a page, a preview, a runtime and blocks added to an existing type (seats on blocks) | no | yes | yes |
| **Plugin** | TypeScript that MCEdge runs (custom previews, generators) | yes | yes | no, later and signed only |

A pack is data and is safe. Element types and extensions put Java into the user's mod, never into MCEdge: the app only
fills logic-less templates (`src/generator/render.ts`). That keeps the app safe without a sandbox; the game-side risk
is handled by the checks in section 8.

## 4. Module format

A module is a folder (published as a zip):

```
radial-menus/
  module.json              manifest
  types/radial_menu.json   element type (same schema as element-types/*/type.json)
  extends/block.json       extension: pages and fields added to an existing type
  runtime/                 Java against the Edge API (section 5), one tree for every engine
    RadialMenus.java.tmpl
  resources/               resource templates filled per element (json, lang)
  blocks/radial.json       procedure blocks: Blockly shape + Java template per block
  textures/ models/ sounds/
  guide/en.md guide/tr.md  shown in the app and on the registry page
  checks/                  scenario commands and expected log lines (section 8)
  strings/en.json tr.json  all labels; nothing is written in code (config rule)
```

`module.json`:

```json
{
  "id": "mcedge.radial_menus",
  "name": "Radial menus",
  "version": "1.2.0",
  "kind": "element-type",
  "mcedgeApi": "^1.0",
  "engines": ["forge-1.16.5", "neoforge-1.21.5", "neoforge-26.3", "fabric-1.21.5", "fabric-26.3"],
  "edgeServices": ["keys", "screens", "net", "commands", "configFolder"],
  "requires": { "mcedge.bubbles": "^1.0" },
  "license": "MIT",
  "authors": ["..."],
  "homepage": "https://github.com/...",
  "preview": "radial"
}
```

- `engines` is a promise checked by section 8; an engine left out shows the type with "no code on this engine", as
  `typeGenerated` does today.
- `edgeServices` lists the Edge API parts the runtime uses; the generator adds only those to the mod.
- `requires` names other modules (a radial slice that shows a bubble needs the bubbles module).

## 5. Edge API: one Java layer over five engines

The main piece of work. MCEdge generates, into every mod that uses a module, a small Java package
(`<package>.edge`) with the same classes and methods on every engine. Module runtimes call it and never touch
engine classes, so one Java tree runs on Forge 1.16.5, NeoForge and Fabric.

Services, taken from what bubbles, radial menus and seats already do per engine:

| Service | Covers |
| --- | --- |
| `keys` | key mappings, pressed/held/released |
| `screens` | open/close a screen, draw images, text and shapes, mouse and wheel input |
| `hud` | draw over the world and above entities (bubbles) |
| `net` | typed client/server messages, payload registration |
| `commands` | register a command tree, permission levels |
| `events` | server start, player join/leave, tick, block use, block break |
| `entities` | spawn a seat entity, ride/dismount, poses |
| `blocks` | block states, facing, placing and removing parts (multi-blocks) |
| `configFolder` | read files under `config/<modid>/` (runtime images) |
| `textures` | dynamic textures from bytes, animated frame lists (Q229 playback modes) |
| `sounds`, `particles` | play by id |

Rules: the API is versioned (`mcedgeApi`); a new MCEdge may add methods, never change old ones within a major
version. A new engine needs the API implemented once by MCEdge, and every module that keeps to the API gets that
engine for free.

## 6. What a module declares instead of code in MCEdge

- **Fields and forms:** `type.json` as today (pages, groups, conditions, lists).
- **Preview:** a built-in preview kind with settings instead of React: `layout2d` (bubbles, GUIs: images, text,
  timeline from Q228), `wheel` (radial), `model3d-points` (seats: the block model with points to click and drag,
  each point bound to a list field), `model3d-cells` (multi-block cells). New kinds are added to MCEdge core when a
  module needs one; plugins (section 3) could add their own later.
- **Resources:** templates filled per element or once per mod (`radial_menus.json`, lang entries).
- **Procedure blocks:** Blockly shape in JSON (as in the block catalogue) plus a Java template that calls the module
  runtime; the trigger list likewise.
- **Problems:** declarative checks (required field, id exists, value range) shown in the Problems view.

## 7. Projects and installing

- Installing adds the module to the project: `mcedge.json` gets `"modules": { "mcedge.radial_menus": "1.2.0" }` and
  the module's files are stored under `modules/<id>/` in the project, so a teammate or CI builds the same mod without
  the registry. A shared cache under the user data folder avoids repeated downloads.
- Updating shows the version change and its notes, and runs the module's checks before switching.
- Removing is refused while elements of its types exist; the dialog lists them (Q220 cascade delete).
- A pack installs as a copy: its elements become ordinary project elements, no link back.

## 8. Checking a module (the same tools we use)

`mcedge module check <folder>` turns the codegen test pipeline into the module gate:

1. Schema: `module.json`, types, strings (en complete, other languages may leave keys out), guide present.
2. Generate a test project with the module's sample elements and build it on every engine in `engines`
   (`tools/codegen-test/build.sh`).
3. Run the module's `checks/` scenarios on a server (and a client where given), as `run_scenario` does (Q218).
4. Static scan of the module's Java: no reflection, process start, network sockets, file access outside
   `config/<modid>/`, or engine classes outside the Edge API. A finding blocks publishing.

The registry runs the same check in CI on every submission, so "works on these engines" is proven, not claimed.

## 9. Registry and publishing

- **Index:** a public GitHub repository (`mcedge-modules`) with one manifest per module and version: id, version,
  download URL (a GitHub release asset of the author's repository), SHA-256, check result. No server of our own.
- **Publishing:** `mcedge module publish` packs the zip, attaches it to a release of the author's repository and
  opens a pull request to the index. CI runs section 8 on it; a maintainer merges. Authors own their ids
  (`<author>.<name>`); `mcedge.*` is reserved for built-in modules.
- **In the app:** a Modules view: search, details with the guide and screenshots, engines, install, update, remove.
  The app checks the SHA-256 of every download.
- **For agents:** MCP tools `search_modules`, `module_info`, `install_module`, `remove_module`, `module_check`, and
  `create_module` (scaffold), documented in `docs/MCP.md`.

## 10. The narrator: helping people write modules

- **Guide:** `docs/guide/en/08-modules.md`, written around one small example module end to end (a "sit on stairs"
  extension), then the reference: manifest, Edge API, preview kinds, blocks, checks.
- **Scaffold:** File > New module, or `mcedge module new`, asks the kind, the engines and the services, and writes a
  working module with one field, a preview, one block and one check that passes on first run.
- **From a project:** "Make a module from this" on a selection of elements creates a pack; on an element type
  created as `custom_element` it starts an element-type module.
- **In the editor:** a module folder opens in MCEdge like a project, with the form designer for `type.json`, the
  preview live, and Build module / Check module on the toolbar.
- **Examples:** the built-in bubbles, radial menus and seats modules are the reference examples.

## 11. Order of work

Each step is a queue item and is done only with its checks.

1. **Packs.** Export a selection of elements with their resources as a pack; import it into another project; Modules
   view lists installed packs. Check: export the codegen test project's bubbles, import them into a fresh project, build on
   5 engines.
2. **Edge API v1.** Generate the services bubbles, radial menus and seats use, on all five engines, with a probe per
   service. Check: probes pass on the engines that already run clients (Forge 1.16.5, NeoForge 1.21.5, 26.3).
3. **Bubbles as a built-in module.** Move `bubbles.ts`'s Java into `runtime/` against the Edge API, the editor
   preview to the `layout2d` kind, blocks to `blocks/`. Generated mods must behave the same: the existing bubble
   checks pass unchanged.
4. **Seats as a built-in extension module.** Same for `seats.ts` and `multiBlock.ts`, the seat page of the block type
   and `SeatPreview` as the `model3d-points` and `model3d-cells` kinds. Existing seat checks pass unchanged.
5. **Radial menus as a built-in module**, requiring the bubbles module. Existing radial checks pass unchanged.
6. **`mcedge module check` and the scaffold**, with the guide.
7. **Registry and Modules view:** index repository, publish command, install/update/remove, MCP tools.
8. **Plugins (later):** only signed, only after packs, types and extensions have been used for a while.

Steps 1, 2 and 6 can be started independently; 3-5 depend on 2.

## 12. Open questions

- Registry hosting: is a public GitHub index under the MCEdge account acceptable, with maintainers reviewing pull
  requests?
- Moderation beyond the automatic check: who reviews submissions in the beginning?
- Should the built-in modules keep shipping inside MCEdge (always available offline) or be installed on demand?
- Licence rule: require an OSI licence for published modules?
