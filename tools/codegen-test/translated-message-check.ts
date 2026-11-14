// KUYRUK 49: the translated message block (player_message_translated) is generated on every engine, sends a translatable component
// (key and arguments, no server-side lookup) and has its labels and tip in both block languages.
// usage: node tools/codegen-test/translated-message-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../src/paths.ts";
import { blockGenerated } from "../../src/procedures/analyze.ts";
import { BLOCKS_BY_ID } from "../../src/procedures/blocks/index.ts";
import { HELPERS, helperCode } from "../../src/procedures/helpers.ts";

const def = BLOCKS_BY_ID.get("player_message_translated");
assert.ok(def, "block exists");
const j = new Proxy({}, { get: (_t, k) => String(k) }) as Record<string, string>;
for (const [gen, loader] of [["1.16.5", "forge"], ["1.21.5", "neoforge"], ["1.21.5", "fabric"], ["26.3", "neoforge"], ["26.3", "fabric"]] as const) {
  assert.ok(blockGenerated(def, gen, loader), `generated on ${gen}/${loader}`);
  const chat = helperCode(HELPERS.chatTranslated, gen, loader)!(j);
  assert.ok(/translatable\(key, args\)/.test(chat) && !/getString\(|translate\(/.test(chat), `${gen}/${loader}: the component is sent, not resolved on the server`);
  const make = helperCode(HELPERS.translatable, gen, loader)!(j);
  assert.ok(/(TranslationTextComponent\(key, values\)|Component\.translatable\(key, values\))/.test(make), `${gen}/${loader}: translatable component with arguments`);
}
for (const lang of ["en", "tr"]) {
  const text = JSON.parse(readFileSync(join(ROOT, `config/procedure-blocks/${lang}.json`), "utf8")) as { blocks: Record<string, string>; tips: Record<string, string> };
  const label = text.blocks.player_message_translated;
  assert.ok(label, `${lang}: label`);
  for (const input of [...(def.inputs ?? []).map((i) => i.name), ...(def.fields ?? []).map((f) => f.name)]) assert.ok(label.includes(`%${input}`), `${lang}: label shows %${input}`);
  assert.ok(text.tips.player_message_translated, `${lang}: tip`);
}
console.log("translated-message-check OK");
