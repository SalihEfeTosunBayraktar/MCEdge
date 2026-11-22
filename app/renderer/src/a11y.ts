/**
 * Screen reader support that applies to the whole window (Q248). A form row (`.frow`) is a label beside its control, not
 * around it, so the control has no name of its own: the first field of the row with no name takes the row's label.
 * Rows are drawn by several components (form rows, element field rows, list forms); watching the DOM names them all,
 * and the ones a view draws later.
 */
let counter = 0;

/** Names the first unnamed field of a row after the row's label; returns whether it did. */
export function nameRowField(row: HTMLElement): boolean {
  const label = row.querySelector<HTMLElement>(":scope > label");
  if (!label || !label.textContent?.trim()) return false;
  for (const field of row.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea")) {
    if (label.contains(field) || field.hasAttribute("aria-label") || field.hasAttribute("aria-labelledby") || [...(field.labels ?? [])].some((l) => l.textContent?.trim())) continue;
    label.id ||= `rowlabel-${++counter}`;
    field.setAttribute("aria-labelledby", label.id);
    return true;
  }
  return false;
}

const touchesRow = (node: Node) => node instanceof Element && (node.matches(".frow, .frow *") || node.querySelector(".frow") !== null);

/** Keeps every form row's field named while the window lives; call once. */
export function watchRowLabels(root: HTMLElement = document.body): () => void {
  let queued = false;
  const run = () => {
    queued = false;
    for (const row of root.querySelectorAll<HTMLElement>(".frow")) nameRowField(row);
  };
  const observer = new MutationObserver((mutations) => {
    if (queued || !mutations.some((m) => [...m.addedNodes].some(touchesRow))) return;
    queued = true;
    requestAnimationFrame(run);
  });
  observer.observe(root, { childList: true, subtree: true });
  run();
  return () => observer.disconnect();
}

/**
 * Keys of a listbox that does not handle them itself (a handler that did calls preventDefault, and a list that keeps the
 * arrows for something else, like the GUI widget list nudging the selection, says so with `data-own-arrows`):
 * the arrow keys, Home and End move the focus along its options, and Enter or Space presses an option that is not a button.
 */
export function watchListKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || !(e.target instanceof HTMLElement)) return;
    const option = e.target.closest<HTMLElement>("[role=option]");
    const box = option?.closest<HTMLElement>("[role=listbox]");
    if (!option || !box || box.closest("[data-own-arrows]") || option.getAttribute("aria-disabled") === "true") return;
    if ((e.key === "Enter" || e.key === " ") && option.tagName !== "BUTTON" && e.target === option) return void (e.preventDefault(), option.click());
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    // Only an option that has the focus itself moves it (not a field or button inside the option).
    if (e.target !== option) return;
    const options = [...box.querySelectorAll<HTMLElement>("[role=option]")].filter((o) => o.closest("[role=listbox]") === box && o.tabIndex >= 0 && o.getClientRects().length > 0);
    const at = options.indexOf(option);
    const next = e.key === "Home" ? options[0] : e.key === "End" ? options[options.length - 1] : options[at + step];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
