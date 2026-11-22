/**
 * Page side of the accessibility audit (Q248): the script a11y-audit.ts injects into the app. It is plain JavaScript in
 * a string, so the bundler of the test runner cannot rewrite it. `window.__a` finds what the accessibility tree cannot:
 * clickable elements that are not buttons, groups with no role, controls Tab cannot reach and focus that shows no change.
 */
export const PAGE_SCRIPT = String.raw`(() => {
  if (window.__a) return window.__a;
  const NATIVE = "button,a[href],input:not([type=hidden]),select,textarea,summary";
  const INTERACTIVE = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio", "switch", "slider", "combobox", "textbox", "searchbox", "spinbutton", "treeitem"]);
  const COMPOSITE = ["listbox", "grid", "treegrid", "tree", "menu", "menubar", "tablist", "radiogroup"];
  const GROUPING = new Set([...COMPOSITE, "toolbar", "group"]);
  // Blockly and Monaco draw their own widgets and are checked on their own.
  const SKIP = ".injectionDiv, .blocklyWidgetDiv, .blocklyDropDownDiv, .blocklyTooltipDiv, .monaco-editor";
  const reactProps = (e) => { const k = Object.keys(e).find((x) => x.startsWith("__reactProps$")); return k ? e[k] : undefined; };
  const ids = new WeakMap();
  const byId = new Map();
  let next = 1;
  const idOf = (e) => { let id = ids.get(e); if (!id) { id = next++; ids.set(e, id); byId.set(id, e); } return id; };
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let p = e; p; p = p.parentElement) {
      if (p.getAttribute("aria-hidden") === "true" || p.hasAttribute("inert")) return false;
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    return true;
  };
  const cls = (e) => (typeof e.className === "string" ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "");
  const describe = (e) => {
    const chain = [];
    for (let p = e.parentElement; p && chain.length < 3; p = p.parentElement) { const c = cls(p); if (c) chain.push(c.split(".")[0]); }
    const text = (e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent || e.getAttribute("placeholder") || e.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return { tag: e.tagName.toLowerCase() + (cls(e) ? "." + cls(e) : ""), role: e.getAttribute("role") || "", text, in: chain.join(" < ") };
  };
  const rootsOf = (selector) => [...document.querySelectorAll(selector)];
  const inRoots = (roots, e) => roots.some((r) => r.contains(e));
  const compositeOf = (e) => e.parentElement && e.parentElement.closest(COMPOSITE.map((r) => "[role=" + r + "]").join(","));
  const styleKey = (e) => {
    const s = getComputedStyle(e);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.backgroundColor, s.borderTopColor, s.borderLeftColor, s.color, s.textDecorationLine].join("|");
  };
  const lineage = (e) => { const out = [e]; for (let p = e.parentElement; p && out.length < 4; p = p.parentElement) out.push(p); return out; };
  const baseline = new WeakMap();

  /** Everything in the scope that a keyboard user could meet: candidates for Tab, plus the static findings. */
  const scan = (selector) => {
    const roots = rootsOf(selector);
    const found = { clickables: [], roles: [], candidates: [], dialogs: [] };
    for (const root of roots) {
      for (const e of root.querySelectorAll("*")) {
        if (e.closest(SKIP)) continue;
        const props = reactProps(e);
        const role = e.getAttribute("role");
        const native = e.matches(NATIVE);
        const tabi = e.hasAttribute("tabindex") ? e.tabIndex : null;
        const clickable = !!(props && props.onClick);
        // tabindex="-1" alone only lets a script give an element the focus (a list that takes the letter keys): not a control.
        const interactive = native || (role && INTERACTIVE.has(role)) || clickable || (tabi !== null && tabi >= 0);
        const group = !interactive && e.children.length >= 2;
        const dialogClass = typeof e.className === "string" && /(^|\s)dialog(\s|$)/.test(e.className);
        if (!interactive && !group && !dialogClass && role !== "menu") continue;
        if (!visible(e)) continue;
        if (interactive) {
          if (e.disabled || e.getAttribute("aria-disabled") === "true") continue;
          if (clickable && !native && !(role && INTERACTIVE.has(role)) && !(tabi !== null && tabi >= 0) && !e.matches(".backdrop, .ctxwrap") && !compositeOf(e)) {
            found.clickables.push({ id: idOf(e), ...describe(e) });
          }
          // A radio group is one tab stop (the checked button); the others are reached by arrow keys.
          const c = compositeOf(e) || (e.type === "radio" && e.name ? document.querySelector('input[type=radio][name="' + CSS.escape(e.name) + '"]') : null);
          found.candidates.push({ id: idOf(e), tabi, composite: c ? idOf(c) : 0, ...describe(e) });
        }
        if (dialogClass && role !== "dialog" && role !== "alertdialog") found.dialogs.push({ id: idOf(e), ...describe(e) });
        if (role === "menu" && !e.closest(".ctxwrap")) {
          const opener = e.previousElementSibling;
          if (opener && opener.matches("button") && !opener.hasAttribute("aria-haspopup")) found.roles.push({ id: idOf(opener), problem: "menu opener has no aria-haspopup", ...describe(opener) });
        }
        if (group && !(role && GROUPING.has(role))) {
          const kids = [...e.children].filter((k) => k.matches(NATIVE) || (reactProps(k) && reactProps(k).onClick) || k.getAttribute("role") === "tab");
          if (kids.length >= 2) {
            const state = (k) => k.hasAttribute("aria-selected") || k.hasAttribute("aria-pressed") || k.hasAttribute("aria-current") || k.hasAttribute("aria-checked");
            const looksSelected = (k) => /(^|\s)(on|sel|selected|active|current)(\s|$)/.test(typeof k.className === "string" ? k.className : "");
            if (kids.some((k) => k.hasAttribute("aria-selected")) && !((role && COMPOSITE.includes(role)) || compositeOf(kids[0]))) found.roles.push({ id: idOf(e), problem: "aria-selected outside a tablist, listbox or grid", ...describe(e) });
            else if (kids.some(looksSelected) && !kids.some(state)) found.roles.push({ id: idOf(e), problem: "the selected item is only a style (no aria-selected, -pressed or -current)", ...describe(e) });
          }
        }
      }
    }
    for (const c of found.candidates) for (const e of lineage(byId.get(c.id))) if (!baseline.has(e)) baseline.set(e, styleKey(e));
    return found;
  };

  /** The element that has the focus now, whether the focus shows, and whether it is inside the scope. */
  const stop = (selector) => {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return { body: true };
    const roots = rootsOf(selector);
    let ring = false;
    for (const e of lineage(a)) {
      const was = baseline.get(e);
      const now = styleKey(e);
      if (was !== undefined ? was !== now : (() => { const s = getComputedStyle(e); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none"; })()) { ring = true; break; }
    }
    const s = getComputedStyle(a);
    return { id: idOf(a), inside: inRoots(roots, a), ring, blockly: !!a.closest(".injectionDiv"), outline: s.outlineStyle + " " + s.outlineWidth, ...describe(a) };
  };
  const blurActive = () => { const a = document.activeElement; if (a && a !== document.body) { a.blur(); return idOf(a); } return 0; };
  const refocus = (id) => { const e = byId.get(id); if (e && e.isConnected) e.focus(); };
  const startAtTop = () => { const b = document.body; b.setAttribute("tabindex", "-1"); b.focus(); b.removeAttribute("tabindex"); };
  const describeNode = (e, selector) => (e && !e.closest(SKIP) && inRoots(rootsOf(selector), e) && visible(e) ? { id: idOf(e), ...describe(e) } : null);
  return (window.__a = { scan, stop, startAtTop, describeNode, blurActive, refocus });
})()`;
