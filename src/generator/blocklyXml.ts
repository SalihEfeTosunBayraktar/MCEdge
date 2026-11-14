/**
 * Minimal reader for Blockly XML as MCreator stores it in element fields (feature definitions): blocks with their
 * fields, value inputs, statement inputs and the next block. Shadows count as blocks; mutations are ignored.
 */
export interface XmlBlock {
  type: string;
  fields: Record<string, string>;
  values: Record<string, XmlBlock>;
  statements: Record<string, XmlBlock>;
  next?: XmlBlock;
}

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function parse(xml: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = token.exec(xml); m; m = token.exec(xml)) {
    const top = stack[stack.length - 1];
    if (m[1]) stack.pop();
    else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const node: Node = { tag: m[2], attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[4]) stack.push(node);
    } else if (m[5]) top.text += decode(m[5]);
  }
  return root;
}

function toBlock(node: Node): XmlBlock {
  const block: XmlBlock = { type: node.attrs.type ?? "", fields: {}, values: {}, statements: {} };
  for (const child of node.children) {
    const inner = child.children.find((c) => c.tag === "block") ?? child.children.find((c) => c.tag === "shadow");
    if (child.tag === "field") block.fields[child.attrs.name] = child.text;
    else if (child.tag === "value" && inner) block.values[child.attrs.name] = toBlock(inner);
    else if (child.tag === "statement" && inner) block.statements[child.attrs.name] = toBlock(inner);
    else if (child.tag === "next" && inner) block.next = toBlock(inner);
  }
  return block;
}

/** Top-level blocks of a Blockly XML document. */
export function readBlocklyXml(xml: string): XmlBlock[] {
  const doc = parse(xml);
  const top = doc.children.find((n) => n.tag === "xml") ?? doc;
  return top.children.filter((n) => n.tag === "block").map(toBlock);
}

/** A block and the blocks chained after it through "next". */
export function chain(block: XmlBlock | undefined): XmlBlock[] {
  const out: XmlBlock[] = [];
  for (let b = block; b; b = b.next) out.push(b);
  return out;
}
