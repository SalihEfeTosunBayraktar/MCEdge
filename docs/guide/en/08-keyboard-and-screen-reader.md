# Keyboard and screen reader

Every action in MCEdge can be done from the keyboard, and the controls carry names, roles and states for a screen reader. **Help > Keyboard shortcuts** lists the keys that work everywhere; every editor has its own list behind its keyboard button (or the `?` key).

## Moving around

- **Tab** and **Shift+Tab** go to the next and previous control. A menu bar, a tab strip, a list or a table counts as one stop; the arrow keys move inside it.
- **F10**, or **Alt** pressed and released alone, moves the focus to the menu bar. **Left** and **Right** change the menu, **Down** opens it, **Esc** leaves. Alt or F10 again also leaves.
- In an open menu, **Up** and **Down**, **Home** and **End** move through the items, a letter jumps to the next item that starts with it, **Enter** runs the item, **Left** and **Right** go to the neighbouring menu, **Esc** closes it and the focus goes back to where it was.
- A dialog keeps the focus inside while it is open. **Esc** closes it (except the ones that ask a question you must answer), and the focus returns to what opened it.
- The focus always shows: a ring around the control, or a change of colour on a tile or a row. Preferences > Accessibility has a high-contrast theme with a thicker ring.

## Lists, tiles and tables

- The element tiles: **Left**, **Right**, **Up**, **Down**, **Home** and **End** move to the next tile and select it; **Enter** opens it, **F2** renames it, **Delete** deletes it.
- Tables (the Details view, tags, variables, recent projects, translations): Tab goes to the table once, **Up** and **Down** (and **Page Up**, **Page Down**, **Home**, **End**) change the selected row, **Enter** opens it. The translations table moves between cells with all four arrows and **Enter** or **F2** edits the cell.
- Lists of options (pickers, widget lists): the arrow keys move the focus, **Enter** or **Space** chooses.
- Tab strips (the pages of an editor, the bottom panels): **Left** and **Right** move to the next tab and show it. In the strip of open editors the arrows only move the focus; **Enter** shows the editor and **Delete** closes the tab.

## The texture editor

Tab to the canvas. A pixel cursor appears at the top left and the position and colour are read out as it moves.

- **Arrow keys** move the cursor by one pixel, **Shift** with an arrow by four, **Home** and **End** to the first and last column.
- **Space** presses the mouse button on the cursor with the chosen tool: the pencil paints a pixel, the fill fills, the picker picks the colour. Hold **Space** and use the arrows to draw a line, a selection or a shape; **Shift+Space** erases. **Enter** finishes a shape (and closes a polygon).
- The tool keys (**P**, **E**, **F**, **I**, **L**, **R**, **O**, **Y**, **M**), **G**, **+**, **-**, **Ctrl+Z** and **Ctrl+S** work as usual. The keyboard button lists all of them.

## The block editor

Blocks can be added without the mouse in two ways:

- **Ctrl+F** goes to the block search; type, and **Enter** adds the best match under the selected block.
- **Tab** goes to the toolbox; the arrow keys go through the categories, **Right** goes into a category's blocks, **Enter** inserts the picked block and puts it in move mode: the arrows choose where it connects and **Enter** accepts the place.

On the canvas the arrow keys go from block to block and into their inputs, **Enter** edits a field, **M** moves the selected block, **X** takes it out of its stack, **I** reads it out, **Delete** removes it, **T** and **W** jump to the toolbox and the canvas.

## The GUI layout editor

**Page Up** and **Page Down** select the previous and next widget (or choose one in the widget list with Tab and Enter), the **arrow keys** move it by a pixel (**Shift** moves by the grid), **F2** renames it, **Delete** removes it, **Esc** deselects.

## Screen readers

Fields, buttons, menus, tab strips, lists, tables and dialogs have a name, a role and their state (selected, expanded, checked). A field's label names it. The save state and the cursor position in the texture editor are announced as they change. The checks run against the accessibility tree that Chromium gives to a screen reader; the list of what was checked is in `docs/A11Y-AUDIT.md`.
