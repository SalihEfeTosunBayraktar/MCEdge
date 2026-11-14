import * as Blockly from "blockly/core";

/*
 * Loading a big program (KUYRUK 188). Blockly loads an input that has both a shadow (the editable default) and a real
 * block by first building, rendering and connecting the shadow block, then connecting the real block, which disposes
 * the shadow again: on the 4,985-block procedure that was ~0.8 s of a ~3 s profiled load (respawnShadow_ ->
 * createShadowBlock, then dispose; plain runs: Blockly load 1.9 s -> 1.35 s). Here the shadow states are kept aside
 * during the load and set once the real blocks are in place: an input with a real block only stores its shadow state
 * (as Blockly does for a connected input), an input without one gets its shadow block as before. The program, the
 * saved state and what taking the real block off shows (the shadow respawned from the same state) do not change.
 */

/** Blockly's own (private) setter that stores a connection's shadow state without building the shadow block. */
type ShadowStore = {
  applyShadowState(state: { shadowDom: Element | null; shadowState: Blockly.serialization.blocks.State | null }): void;
};

/** Loads a serialized program into the workspace (events off, no undo), with the shadows set after the blocks. */
export function loadProgram(state: object, workspace: Blockly.WorkspaceSvg): void {
  const pending: [Blockly.Connection, Blockly.serialization.blocks.State | null][] = [];
  const proto = Blockly.Connection.prototype;
  const setShadowState = proto.setShadowState;
  proto.setShadowState = function (this: Blockly.Connection, shadow) {
    pending.push([this, shadow]);
  };
  Blockly.Events.disable();
  try {
    try {
      Blockly.serialization.workspaces.load(state, workspace, { recordUndo: false });
    } finally {
      proto.setShadowState = setShadowState;
    }
    for (const [connection, shadow] of pending) {
      if (connection.targetBlock()) (connection as unknown as ShadowStore).applyShadowState({ shadowDom: null, shadowState: shadow });
      else connection.setShadowState(shadow);
    }
  } finally {
    Blockly.Events.enable();
  }
}
