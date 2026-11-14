import * as Blockly from "blockly/core";

/*
 * Blockly draws every block of the program as SVG and Chromium repaints all of it on each scroll or zoom frame: on a
 * 5,000-block procedure a frame took ~90 ms (paint + layerize), however little of it was on screen. Blocks far from the
 * view get a class that hides their own outline, fields, texts and icons (styles.css, `.blocklyCulled`); only a block
 * whose whole box (a C block's nested area included) is outside the padded view is culled, so a C block around the
 * view still shows, and the child blocks nested in its group cull themselves. Hidden with `visibility`, they keep their
 * geometry for Blockly's measurements; their field texts are left out of layout (`display: none`), which makes zooming
 * cheap (KUYRUK 188). The view is padded by its own size on each side, and the culling is recomputed when the view
 * leaves half of that padding or the program changes (KUYRUK 185).
 */

const CULLED = "blocklyCulled";

/** Starts culling the blocks of a workspace; returns the function that stops it (before the workspace is disposed). */
export function cullOffscreenBlocks(workspace: Blockly.WorkspaceSvg): () => void {
  /** The area (workspace units) whose blocks are shown; undefined: recompute on the next frame. */
  let shown: { left: number; top: number; right: number; bottom: number } | undefined;
  let frame = 0;
  let shrink: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const update = () => {
    frame = 0;
    if (disposed) return;
    const view = workspace.getMetricsManager().getViewMetrics(true);
    if (shown) {
      // Still well inside the padded area (a scroll by less than half a view, a zoom in): nothing new is in view.
      const slackX = view.width / 2;
      const slackY = view.height / 2;
      if (view.left >= shown.left + slackX && view.top >= shown.top + slackY && view.left + view.width <= shown.right - slackX && view.top + view.height <= shown.bottom - slackY) {
        // After zooming in, the shown area is much bigger than needed: narrow it once the zoom has stopped.
        if (shown.right - shown.left > 6 * view.width || shown.bottom - shown.top > 6 * view.height) {
          clearTimeout(shrink);
          shrink = setTimeout(() => schedule(true), 300);
        }
        return;
      }
    }
    shown = { left: view.left - view.width, top: view.top - view.height, right: view.left + 2 * view.width, bottom: view.top + 2 * view.height };
    for (const block of workspace.getAllBlocks(false)) {
      const xy = block.getRelativeToSurfaceXY();
      const off = xy.x > shown.right || xy.x + block.width < shown.left || xy.y > shown.bottom || xy.y + block.height < shown.top;
      const root = block.getSvgRoot();
      if (root.classList.contains(CULLED) !== off) root.classList.toggle(CULLED, off);
    }
  };
  const schedule = (force: boolean) => {
    if (force) shown = undefined;
    if (!frame && !disposed) frame = requestAnimationFrame(update);
  };
  /** After a change of the program: blocks moved, appeared or changed size once the queued renders are done. */
  const afterRenders = () => {
    shown = undefined;
    void Blockly.renderManagement.finishQueuedRenders().then(() => schedule(true));
  };

  // Every scroll and zoom moves the canvas through translate().
  const translate = workspace.translate.bind(workspace);
  workspace.translate = (x: number, y: number) => {
    translate(x, y);
    schedule(false);
  };
  const listener = (event: Blockly.Events.Abstract) => {
    if (event.type === Blockly.Events.VIEWPORT_CHANGE) schedule(false);
    else if (!event.isUiEvent || event.type === Blockly.Events.BLOCK_DRAG) afterRenders();
  };
  workspace.addChangeListener(listener);
  schedule(true);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(shrink);
    workspace.removeChangeListener(listener);
    workspace.translate = translate;
  };
}
