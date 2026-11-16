# Radial menus and runtime images

A radial menu is a wheel of slices that opens on a key: the player moves the mouse towards a slice and lets go (or clicks). Use it for emotes, quick commands, shortcuts to GUIs or anything else; nothing in it is tied to one use.

## 1. Make one

**New element > Radial menu**. The preview on the right draws the wheel as the game does; move the mouse over it to see the slice under the mouse, with its label and description in the middle.

| Group | What it sets |
| --- | --- |
| Opening | The default key (players can rebind it; **None** opens it only from procedures), **Hold** (letting go of the key chooses) or **Toggle** (a press opens, a click chooses), the name in the controls menu. |
| Wheel | Size, hole, the gap between slices, slice colours (normal, under the mouse, disabled) and opacity, or images drawn under each slice's icon. |
| Background | An optional image behind the wheel, stretched or 9-sliced, with padding. |
| Centre | Title, whether the hovered slice's label and description show, an icon in the middle, text colour, how it opens (fade, grow, slide up or down, with a length and an easing: the same timing model as bubbles). |
| Tabs | Up to 9 tabs; the mouse wheel (up: next tab, down: previous), the arrows over the wheel or the number keys switch them. |

## 2. Slices

A tab of the **List** kind holds up to 12 slices. A slice has an id, a label, a description, an icon (a texture or an item) and an action:

| Action | Does |
| --- | --- |
| Command | Runs the command as the player, with the player's own permissions (`/say hi`, `/trade`). |
| Procedure | Runs a procedure with `menu`, `tab` and `slice` as dependencies. |
| Open another radial menu | Opens that menu instead. |
| Open a GUI | Opens a GUI at the player's position. |
| Show a bubble | Shows a bubble element over the player's head, with a caption. |
| Show a runtime image as a bubble | Shows an image of a runtime image folder (below) over the player's head. |

A slice may have a **condition** (a procedure returning true or false), tested on the server each time the menu opens: while it is false the slice is hidden or shown greyed out, and choosing it does nothing.

## 3. Runtime images

A tab of the **Runtime folder** kind has no fixed slices: it shows one slice for every PNG or GIF in `config/<modid>/<folder>/` on the server, a page at a time; the file name (letters `a-z`, digits, `_`) is the slice id and label. Server owners add images without rebuilding the mod; `/<modid> reload` (operators) reads the folders again and sends the images to everyone. GIFs play as animations. Limits: 64 files of 1 MB each, 1024 pixels a side, 32 GIF frames. The tab's action runs with the chosen file: show it as a bubble (`{id}` in the caption is the file name), run a command or a procedure.

Runtime images are not only for menus: the **show runtime image as bubble** block (Bubbles category) shows `folder/name` over any player.

## 4. From procedures

The **GUI** category has **open radial menu**, **close radial menu** and **set slice ... of radial menu** (shown, hidden, disabled, or back to its condition) for one player. The global trigger **Radial menu slice chosen** runs after any slice's action, with `menu`, `tab` and `slice`.

## 5. Build and run

Build and run, then press the key. Every menu is data in the mod (`radial_menus.json`) read by one shared screen, so adding menus adds no code.
