/** Checks the "type:name:min" form of command arguments. Run: node tools/codegen-test/command-args-check.ts */
import assert from "node:assert/strict";
import { argumentType } from "../../src/generator/types/command.ts";
import type { GenEnv } from "../../src/generator/typeModule.ts";

const env = { mc: "1.16.5" } as GenEnv;
assert.match(argumentType(env, "double"), /DoubleArgumentType\.doubleArg\(\)$/);
assert.match(argumentType(env, "double", "1"), /DoubleArgumentType\.doubleArg\(1\)$/);
assert.match(argumentType(env, "integer", "0"), /IntegerArgumentType\.integer\(0\)$/);
assert.match(argumentType(env, "double", "x"), /doubleArg\(\)$/, "a min that is not a number is ignored");
assert.match(argumentType(env, "unknown"), /StringArgumentType\.word\(\)$/);
console.log("command-args-check OK");
