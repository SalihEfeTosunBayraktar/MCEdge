# MCP server

MCEdge is MCP-first: an AI agent connected over the Model Context Protocol can do everything the app can. The
server works on one project folder, an MCEdge project or a plain Gradle mod (code project mode). It talks over stdio;
the AI client starts it.

**Installed app** (no Node.js or sources needed, Q201): the client runs the app's exe as Node, with the environment
variable `ELECTRON_RUN_AS_NODE=1`, on the server bundled in the app (`out/cli/index.js` in `resources/app.asar`, built
from `app/cli/index.ts` by `vite.cli.config.ts`):

```
"<install folder>\MCEdge.exe" "<install folder>\resources\app.asar\out\cli\index.js" mcp <project folder>
```

The default per-user install folder is `%LOCALAPPDATA%\Programs\MCEdge`. **Help > Connect an AI agent** (also
*Connect an agent* in the Agents panel) shows this command with the real paths and the open project, and the same as
setup for Claude Code (`claude mcp add --transport stdio --env ELECTRON_RUN_AS_NODE=1 mcedge -- ...`), Codex
(`[mcp_servers.mcedge]` in `~/.codex/config.toml`) and the clients that read an `mcpServers` JSON (Gemini CLI,
Cursor, Claude Desktop). In this mode the exe is plain Node: no window and no Chromium, and stdout carries only
JSON-RPC (logs go to stderr). The server reads the app's `resources/core` (element types, engines, layers, schemas)
and downloads JDKs and Gradle into the app's toolchains folder (`%APPDATA%\MCEdge\toolchains`), like the app. The
portable exe cannot serve agents: its launcher unpacks the app to a temporary folder deleted when it closes and does
not pass stdio through.

**Source checkout** (Node.js 24, `npm install`):

```
node src/cli.ts mcp <project folder>
```

Every write goes to the same files the app reads (`mcedge.json`, `elements/<folder>/<id>.json`, `textures/`, ...),
through the same core functions the app uses. Tools answer with JSON text;
a tool that fails returns an error result with the reason. Paths are project-relative with forward slashes unless
a tool says "absolute" (files to import, export targets).

Tools marked *MCEdge* exist only for MCEdge projects; the rest also work on Gradle mods. `tools/mcp-test/` holds
the tests (`surface.ts` walks every area below, `menu-commands.ts` covers resources and Gradle runs). They start the
source server; with `MCEDGE_MCP_EXE=<install folder>\MCEdge.exe` they start an installed or packaged app's instead, and
`installed.ts` checks that one end to end (clean stdout, tool list, reads and a write on a copy of examples/hello).

## Project and mod settings (Workspace settings)

| Tool | Arguments | What it does |
| --- | --- | --- |
| `project_info` | - | Kind (mcedge or gradle), name, mod settings and engines, or the Gradle mod's JDK. |
| `create_project` | `parent` (absolute), `name`, `modId`, `package?`, `engines?`, `template?` (`empty`, `example`), `folder?`, `author?` | File > New project (KUYRUK 126): makes `<parent>/<folder or modId>` (must not exist or be empty). `empty` has no elements; `example` is the bundled example (item, block, tool, recipes, creative tab) renamed to the new mod id and package, without its dependencies. The package defaults to `com.<author or example>.<modId>`; `engines` saves the target engines. This server stays on its project; run `mcedge mcp <new folder>` to work in the new one. |
| `get_mod` *MCEdge* | - | Mod settings: id, name, version, package, authors, description, license, website, credits, logo, dependencies. |
| `update_mod` *MCEdge* | `name`, `id`, `version`, `package`, `engines`, `authors`, `description`, `license`, `website`, `credits`, `logo`, `dependencies` | Changes only the given keys; `dependencies` replaces the list of `{ modId, version, required, side, source? }`; `source` says where dev runs get the jar: Modrinth by default (slug = modId, or `source.modrinth`; a mod Modrinth lacks is tried on CurseForge by `modId` when the computer has a CurseForge API key), `source.curseforge` (CurseForge project slug or numeric id; KUYRUK 173), or `source.maven` (`group:artifact:version`, `{loader}` and `{mc}` filled per engine) from `source.repository`. The CurseForge API key is set by the user in the app's Preferences (or `MCEDGE_CURSEFORGE_KEY`), never in the project. A new `id` or `package` goes through `change_mod_identity`, so ids and keys follow. Returns the settings and the problems about them. |
| `resolve_dependencies` *MCEdge* | `engines?`, `refresh?` | Downloads the jars of the dependencies for dev runs (KUYRUK 152): per engine the newest Modrinth (or CurseForge) version for its loader and Minecraft version that meets the dependency's version, plus the mods that version requires (or the Maven artifact). Each answer names its `source`; a CurseForge dependency without a key fails with a message saying where to set it, and a file its author keeps off third-party downloads fails too. Jars are cached once per machine as a local Maven repository under `<toolchains>/mods`; the generator adds them to the Gradle project (Fabric 1.21.5 `modImplementation`/`modRuntimeOnly`, Forge 1.16.5 `fg.deobf` copied into `run/mods` because FML 36 finds mods only there, NeoForge and Fabric 26.3 `implementation`/`runtimeOnly`; required dependencies also compile, optional ones are runtime only), so `runClient` and `runServer` load them. Builds, runs and exports resolve by themselves; a mod with no version for an engine is `unavailable` there, and a required one is also a generation warning. The generated metadata asks for the mod id the engine's jar really has (GeckoLib is `geckolib3` on 1.16.5). `refresh` looks for newer versions. |
| `list_dependency_jars` *MCEdge* | `engines?` | The same answer from the cache only (no network): per engine and dependency the status (`resolved`, `unavailable`, `failed`, `unresolved`), version, coordinates, jar file and `via` for a mod another one requires. The app reads it through `dependencyJars` (IPC `deps:jars`). |
| `change_mod_identity` *MCEdge* | `modId?`, `package?`, `dryRun?` | Changes the mod id and/or Java package and rewrites what names them: every `<old>:` id in elements, procedures, tags, variables, models and datapack files, the translation keys that carry the id (`item.<old>.ruby`), the `datapack/<old>` folder, and the package in element code. Checked first; a failed write leaves the project unchanged. Returns the files changed, keys renamed and values rewritten. |
| `validate_project` *MCEdge* | `include_ignored?` | Every problem the Problems panel shows, element tags included: `path`, `message`, `code` and `severity`. `error` blocks the CLI build (the generator, the compiler or the game would break: bad ids, missing texture files, broken references); `warning` (odd but builds and loads: a bad language code, a sound event's missing file, an unknown integration) and `info` (a legal but unusual value past a field's `warnAbove`/`warnBelow`, durability above 128000) do not. Problems the project ignores (`problems.json`) are left out; `include_ignored` lists them too, with `ignored: true` (KUYRUK 196). |
| `ignore_problem` *MCEdge* | `code`, `path?`, `undo?` | The Problems panel's Ignore: with `path` (as `validate_project` gives it) that one problem, without it every problem of check `code`; `undo` stops ignoring. Only warning and info checks; an error is refused (fix it). Writes `problems.json` (`{ ignore: [{ code, path }], ignoreChecks: [code], severity: { code: level } }`), committed with the project. Returns the settings. |
| `set_problem_severity` *MCEdge* | `code`, `severity` (`error`, `warning`, `info`, `default`) | Changes the severity of a warning or info check for this project (`problems.json`): `error` makes it block builds and keeps it from being ignored, `default` restores it. Error checks cannot be changed. |
| `list_integrations` | - | Optional mod integrations (config/integrations): name, the other mod per engine, `use` (off / optional / required) and the element fields each adds. |
| `set_integration` | `id`, `use` | Turns an integration off or on as an optional or required dependency: Gradle, mod metadata, generated code and the elements' fields (edited with `update_element`). |

