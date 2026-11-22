# Translating MCEdge

The interface language list is built from the files in `config/ui-strings/`. One file is one language; there is no
list to edit.

## Add a language

1. Copy `config/ui-strings/en.json` to `config/ui-strings/<code>.json`. The code is a lowercase language code such as
   `de`, `es` or `pt-br`.
2. Set `"language.name"` to the language's own name ("Deutsch"). This is what the language picker shows. Without it the
   picker shows the code.
3. Translate the values. Keep the keys, and keep every `{placeholder}` exactly as in English (`{name}` stays `{name}`);
   word order around it can change.
4. Run `node tools/check-translations.mjs`. It lists, per language, how many keys are translated, which keys are missing
   (they show English, so a half-finished file works), and fails on extra keys, empty values, a missing `language.name`
   and placeholders that differ from English. Add `--strict` to fail on missing keys as well.
5. Build (`npm run build:app`) and pick the language in Preferences, Language, or on the first-start dialog.

English (`en`) is the source and Turkish (`tr`) must stay complete. A new language may start with a few keys and grow;
a key it leaves out is shown in English.

## Related files

- `config/element-types/tr.json` and `config/procedure-blocks/tr.json` hold the texts of element types and procedure
  blocks. They have their own Turkish files today; a language without them shows English there.
- Game texts of a mod (the Localization view) are separate: those are Minecraft language files of the project, not the
  interface.

Pull requests with a translation only need the new `config/ui-strings/<code>.json`.
