# Template gallery of verified starters (Q252)

A starter is a small set of elements with their textures (a sword, an ore, a mob, a machine with a GUI, a food, a
flower). The gallery opens from the welcome screen (Starter gallery...), which continues in New project, and from the
New element popup (From a starter...), which adds the starter to the open project. Agents use `list_starters`,
`create_from_starter` and `create_project` with `starter` (docs/MCP.md).

A starter asks for one word (`name`, for example `ruby`). Its element ids and texts are filled from it in four spellings
(`ruby_sword`, `RubySword`, `Ruby Sword`, `RUBY_SWORD`), the same placeholders as element templates (`{{name}}`,
`{{Name}}`, `{{Name Words}}`, `{{NAME}}`). Adding is one atomic batch, checked like `batch_elements`: nothing is written
when the project would get a problem or an id is taken, and a texture file that already exists is never replaced.

## Files

- `config/starters/gallery.json`: the starters, the `targets` (every engine in `engines/`) and, per starter and engine,
  the record of the last verification: `{ build, server, date, note? }`.
- `config/starters/<id>/starter.json`: the elements (an element template: only the fields that differ from the type's
  defaults), the textures (`from` a file of the folder, `to` a project texture) and the smoke `scenario`.
- `config/starters/<id>/*.png`: the textures.
- Names and descriptions: strings `starter.<id>.name` and `starter.<id>.desc` in `config/ui-strings` (en and tr).

## Listing rule

A starter is listed (the gallery, `list_starters`, New project) only when every target engine has a record with
`build: "pass"` and `server: "pass"`. A starter that is not listed is not offered; its records say why.

## Checks

- `node tools/starters/check.ts`: fast, no Gradle. Files, strings in every language, a clean add to a fresh project,
  refusals (taken name, bad word), a valid scenario, the listing rule.
- `node tools/starters/verify.ts [--engine <id>]... [--starter <id>]...`: the slow check that writes the records. For
  each engine it builds all starters in a copy under the temp folder (a real Gradle build; when that fails, each starter
  alone, to name the one that breaks), then runs their scenarios on a dedicated server with the test probe (`run_scenario`
  steps) and records the result per starter. Headless: Gradle and the server run with `windowsHide`, no client starts.
  It stops when `C:/BrainOS/.ingame` exists (game mode). Run it again after a starter or an engine changes: a starter's
  record belongs to the files it was checked with.
- `node tools/mcp-test/starters.ts`: the MCP tools end to end.
- `npx tsx tools/ui-test/starters.ts [en|tr] [dark|light]`: the gallery, New project and New element in the app.

## Adding a starter

Make the elements in a project, copy their non-default fields into `starters/<id>/starter.json` with the name word as
`{{name}}` placeholders (what `save_template` writes), add the textures and the scenario, add the strings, add the entry
to `gallery.json`, run `check.ts`, then `verify.ts`.