## Element types and elements (Mod elements)

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_element_types` | - | Id, name, folder and description of the 37 element types. |
| `element_type_schema` | `type` | The type's pages, groups and fields (key, type, label, help, default, options, limits, showIf) and the JSON schema of its elements. Field formats: [ELEMENT-TYPES.md](ELEMENT-TYPES.md). |
| `list_elements` | `type?`, `query?`, `folder?`, `withProblems?`, `notGeneratedOn?`, `limit?`, `offset?` | Type, id, display name and folder of the elements, paged: `{ total, offset, limit, next, elements }`. The default page is 100 elements (about 11 KB), at most 500. `query` matches the id or display name, `folder` is a folder and everything below it (`""`: elements in no folder). `withProblems` keeps elements with validation problems (with their `problems` count), `notGeneratedOn` (an engine id) those whose type that engine does not generate, as the element list's filters. |
| `read_element` | `type`, `id` | The stored values. |
| `create_element` | `type`, `id`, `values?` | Type defaults plus `values`; ids are lower_snake_case and unique (recipes have their own namespace). Returns the element and its validation problems; it is saved either way, as the editor saves drafts. |
| `update_element` | `type`, `id`, `values` | The given top-level keys replace their values; returns the element and its problems. |
| `delete_element` | `type`, `id`, `dryRun?`, `cascade?`, `engine?` | Deletes the element file and its folder entry. The answer (and `dryRun`, which deletes nothing) lists what only this element used, the way the app's delete dialog does: procedures nobody else calls and GUIs nobody else opens that it reaches, recipes that make it, textures and models no other element names, translation keys no other element uses (what the generator of `engine` writes for it counts), each with its folder. What another element, tag or datapack file still uses is never listed. `cascade` deletes some of it too: `"all"` or `{elements: ["procedure/give_reward"], textures: [...], models: [...], langKeys: [...]}`; a name that is not in the list is refused and nothing is deleted. The folder entries of everything deleted (`folders.json`, `texture-folders.json` incl. `resources.models`) go with it. |
| `find_references` | `type`, `id`, `limit?` | Where the element is used and what it uses: elements, tags and datapack files naming it, by form (procedure field, element field, item/block field, procedure block, block id field, `java_code` class name or quoted id, any `"modid:id"` text, tag entry, datapack file) with the place inside each. Also its folder and, for procedures, its global trigger. The app's *Usages* button shows the same. |
| `unused_elements` | `types?`, `transitive?`, `limit?`, `offset?` | Elements nothing uses: no element, tag or datapack file names them and no global trigger runs them. Default types are `procedure` and `gui` (they do nothing until something points at them); other types are only listed when asked for. `transitive` also lists elements used only by unused ones. Per-type totals come with it. Nothing is deleted. The app's *Unused* button filters the element list the same way. |
| `rename_element` | `type`, `id`, `newId`, `dryRun?` | Renames an element and updates everything that names it: fields and procedure blocks, `java_code` class names (`<Id>Procedure`, `<Id>Block`, ...) and quoted `"modid:id"`, tags, datapack files, translation keys, `folders.json`, and texture files named after the element when nothing else uses them. Everything is computed and checked first (no reference may be lost, no derived-id collision) and a failed write puts the files back. `dryRun` reports the changes only; plain words in `java_code` are reported as notes, not changed. The app's *Rename* does the same. |
| `validate_element` | `type`, `id`, `include_ignored?` | Validation problems of one element with their `severity`; ignored ones are left out unless `include_ignored` (see `validate_project`). |
| `quick_search` | `query`, `kinds?`, `limit?` | One search over the whole project, like the app's Ctrl+K: elements (display name or id), textures, sounds, models, structures, lang keys (with their English text), variables and tags, best match first. Each hit has `kind`, `target` (`item/ruby`, a project path, a lang key, a variable name, `item:mymod:gems` for a tag), `label` and `detail`. |
| `list_registry_entries` | `kind` (`item`, `block`, `entity`), `query?`, `minecraft?`, `language?`, `limit?` | What the app's item/block/entity picker offers: this mod's elements (bare id and name), vanilla ids with their in-game names (the full list of that Minecraft version, read from a client jar an engine's Gradle downloaded; a short bundled list before any engine ran) and tags. Write any of these, or another namespaced id, into item/block/entity fields and recipe slots. |

All element tools are *MCEdge* only.

## Whole jobs (KUYRUK 145)

Tools that do a whole job in one call, so an agent does not loop over the element tools. Writes are atomic: every op is
checked against the project as the earlier ops leave it, then the resulting project is validated; nothing is written
when an op cannot run, or when the result has problems the project did not have (`allowProblems` writes anyway).
`dryRun` only reports. The answer lists `errors` by op index, `newProblems`, `fixedProblems` and the changes.
`tools/mcp-test/agent-tools.ts` tests them.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `project_summary` *MCEdge* | `engines?` | Element counts per type, problems (total, per element, the first ones), per engine what it leaves out of this project (skipped elements, fields set away from their default that it does not generate, procedure blocks and triggers it does not generate; counts plus examples) and the biggest procedures. Nothing is generated on disk. |
| `find_elements` *MCEdge* | `type?`, `where`, `select?`, `limit?`, `offset?` | Elements whose fields pass every condition `{ field, op, value? }`; `op` is `equals`, `not_equals`, `contains` (case-insensitive substring or list entry), `empty`, `not_empty` or `matches` (case-insensitive regex). `field` is a dot path; lists on the way are entered row by row (`drops.item`). Returns the values of the condition and `select` fields (long values by size only). |
| `batch_elements` *MCEdge* | `ops`, `dryRun?`, `allowProblems?` | Up to 500 ops `{ op: "create", type, id, values?, folder? }`, `{ op: "update", type, id, values }`, `{ op: "delete", type, id }` as one change. |
| `clone_elements` *MCEdge* | `elements` (`type`, `id`, `newId`, `values?`), `replace?`, `dryRun?`, `allowProblems?` | Copies a set of elements; a reference from one copy to another element of the set points at that copy (the rename scanner finds them), references outside the set stay. `replace` swaps text in every string of the copies (`Ruby` -> `Sapphire`). Copies go into their source's folder and share its textures. |
| `save_template` *MCEdge* | `name`, `description?`, `params`, `elements` | Saves elements to `templates/<name>.json`; each parameter's value becomes a placeholder in ids and strings, in four spellings (`name`=`ruby_gem`: `{{name}}` ruby_gem, `{{Name}}` RubyGem, `{{Name Words}}` Ruby Gem, `{{NAME}}` RUBY_GEM). |
| `list_templates` *MCEdge* | - | Templates with their parameters (and the example value each replaced) and elements. |
| `create_from_template` *MCEdge* | `name`, `params`, `folder?`, `dryRun?`, `allowProblems?` | Creates a template's elements with the parameters filled in; references between them follow the ids. |

## Locked generated code (KUYRUK 131)

Locking an element keeps the files the generator makes for it alone (its classes, models, loot table...; a file
another element also needs, such as a registry class or the lang file, is never locked) in
`locked-code/<type>/<id>/<engine>/`, versioned with the project. Edit them there; every generation writes them instead
of fresh ones while the element exists and the engine generates it, and the source map marks them `locked`. A
locked element cannot be renamed. The app locks and unlocks from the element menu, shows a lock on the tile and has
Build & run > Regenerate code. `tools/mcp-test/locked-code.ts` (with `--build`: all 5 engines build with a hand-edited
locked class) and `tools/ui-test/locked-code.ts` test it.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `lock_element_code` *MCEdge* | `type`, `id` | Locks: for every engine, the files the element owns (generated with it, absent without it) are written once into `locked-code/`. Returns them per engine. |
| `unlock_element_code` *MCEdge* | `type`, `id`, `force?` | Unlocks. When a locked file differs from what the generator makes now, it stays locked and returns per file the lines only the locked file has (`lost`) and the lines fresh code brings (`added`); `force` unlocks anyway. |
| `list_locked_code` *MCEdge* | `changes?` | Locked elements with their files per engine and whether the element still exists; `changes` adds how each file differs (`edited`, `gone`). |
| `regenerate_code` *MCEdge* | `engines?` | Build & run > Regenerate code: generates `out/<engine>` without building; returns skipped elements, warnings and the number of locked files written. |

## Procedures and mob AI

| Tool | Arguments | What it does |
| --- | --- | --- |
| `procedure_blocks` | `category?`, `query?` | Blocks with their inputs, fields, sides and per-engine generation. |
| `procedure_triggers` | - | Global triggers and the dependencies they provide. |
| `read_procedure` | `id`, `engine?`, `java?` | Settings, block program (IR JSON), needed dependencies, trigger dependencies, engine warnings, generated Java. |
| `write_procedure` | `id`, `program`, `title?`, `globalTrigger?`, `returnType?` | Creates or replaces a procedure from IR JSON (`{ format: 1, variables, stacks: [{ x, y, blocks }] }`); returns its warnings. |
| `write_ai_goals` | `entity`, `program` | A living entity's AI goals from IR JSON (goal blocks of category "ai"). |
| `entity_models` | - | Project entity models with their parts, texture size and animations. |

Bubbles (Q216) are ordinary elements of type `bubble`: `create_element` / `update_element` / `read_element` with the
fields of `element_type_schema` `bubble` (see docs/ELEMENT-TYPES.md); `procedure_blocks` `category: "bubbles"` lists
`bubble_show` (field `bubble`, registry `bubble_element`) and the other bubble blocks; `find_references` lists the
procedures showing a bubble. Show / hide timing (Q228) is the general element fields `appear`, `disappear` (lists of
`fade`, `scale`, `slide_up`, `slide_down`), `appearTicks`, `disappearTicks`, `appearEasing`, `disappearEasing` (`linear`,
`ease_out`, `ease_in_out`, `back`) and, for bubbles, `duration` (the active time): `update_element` sets them like any
field, and `element_type_schema` lists them (`bubble`, `radial_menu` with the opening transition only). The old
`animation` / `animationTicks` fields are gone; saved values load as the new ones. Check: `node tools/codegen-test/bubble-mcp-check.ts`.

Seatable blocks (Q225) are block fields: `update_element` a block with `seatable: true` and `seats` (rows `x`, `y`, `z` in
block pixels for the block facing north, `yaw` from its front, `pose` `sit` or `lie`), `seatHeightMode` (`auto` from the boxes, `manual` uses
`y`), `seatEmptyHand`, `seatDismount` (`top`, `front`, `back`); `element_type_schema` `block` lists them on the `seat`
page (see docs/ELEMENT-TYPES.md). `procedure_blocks` `category: "entity"` lists `entity_sit_on_block`,
`entity_is_sitting` and `entity_stand_up`. Multi-blocks (Q226): `multiBlock: true` on a plain block lets its
`boundingBoxes` reach past 0..16; every covered cell becomes a part of the block (`element_type_schema` `block`,
`bounding_boxes` page). Check: `node tools/codegen-test/seat-mcp-check.ts`.

Radial menus (Q227) are ordinary elements of type `radial_menu`: `create_element` / `update_element` / `read_element` with
the fields of `element_type_schema` `radial_menu` (tabs with slices, see docs/ELEMENT-TYPES.md). `procedure_blocks`
`category: "gui"` lists `radial_open`, `radial_close` and `radial_set_slice` (field `menu`, registry
`radial_menu_element`), `category: "bubbles"` `runtime_image_bubble`; `procedure_triggers` lists `radial_slice_chosen`;
`find_references` lists the procedures opening a menu. Runtime image folders are server files
(`config/<modid>/<folder>/`), not project files. Check: `node tools/codegen-test/radial-mcp-check.ts`.

## Variables and localization

| Tool | Arguments | What it does |
| --- | --- | --- |
| `get_variables` | - | Global variables: name, type, scope, initial value. |
| `export_texture` | `path`, `target` | Copies a project texture, with its `.mcmeta`, to an absolute path outside the project. |
| `set_variables` | `variables` | Replaces the list; names are Java identifiers, unique. |

| `list_folders` (`path?`, `full?`), `edit_folder`, `move_to_folder` (`folder`, then `elements` or a selector `pattern`/`type`/`query`/`from`, `dryRun?`) | Folders of the element list (folders.json); they organise the project and change nothing in the mod. `list_folders` summarises by default (per folder: direct elements, elements below, subfolders, plus the count of unfiled elements); `full` gives every placement. `edit_folder create` makes missing parents and answers with what changed; `edit_folder color` sets a tile colour (`#rrggbb`) and `edit_folder icon` a tile icon drawn in it (chest, book, sword, hammer, gem, gear, box, tag, star, potion, leaf, heart; `""` is the folder icon; KUYRUK 178). `move_to_folder` selects by glob on the id, type, text and current folder, or takes an explicit list; the app moves a Ctrl/Shift multi-selection the same way |
| `get_localization` | `language?` | Lang key -> text for one language code (`en_us`) or all. |
| `set_translations` | `language`, `entries` | Sets keys of one language; `null` removes a key; a new code adds the language. New keys that are not lower case dot-separated parts or have no mod id part are saved and listed under `warnings`. |
| `list_translation_keys` | `filter?`, `query?`, `prefix?`, `limit?`, `offset?`, `engine?` | The Localization screen's list: typed keys plus every key elements create (names, and what the generator of `engine` writes: GUI titles and labels, tooltips, advancement texts...), with texts per language, the element, missing languages and placeholder mismatches. `filter`: `all`, `missing:<lang>`, `missingAny`, `sourceEmpty`, `placeholder`, `edited`, `elements`. |
| `list_languages` | `available?` | The project's languages with their name, texts and key count; `available` adds Minecraft's languages the project lacks. |
| `add_language` | `code`, `copyFrom?` | Adds a language, empty or starting with another language's texts (from `en_us` including element names). |
| `rename_language` | `from`, `to` | Moves a language to another code; the file is renamed. `en_us` stays. |
| `remove_language` | `code` | Removes a language and deletes its file. `en_us` stays. |
| `unused_translation_keys` | `languages?`, `remove?`, `engine?`, `limit?` | Translation keys with text in a language file that nothing uses, per language: no element creates them (its name, what the generator of `engine` writes, or `<mod id>.<element id>` in the key), no element, procedure or GUI names them as a string, and the engine does not need them by name (sound subtitles, key binding categories, overrides of vanilla texts with `minecraft` in the key). A key a program builds from pieces is not seen and is listed. Nothing changes unless `remove` is true, which deletes the listed keys from the language files (`languages` limits it). The app's Problems tab shows the same keys, one info entry per language, with a Remove button. |
| `export_translations` | `path`, `format`, `languages?`, `language?`, `filter?`, `query?` | Writes translations to an absolute path: `csv` (key + one column per language, UTF-8 with BOM, CRLF; en_us includes element names) or `json` (one language as a Minecraft lang file). Rows can be narrowed like `list_translation_keys`. |
| `import_translations` | `path`, `language?`, `apply?`, `addUnknown?` | Reads a CSV or lang JSON file and reports per language what is added, changed and unchanged, and keys the project lacks. Writes only with `apply`; unknown keys only with `addUnknown`; empty cells never clear a text. |

