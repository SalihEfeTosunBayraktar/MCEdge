'use strict';

const STRINGS = {
  lblN: 'Blocks:',
  collapsed: 'Collapse large sub-stacks',
  run: 'Run selected',
  all: 'Run all',
  running: 'Running ',
  done: 'Done',
  cols: ['Config', 'Blocks', 'Load ms', 'Render ms', 'Scroll FPS', 'Scroll worst frame ms',
    'Move ms', 'Collapse+expand ms', 'Save ms', 'Save KB', 'Heap MB'],
};

const COLLAPSE_MIN_SIZE = 40; // sub-trees at least this big are collapsed in the mitigation run
const SCROLL_MS = 3000;
const VARS = ['x', 'y', 'count', 'total', 'name'];

// ---- Workspace generator -------------------------------------------------

// Seeded PRNG so every run builds the same program.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function generate(total, collapseBig) {
  const rand = rng(42);
  let used = 0;
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const varField = () => ({ VAR: { id: 'v_' + pick(VARS) } });

  // Builders return { block, size }.
  function node(type, fields, inputs) {
    const block = { type, fields };
    let size = 1;
    const inp = {};
    for (const k of Object.keys(inputs)) {
      if (!inputs[k]) continue;
      inp[k] = { block: inputs[k].block };
      size += inputs[k].size;
    }
    if (Object.keys(inp).length) block.inputs = inp;
    return { block, size };
  }
  const leaf = (type, fields) => node(type, fields, {});

  function expr(depth) {
    const r = rand();
    if (depth > 3 || r < 0.35) {
      return rand() < 0.5
        ? leaf('math_number', { NUM: Math.floor(rand() * 100) })
        : leaf('variables_get', varField());
    }
    if (r < 0.8) {
      return node('math_arithmetic', { OP: pick(['ADD', 'MINUS', 'MULTIPLY', 'DIVIDE']) },
        { A: expr(depth + 1), B: expr(depth + 1) });
    }
    return leaf('math_number', { NUM: Math.floor(rand() * 100) });
  }

  function cond() {
    return node('logic_compare', { OP: pick(['EQ', 'LT', 'GT', 'NEQ']) }, { A: expr(2), B: expr(2) });
  }

  // A chain of statements using about `budget` blocks; returns the head or null.
  function chain(budget, depth) {
    const items = [];
    let left = budget;
    while (left > 0) {
      const s = stmt(left, depth);
      items.push(s);
      left -= s.size;
    }
    for (let i = items.length - 2; i >= 0; i--) {
      items[i].block.next = { block: items[i + 1].block };
      items[i].size += items[i + 1].size;
    }
    return items[0] || null;
  }

  function simple() {
    if (rand() < 0.65) return node('variables_set', varField(), { VALUE: expr(1) });
    const t = rand() < 0.5 ? leaf('text', { TEXT: 'str' + Math.floor(rand() * 1000) }) : expr(2);
    return node('text_print', {}, { TEXT: t });
  }

  function stmt(budget, depth) {
    const r = rand();
    if (budget < 6 || depth > 7 || r < 0.35) return simple();
    const inner = Math.max(2, Math.floor(budget * (0.3 + rand() * 0.5)));
    if (r < 0.65) {
      const s = node('controls_if', {}, {
        IF0: cond(),
        DO0: chain(Math.ceil(inner / 2), depth + 1),
        ELSE: chain(Math.floor(inner / 2) || 1, depth + 1),
      });
      s.block.extraState = { hasElse: true };
      return s;
    }
    if (r < 0.85) {
      return node('controls_repeat_ext', {}, { TIMES: expr(3), DO: chain(inner, depth + 1) });
    }
    return node('controls_whileUntil', { MODE: 'WHILE' }, { BOOL: cond(), DO: chain(inner, depth + 1) });
  }

  // One huge main stack (80%) plus a few smaller stacks.
  const stacks = [];
  let y = 0;
  const addStack = (budget) => {
    const c = chain(budget, 0);
    c.block.x = 0;
    c.block.y = y;
    y += 4000;
    stacks.push(c.block);
    used += c.size;
  };
  addStack(Math.floor(total * 0.8));
  while (used < total) addStack(Math.min(total - used, 40 + Math.floor(rand() * 60)));

  if (collapseBig) stacks.forEach(markCollapsed);

  return {
    state: {
      blocks: { languageVersion: 0, blocks: stacks },
      variables: VARS.map((n) => ({ name: n, id: 'v_' + n })),
    },
    count: used,
  };
}

function subtreeSize(b) {
  let n = 1;
  for (const k of Object.keys(b.inputs || {})) n += subtreeSize(b.inputs[k].block);
  if (b.next) n += subtreeSize(b.next.block);
  return n;
}

