// Lists the distinct anonymous classes (MCreator's one-method templates) of the parsed procedures by the number of
// procedures they appear in, as compact Java text. usage: node templates.ts [count] [text length]
import { readdirSync, readFileSync } from "node:fs";
import type { Ast } from "../java2blocks.ts";
import { java } from "../javaPrint.ts";

const dir = `${import.meta.dirname}/work/ast-out/`;
const found = new Map<string, { count: number; files: Set<string> }>();

function walk(node: unknown, file: string): void {
  if (Array.isArray(node)) return node.forEach((item) => walk(item, file));
  if (!node || typeof node !== "object") return;
  const tree = node as Ast;
  if (tree.k === "NEW_CLASS" && tree.classBody) {
    const text = java(tree.classBody.members.length === 1 ? tree.classBody.members[0] : tree.classBody);
    const entry = found.get(text) ?? { count: 0, files: new Set() };
    entry.count++;
    entry.files.add(file);
    found.set(text, entry);
  }
  for (const value of Object.values(tree)) walk(value, file);
}

for (const file of readdirSync(dir)) walk(JSON.parse(readFileSync(dir + file, "utf8")), file);
const sorted = [...found].sort((a, b) => b[1].files.size - a[1].files.size);
console.log(`${sorted.length} distinct`);
for (const [text, { count, files }] of sorted.slice(0, Number(process.argv[2] ?? 30))) {
  console.log(`#${count} in ${files.size} procedures, e.g. ${[...files][0]}\n${text.slice(0, Number(process.argv[3] ?? 700))}\n`);
}