## Element tags

Tag lists in `tags.json`, generated as `data/<ns>/tags/<registry>/<path>.json` on every engine (1.16.5: item, block, entity_type,
fluid and function tags only; the others are skipped with a warning).

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_tags` | - | Every tag: type, id, entries. |
| `set_tag` | `type`, `id`, `entries` | Creates or replaces a tag. Types: item, block, entity_type, fluid, biome, function, damage_type, enchantment, game_event. A `<modid>:` id defines the mod's own tag, another namespace (`minecraft:logs`) adds entries to it. Entries: a mod element id, a vanilla id or `#ns:tag`. Returns the tag's problems. |
| `delete_tag` | `type`, `id` | Deletes a tag. |

## Textures (texture editor)

Colours are `#rrggbb`, `#rrggbbaa` or `transparent`; reads return `#rrggbbaa`.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_textures` | - | Project PNGs with their size. |
| `create_texture` | `path`, `width`, `height`, `fill?` | New PNG under `textures/`, transparent or filled; never overwrites. |
| `read_texture` | `path`, `x?`, `y?`, `width?`, `height?` | Pixels as rows of colours, top row first. |
| `write_texture_pixels` | `path`, `pixels?`, `rects?`, `rows?` | Single pixels, filled rectangles and whole rows, applied in that order. |
| `resize_texture` | `path`, `width`, `height` | Nearest-neighbour scale (16 to 32 doubles every pixel). |
| `edit_texture_region` | `path`, `action` (`copy`, `move`, `clear`), `rect` {x, y, width, height}, `to?` {x, y}, `toPath?` | The texture editor's selection: copy a rectangle to another place (or into another texture), move it (the old place becomes transparent) or clear it. |
| `resize_texture_canvas` | `path`, `width`, `height`, `anchor` (default `center`) | Resize canvas without scaling: the picture keeps its pixels at the anchor, new space is transparent. |
| `adjust_texture` | `path`, `hue?` (-180 to 180), `desaturate?` (0 to 1), `rect?` | Adjust colours: shift the hue, take out colour; the whole texture or a rectangle. |
| `delete_texture` | `path` | Refused while an element or the mod logo uses it. |
| `set_texture_animation` | `path`, `frametime?`, `interpolate?`, `frames?`, `mode?`, `still?` | The texture editor's Animation panel: a vertical strip of square frames with `<png>.mcmeta`. `mode` (Q229): `loop` (default), `hold_last` (play once, stay on the last frame), `hold_first` (play once, then show the first frame), `ping_pong` (forwards, then backwards); stored in the .mcmeta's own `"mcedge"` section, which the game ignores, and generated as the vanilla frame list that plays it. Blocks and items start a once mode when the player enters a world (and after a resource reload); GUI images when their `animationStart` says (`open`, `always`, `procedure`: the `gui_image_restart` block). `still: true` deletes the .mcmeta. |

## GUI and overlay layouts (layout editor)

| Tool | Arguments | What it does |
| --- | --- | --- |
| `read_gui_layout` | `type` (`gui` or `overlay`), `id` | Widgets, canvas size (overlays 427x240), the player inventory frame of GUIs with slots, grid settings. |
| `write_gui_layout` | `type`, `id`, `widgets` | Replaces the widgets (format: ELEMENT-TYPES.md "GUI widgets"). Overlays take labels, images and state images only; slot indexes are unique; images (a state image's states too) and procedures must exist. |
| `overlay_layout` | `id`, `screens` (window sizes, optional), `guiScale` (0 auto) | Where an overlay's widgets land on players' screens: the GUI scale the game picks, the screen in canvas pixels, window pixels per canvas pixel, each widget's anchor and top left, flagged `outside` when it reaches past the screen. The overlay's `anchor`, `scaleMode`, `fixedScale` are fields (`update_element`). |
| `read_tab_order` | `tab` | A mod creative tab's contents in order: elements (`type`, `id`) whose `creativeTabs` name it, titled sections, section ends and spacers; elements not ordered yet come last. |
| `write_tab_order` | `tab`, `order` | Sets the order (entries `{kind: "element", type, id}`, `{kind: "section", title}`, `{kind: "spacer", slots?}`, `{kind: "end"}`: the rows after it stand outside sections, an end closing no section is dropped); elements must be in the tab, members left out are appended. Sections and section ends start a new row and spacers leave empty slots on 1.16.5; from 1.20 only the order shows. |

The screen settings of a GUI (size, slots, background, triggers) are ordinary fields: `update_element`.

## Resources (Resources > Import, File > Export workspace)

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_resources` | - | Sounds, models and structures with the id elements use (`<modid>:<name>` or the model name); models also give their kind (`json`, `obj`, `java`, `bbmodel`) and the element fields using them (`block/ruby_lamp.customModelName`). Assign a model with `update_element` on a `model` field whose `modelKinds` lists that kind; `coverage` shows what each engine generates. |
| `import_resources` | `kind` (`sound`, `model`, `structure`), `files` (absolute) | Copies .ogg / .json .java .obj .mtl / .nbt files; a Blockbench `.bbmodel` becomes a JSON block model with its textures in `textures/block`. |
| `minecraft_ids` | `kind?`, `query?` | Tools > Minecraft data lists: the game ids the editor knows by kind; without kind the kinds and counts. |
| `list_common_tags` | - | Tags > Common tags: common tags with the elements of this mod each suggests; add one with `set_tag`. |
| `clear_gradle_caches` | - | Build & run > Clear Gradle caches: removes out/<engine>/build and .gradle. |
| `import_workspace_zip` | `zip`, `parent` (absolute) | File > Import project from ZIP: extracts a workspace export into a new folder under parent. |
| `create_pack` | `kind` (`ore`, `tool`, `armor`, `wood`, `material`), `name`, `id?`, `color` (#rrggbb), `look?` (`ingot`, `gem`), `preview?` | Tools > Create pack: elements with tinted textures and recipes from one name and colour; existing ones are kept; `preview` only lists them. |
| `list_sound_events` | - | Sound events (Resources > Sounds): one per `sounds/<name>.ogg`, or as `sound_events.json` lists them, with category, subtitle (lang key `subtitles.<modid>.<name>`) and files. |
| `set_sound_event` | `name`, `category`, `subtitle`, `files`, `previous?` | Create, change or rename a sound event; the subtitle text goes to the base language, translate the key with `set_translations`. Generated as sounds.json entries on all 5 engines. |
| `delete_sound_event` | `name` | Remove a listed event and its subtitle; its files become events of their own names. |
| `list_animations` | - | Model animations in models/ (Resources > Animations), with length and loop mode. |
| `model_textures` | `block`, `set?` | Texture slots of a block's custom model (JSON variables without `particle`, OBJ materials), what the model names for each and the project texture the block maps it to (`customModelTextures`). `set` maps slots (`{"0": "textures/blocks/x.png"}`, `""` removes one) and saves the block; generated on all engines as the block model's own textures over the model's. A Java model (renderType 4) draws with the main texture. |
| `edit_in_blockbench` | `model`, `action?` (open, sync, stop), `block?`, `launch?`, `program?` | Edit in Blockbench (KUYRUK 171): copies the JSON model and the project textures it names (with `block`, that block's `customModelTextures`) to a work folder (`assets/<ns>/models`, `assets/<ns>/textures`), starts Blockbench on it and copies its saves back (the model with the block's own slots put back, changed textures to their files, new ones to `textures/<path>.png`). `sync` copies back now, `stop` ends the watch. |
| `texture_folders` | `kind?` (textures, sounds, models, structures), `action?` (list, create, rename, remove, move, move_folder, color, icon), `path?`, `name?`, `items?` (or `textures?`), `folder?`, `color?`, `icon?`, `deleteContents?`, `dryRun?`, `full?` | Folders of the Resources lists (KUYRUK 177, Q211; texture-folders.json: the Textures list at the top level as always, the other lists under `resources.<kind>`; they only organise a list, files, element fields and the mod do not change, so references stay valid). Items are texture paths, sound event names (as `list_sound_events`), or model and structure paths. Folders nest ("Gems/Red"). `list` gives counts, colour and icon; `create` (with parents), `rename`, `move_folder` (`path` into `folder`, "" = top), `color` ("#rrggbb", "" clears) and `icon` change a folder; `move` puts many `items` into `folder` at once ("" takes them out). `remove` deletes a folder: its items and subfolders go up to the parent, or with `deleteContents` its subfolders go and so do the items in it (items an element uses, and the logo for textures, are kept, moved up and reported as `kept`; a listed sound event is removed but its sound files stay; `dryRun` lists what would go). |
| `delete_resource` | `path` | Refused while an element names it. |
| `export_workspace` | `file` (absolute .zip) | Zips the project without `out/`, `build/`, `run/`, `.gradle`, `.git`. |
| `coverage` | `type?` | Fields each engine does not generate (the "not generated" badges). |

## Build, run, logs (Build & run, Tools)

`engine` is an engine id (`fabric-1.21.5`, `fabric-26.3`, `neoforge-1.21.5`, `neoforge-26.3`, `forge-1.16.5`) for
MCEdge projects and is ignored for Gradle mods. Long runs are non-blocking: start them, then poll their log.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `build` | `engine` | Generates and builds; returns success, the jar and compiler errors or the log tail. The full log is `out/<engine>/build/mcedge-build.log` (`read_file`). |
| `build_errors` *MCEdge* | `engine`, `warnings?` | The compile errors of the last build, each pointed back at its source: the element whose class it is, for procedures the block (IR path as `read_procedure` gives it, block id and fields), and `fields` whose value is on the failing Java line. A failed `build` returns the same list as `sources`. |
| `export_jar` | MCEdge: `engines`, `folder` (absolute), `pattern?`; Gradle mod: `folder` | File > Export mod jar: builds each engine and copies its jar under the name pattern (`{modid}-{modversion}-{loader}-{mc}.jar`); a Gradle mod is built with its own wrapper and its jar copied. An MCEdge export in which every engine builds is remembered for `changelog`. |
| `changelog` | - | The Export dialog's changelog draft (KUYRUK 168): commits since the last export in which every engine built (`.mcedge/last-export.json`), with `since`, `sinceMissing`, `truncated`, `uncommitted` and Markdown `text`. |
| `run_client` / `client_log` / `stop_client` | `engine`, `username?`, `join_server?` / `username?`, `lines?`, `filter?` / `username?` | Minecraft client with the mod. Several clients run at once with different player names (`username`, default `Dev`; 3-16 letters, digits or `_`), each with its own log (`build/mcedge-run.log` for Dev, `build/mcedge-run-<name>.log` for the others) and stopped on its own (`stop_client` without `username` stops all). They share the engine's Gradle project and `run/` folder; only the first client of an engine regenerates the project. `join_server` connects straight to the test server of `run/server.properties` on this machine (quick play on 1.21.5 and 26.3, `--server`/`--port` on 1.16.5). On forge-1.16.5 the client's authlib services point at an address that refuses connections, so the game falls back to offline social interactions and its Multiplayer button works (the fake dev token otherwise gets no multiplayer privilege). Clients an agent starts (this, `debug_client`, `observe_run`) are silent: master volume 0 in `run/options.txt`, other options kept; `MCEDGE_TEST_SOUND=1` keeps the sound. The app's own runs are not muted. |
| `debug_client` / `debug_log` / `stop_debug_client` | `engine` / `lines?`, `filter?` / - | Client with a JDWP agent on localhost:5005. |
| `run_server` / `server_log` / `stop_server` | `engine` / `lines?`, `filter?` / - | Dedicated server (the local test server's EULA is accepted, `online-mode=false` is set so dev clients without a Mojang session can join, RCON is turned on in `run/server.properties` with a fresh port and password for `server_command`); ready when the log shows `Done (`. |
| `server_command` | `commands` | Runs commands on the server `run_server` started, over RCON as the console, and returns each reply. |
| `log_problems` | `source` (`client`, `server`, `debug`), `username?` (client of that player, default Dev), `warnings?`, `modOnly?`, `limit?` | Errors and warnings of the running or last run, grouped: log4j ERROR/WARN/FATAL lines (Forge, NeoForge and Fabric formats), uncaught exceptions with their first stack lines, Gradle failures; repeats (same text once numbers are masked) count once, errors first. A stack frame in the mod's own code is pointed at its element and procedure block through the source map (`origin`). `modOnly` keeps problems that mention the mod id or package. |
| `game_screenshot` | `username?` | The game window of the client `run_client` (of `username`; else Dev's or the first running) or `debug_client` started, as an image plus the saved PNG path (the window's own image, even behind other windows; Windows only). |
| `editor_screenshot` | `screen?` | The running MCEdge editor window, plus what the user has open (as `collaborators`). With `screen` the app switches there first (KUYRUK 153): a section (`tags`), a resources tab (`resources/models`), an element editor (`item/ruby`), a dialog (`dialog/preferences`, `dialog/about`, `dialog/docs` (the user guide), `dialog/shortcuts`) or a bottom panel (`panel/agents`, `panel/problems`, `panel/build`, `panel/gradle`; `panel/activity` and `panel/tasks` open the Agents panel at the latest session or the tasks). The server writes `.mcedge/live/show.json`, the app switches and confirms in `presence-app.json`; an unknown screen or a missing element is an error. |
| `observe_run` | `side`, `engine`, `commands?`, `waitSeconds?`, `timeoutSeconds?`, `screenshot?`, `username?`, `joinServer?`, `keepRunning?`, `warnings?`, `modOnly?`, `limit?` | A whole test run: starts the client or server unless it runs, waits for ready (server `Done (`, client title screen) or a crash, runs the server `commands`, waits, returns the replies, the grouped problems (as `log_problems`), a client screenshot if asked, and stops the run unless `keepRunning`. `tools/mcp-test/observe.ts` tests these. |
| `gradle_task` | `engine`, `tasks`, `lines?` | Any Gradle tasks (Tools > Gradle console); `["help"]` is Reload Gradle project. Waits and returns the exit code and log tail. |

### Scenarios and tick profile (Q218, Q219)

Two tools run the project on a dedicated server of one engine with a test probe, wait for the answer and stop the
server. The probe is generated into that run's `out/<engine>` only (`<package>.probe.<Mod>ModProbe`, plus `...ProbeGame`
for the vanilla calls): never by `build`, `run_server`, `run_client` or `export_jar`, so an exported jar has none (the CLI
has `build <dir> --target <engine> --probe` or `--profile` for a check build). A later normal run regenerates the sources
without it. The scenario goes to `out/<engine>/run/mcedge-probe/scenario.json`, the probe answers in `result.json`. A
running `run_server` must be stopped first.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `run_scenario` | `engine`, `scenario` or `file` (absolute or project-relative JSON), `timeoutSeconds?` | Runs the scenario and returns `{ ok, passed, failed, errors, steps }`: per step its `value`, `pass` and `expected` when it has `expect`, an `error`, the `messages` the fake players received during it (Forge 1.16.5 and NeoForge), the server `tick` and `ms`. A malformed scenario is refused before any build. |
| `tick_profile` | `engine`, `seconds?` (30), `warmupSeconds?` (5), `players?` (1), `top?` (10), `all?`, `timeoutSeconds?` | A profile build (every procedure times its calls) runs `players` ticking fake players for `seconds`; the answer lists the tick-triggered procedures (global player, world and server ticks, and element fields with a server tick trigger: block, item inventory and effect ticks) by `usPerTick`, with `calls`, `callsPerTick`, `usPerCall`, `totalMs` and the `triggers` that run each. Times include procedures a procedure calls; `all` also lists procedures no tick trigger runs. |

A scenario is `{ "name"?, "steps": [ ... ] }`. Every step has an `op` and may have a `label` and an `expect`: a plain value
(numbers compare as numbers) or `{ "contains": "x" }`, `{ "matches": "regex" }`, `{ "min": 1, "max": 5 }`, `{ "not": ... }`.
Steps run in order, each on the server thread; a failing step does not stop the rest. `pos` is `[x, y, z]`, `dimension` is
`overworld` (default), `nether`, `end` or `namespace:path`, `player` names a fake player (the only one when omitted).

| `op` | Keys | Value |
| --- | --- | --- |
| `player` | `name`, `pos?`, `dimension?`, `ticking?` | Creates a fake player. `ticking` makes it run its player tick once per server tick during `wait` steps (tick events and tick procedures). |
| `removePlayer` | `name` | |
| `setblock` | `pos`, `block` (`id[state]`) | The block there afterwards (the chunk is loaded and kept loaded). |
| `command` | `command`, `player?` | The command's result; as the player when given. Also the way to `summon`, `fill`, set a game rule... |
| `give` | `item`, `count?`, `name?`, `hold?`, `player?` | How many of the item the player has. `hold` puts it in the main hand. |
| `setSlot` / `closeMenu` | `slot`, `item?` (empty clears), `count?`, `player?` / `player?` | Sets a slot of the player's open menu / closes it. |
| `useBlock` / `useItem` / `useEntity` | `pos`, `face?`, `hand?` / `hand?` / `target`, `hand?` | Right-click as the fake player through the game's interaction path (loader events fire). `target` is another fake player's name or `{ type, pos, radius? }` for the nearest entity. The result name (SUCCESS, PASS, ...). |
| `call` | `procedure`, `args?`, `pos?`, `dimension?`, `player?` | Calls a procedure by element id. `args` are by dependency name: `world` (dimension), `x`, `y`, `z` (default the player's or `pos`), `entity`, `sourceentity` (fake player names; the single player by default), numbers, text, `logic`. The procedure's return value. |
| `set` | `name`, `value`, `player?`, `dimension?` | Writes a project variable (player, world or global). Needs a project with procedures (the variables class is generated with them). |
| `setBlockData` | `pos`, `key`, `value`, `type?` | Writes a value a procedure keeps at a block position. |
| `read` | `what`, ... | `var` (`name`), `block` (`pos`: `id[state]`), `blockdata` (`pos`, `key`, `type?`: number, text, logic), `count` (`item?`), `inventory` (item -> count), `position`, `menu` (menu class and slot count), `slot` (`slot`: `5 x id`), `bubble` (icon or bubble id, caption, ticks left). |
| `wait` | `ticks` | Waits for server ticks. |
| `profile` | `action` (`reset`, `report`), `all?` | Only in profile builds (what `tick_profile` runs). |

`docs/scenarios/` has examples: `hello.json` (the example project: block, item, inventory) and the ETR probes as scenarios,
`etr-takas.json` (trade offer, pairing, third player, shared slots, swap, status bubbles), `etr-upvend.json` (the upgraded
vending machine: lock, open and close, sale) and `etr-jobslot.json` (builder slot items). Menus open for NeoForge and
Forge 1.16.5 fake players; the Fabric API fake player has no client, so `messages` stay empty there. `tools/mcp-test/scenario.ts`
and `tick-profile.ts` run both tools end to end, `scenario-run.ts <project> <engine> <file>` runs one file.

Seeing another player (KUYRUK 221): a player's own name tag never shows, so anything drawn over a player's head (a bubble
over the name tag) needs a second player in view. No extra option is needed: `run_server`, then `run_client` with
`username: "Dev2"` and `join_server: true`, then `run_client` (Dev, `join_server: true`), and when both joined,
`server_command` `["execute as Dev2 at Dev2 run tp Dev ^ ^ ^3 facing entity Dev2 feet"]` puts Dev 3 blocks in front of Dev2
looking level at it (`feet` is the anchor the look is measured from; `eyes` would tilt Dev's view up), then `game_screenshot`
with `username: "Dev"`. For something in the air, build a stone platform first with `fill` so no world blocks are in the
picture. `tools/codegen-test/bubble-other-check.ts <engine>` does this for the designed bubble of the test project and saves
`design/221/bubble-other-<engine>.png` (usage in its header).

Source map: generating an engine also writes `out/<engine>/mcedge-sourcemap.json` (the Java is unchanged). It maps each
generated `.java` file to the element that made it (procedure classes by name, other classes by the element's PascalCase
id prefix) and, for procedure classes, line ranges to blocks: the procedure is compiled once more with a marker before
every statement and the marker lines give the ranges; if the markers changed the code, that procedure has no line map.

## Files (code project mode and anything else)

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_files` | `path?`, `extension?` | Project files, without build output and caches. |
| `read_file` | `path`, `startLine?`, `endLine?` | Numbered lines. |
| `write_file` | `path`, `content` | Creates or overwrites. |
| `edit_file` | `path`, `oldText`, `newText`, `replaceAll?` | Exact replacement; fails when the text is missing or not unique. |
| `search` | `pattern`, `path?`, `extension?` | Regex search; `path:line: text`. |

## Git (Git panel)

Runs the git CLI on PATH with the user's own config and credentials.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `git_status` | - | Branch, upstream, ahead/behind, remotes, changed files (`index`/`worktree` state; `?` untracked). |
| `git_init` | - | Creates a repository in the project folder. |
| `git_diff` | `path`, `staged?` | Unstaged or staged diff of one file; an untracked file shows whole. |
| `git_stage` / `git_unstage` | `paths` | Stage or unstage files. |
| `git_discard` | `paths` | Drops working-tree changes; untracked files are deleted. |
| `git_commit` | `message`, `all?`, `branch?` | Commits the staged changes, or everything; with `branch`, on that new branch (created from the current commit and switched to first). Returns the short hash and the branch. |
| `git_branches` | - | Local branches: `name`, `current`, `upstream`. |
| `git_create_branch` | `name`, `checkout?`, `from?` | Creates a branch from the current commit (or `from`) and switches to it unless `checkout=false`; uncommitted changes go along. |
| `git_switch_branch` | `name` | Switches branch; git refuses when uncommitted changes would be overwritten. |
| `git_log` / `git_show` | `limit?`, `all?` / `hash` | History, newest first with children before parents: `hash`, `short`, `author`, `date`, `subject`, plus `parents` (full hashes, first parent first; none for a root, two or more for a merge) and `refs` (git's decorations: `"HEAD -> main"`, `"origin/main"`, `"tag: v1.0"`). `all=true` lists every branch, remote branch and tag (not the stash), enough to draw the branch graph; the default stays the current branch. `git_show`: one commit with its patch. |
| `git_revert` | `hash` | A new commit undoing one. |
| `git_pull` / `git_push` | - | Fast-forward pull; push (sets the upstream on origin the first time). |

## Live co-editing

The user in the app and an agent over MCP can change the same project at the same time; there is no approve or
reject step.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `collaborators` | - | What the user has open in the app (`item/ruby`, `resources`, ...) while it runs, the latest agent changes and how many notes of the user wait. |
| `begin_step` | `title`, `model?` | Starts a named step of the agent's work; the app groups the following calls under it and can undo it in one click. `model` names the model the agent runs on (`claude-opus-4-5`, `gpt-5-codex`, `gemini-2.5-pro`, `deepseek-chat`); it is kept for the rest of the session and files the session in the app's Agents panel (KUYRUK 195). The result text is unchanged. |
| `read_notes` | `all?` | Notes the user left for the agent in the app (id, time, text, target such as `item/ruby` or `item/ruby#stackSize`), unacknowledged ones unless `all`. |
| `ack_note` | `id`, `reply?` | Marks a note handled, with an optional reply the app shows under it. |

How it works:

- The project files stay the single source of truth. The app watches the project folder; a change it did not
  write itself (recognised by content) reloads the project.
- An element open in the editor is merged three ways, field by field: the version the editor last loaded or saved
  (base), the user's draft, and the file on disk. A field only one side changed takes that side; a field both
  changed keeps the user's value, which is then saved. Block programs reload in place when the agent changed
  them. The MCP element tools only replace the keys they are given, so the merge holds in that direction too.
- Code project mode reloads open files the agent changes, and so does the texture editor (Undo brings the previous
  pixels back); a file with unsaved edits keeps them, pauses saving and offers Reload from disk (texture editor: or
  Keep my strokes).
- Every tool call is logged to `.mcedge/live/activity.jsonl` (time, session, step, tool, target, the fields it worked
  on, the MCP client's name and version from `initialize` as `client` and `clientVersion`, and the model the agent
  named in `begin_step` as `model`; the last two only when known, older lines lack them) and refreshes `.mcedge/live/presence-agent.json`; the app writes `presence-app.json`. The folder ignores itself
  in git.
- Agent timeline (KUYRUK 144). Around every changing call the server compares the project files before and after
  (build output, `schemas` and `.mcedge` aside; long runs such as `build` are not compared) and logs a field-level
  diff: for a JSON file the top-level keys with their old and new value, for other files created, changed or deleted.
  The before/after itself goes to `.mcedge/live/changes.jsonl` (files up to 256 KB, a call up to 2 MB, the store keeps
  its newer half past 8 MB; a change beyond that is shown but cannot be undone).
- Calls form steps: a `begin_step` names one, which lasts until the next `begin_step` or five idle minutes; otherwise a
  step ends when the agent moves from a change to another target or pauses for 30 seconds. One MCP server run is one
  session.
- The app shows it in the Agents panel (KUYRUK 195; it replaced the Agent activity and Agent tasks panels, and
  `panel/activity` and `panel/tasks` still open it at the latest session or the tasks). On its left are the tasks and
  a folder per agent, by how the agent introduced itself: the client name first, else the model it named (Claude for
  `claude-code`/`claude-ai`/Claude models, OpenAI Codex for `codex`/OpenAI/GPT, Gemini, Antigravity, DeepSeek, Cursor,
  Kiro, everything else under Other agents). In a folder the sessions are grouped by their last call: Today,
  Yesterday, This week (from Monday), then by month; folders stay open or closed per project. On the right is the
  selected session: the tasks it held, its steps and calls (reads too, with Show reads), each
  change with its fields' before and after. The element the agent works on is marked in the element list ("Agent
  here") and the fields it works on in the open editor. Undo step and Undo session take the selected step or the whole
  session back, newest call first, all or nothing: when a field the agent wrote holds another value now (the user, or
  anything else, changed it since), nothing is written and the conflicts are listed (file, field, what the agent
  wrote, what is there now). Fields the agent did not touch are never compared or overwritten.
- Notes: the user writes a note for the agent in the same panel (about the selected step's element by default). The
  next tool result of the agent ends with the new notes; `read_notes` lists them, `ack_note` answers them and the app
  shows the reply.

## Tasks for the agent

The user gives the agent tasks in the app (KUYRUK 146): right-click an element tile, a field of the open editor, a
problem row or a line of the build output and choose New task for the agent, or use New task under Tasks in the
Agents panel. Each task is one file in `.mcedge/tasks/<id>.json` (versioned with the project) with its title, details, what
it is about, status, owner, progress, result and the user's review.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_tasks` | `status?` | Tasks, oldest first; by default the ones to work on (open and claimed). A reopened task carries the user's reason in `review.comment`. |
| `claim_task` | `id`, `takeOver?` | Takes a task (status claimed, owner = this session). One another session holds needs `takeOver`. |
| `update_task` | `id`, `progress` | Adds a progress line to a task this session claimed. |
| `complete_task` | `id`, `result` | Finishes it with a result; the user then accepts it or reopens it with a reason (it is open again, without owner). |

Every tool result tells the agent about open tasks it has not seen yet. While a task is claimed, the agent's calls are
marked with it in the timeline, and the task links to those steps in the app.

Why not a CRDT (Loro): both writers would need to share one CRDT document, but the agent edits through MCP tools
and plain file tools in a separate process, git and other editors write the same JSON files, and a project must
stay readable as plain files. Element JSON is small and structured, so a field-level three-way merge at the moment
a change arrives gives the same result for the cases that occur (different fields, different elements) without a
sync server, a binary document store or a second source of truth. A same-field clash resolves to the person
typing, deterministically.