// Collapse statement blocks whose nested content (excluding "next") is large.
function markCollapsed(b) {
  let inner = 0;
  let hasStatement = false;
  for (const k of Object.keys(b.inputs || {})) {
    inner += subtreeSize(b.inputs[k].block);
    if (/^(DO|ELSE)/.test(k)) hasStatement = true;
  }
  if (hasStatement && inner >= COLLAPSE_MIN_SIZE) {
    b.collapsed = true;
  } else {
    for (const k of Object.keys(b.inputs || {})) markCollapsed(b.inputs[k].block);
  }
  if (b.next) markCollapsed(b.next.block);
}

// ---- Measurement helpers -------------------------------------------------

const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

async function settle() {
  if (Blockly.renderManagement && Blockly.renderManagement.finishQueuedRenders) {
    await Blockly.renderManagement.finishQueuedRenders();
  }
  await raf();
  await raf();
}

async function timed(fn) {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

async function scrollFps(ws) {
  const frames = [];
  const start = performance.now();
  let last = start;
  const sx = ws.scrollX, sy = ws.scrollY;
  while (performance.now() - start < SCROLL_MS) {
    await raf();
    const now = performance.now();
    frames.push(now - last);
    last = now;
    const p = (now - start) / SCROLL_MS;
    ws.scroll(sx - p * 3000, sy - Math.sin(p * Math.PI * 4) * 300 - p * 6000);
  }
  ws.scroll(sx, sy);
  return { fps: frames.length / ((last - start) / 1000), worst: Math.max(...frames) };
}

const heapMB = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);
const round = (x) => (x == null ? null : Math.round(x * 10) / 10);
const descCount = (b) => b.getDescendants(false).length;

// ---- One benchmark run ---------------------------------------------------

let ws = null;

async function runOne(n, collapseBig) {
  if (ws) ws.dispose();
  document.getElementById('ws').innerHTML = '';
  await raf();
  ws = Blockly.inject('ws', { renderer: 'geras', move: { scrollbars: true, drag: true, wheel: true }, zoom: { startScale: 0.6 } });
  await settle();

  const gen = generate(n, collapseBig);
  const loadMs = await timed(() => Blockly.serialization.workspaces.load(gen.state, ws));
  const renderMs = await timed(settle);
  const actual = ws.getAllBlocks(false).length;

  const scroll = await scrollFps(ws);

  // Move the biggest top-level stack.
  const top = ws.getTopBlocks(false).sort((a, b) => descCount(b) - descCount(a))[0];
  const moveMs = await timed(async () => { top.moveBy(300, 300); await settle(); });

  // Collapse then expand the largest statement block inside the main stack.
  const big = top.getDescendants(false)
    .filter((b) => b !== top && b.getInput('DO') && !b.isCollapsed())
    .sort((a, b) => descCount(b) - descCount(a))[0];
  let collapseMs = null;
  if (big) {
    collapseMs = await timed(async () => {
      big.setCollapsed(true); await settle();
      big.setCollapsed(false); await settle();
    });
  }

  let saved;
  const saveMs = await timed(async () => { saved = JSON.stringify(Blockly.serialization.workspaces.save(ws)); });

  return {
    config: collapseBig ? 'collapsed' : 'expanded',
    requested: n,
    blocks: actual,
    loadMs: round(loadMs),
    renderMs: round(renderMs),
    scrollFps: round(scroll.fps),
    scrollWorstFrameMs: round(scroll.worst),
    moveMs: round(moveMs),
    collapseExpandMs: round(collapseMs),
    saveMs: round(saveMs),
    saveKB: round(saved.length / 1024),
    heapMB: round(heapMB()),
  };
}

// ---- UI ------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const results = [];

function renderTable() {
  const keys = ['config', 'blocks', 'loadMs', 'renderMs', 'scrollFps', 'scrollWorstFrameMs',
    'moveMs', 'collapseExpandMs', 'saveMs', 'saveKB', 'heapMB'];
  $('tbl').innerHTML = '<tr>' + STRINGS.cols.map((c) => '<th>' + c + '</th>').join('') + '</tr>' +
    results.map((r) => '<tr>' + keys.map((k) => '<td>' + (r[k] ?? 'n/a') + '</td>').join('') + '</tr>').join('');
  $('json').textContent = JSON.stringify({
    blockly: Blockly.VERSION || 'unknown',
    userAgent: navigator.userAgent,
    results,
  }, null, 2);
}

async function exec(list) {
  $('run').disabled = $('all').disabled = true;
  for (const [n, c] of list) {
    $('status').textContent = STRINGS.running + n + (c ? ' collapsed' : '');
    try {
      results.push(await runOne(n, c));
    } catch (e) {
      results.push({ config: 'error: ' + e.message, requested: n });
    }
    renderTable();
  }
  $('status').textContent = STRINGS.done;
  $('run').disabled = $('all').disabled = false;
}

$('lblN').textContent = STRINGS.lblN;
$('lblCollapsed').textContent = STRINGS.collapsed;
$('run').textContent = STRINGS.run;
$('all').textContent = STRINGS.all;
$('run').onclick = () => exec([[Number($('n').value), $('collapsed').checked]]);
$('all').onclick = () => exec([[300, false], [1000, false], [2000, false], [4000, false], [2000, true]]);
window.__bench = { exec, results, runOne };
