# Make your first item

## 1. Draw a texture

1. Open **Resources** on the rail and choose **New texture**.
2. Give it a name (for example `sapphire`) and a size (16 x 16 is the game's own size).
3. Draw with the pencil, fill and eraser; pick colours with the picker. **Ctrl+S** saves, **Ctrl+Z** undoes. The preview shows the texture in an inventory slot.

PNG files can also be imported with **Resources > Import textures...** in the menu bar.

## 2. Create the item

1. Open **Mod elements** and press **New** (or **Ctrl+N**).
2. Choose **Item**, type a name such as Sapphire and press Enter. The id (`sapphire`) is made from the name.
3. The item editor opens. Pick the texture, set the stack size and the creative tab, and add a tooltip if you like.

Fields the selected engine does not generate show a "not generated yet" badge. Problems (a missing texture, an unknown id) are listed under the form and in the Problems panel.

## 3. Fields that name other things

Fields that name an item, block or entity open a picker: search by name or id, then choose from **This mod**, **Minecraft** or **Tags**. Minecraft's own names and icons show once an engine has built or run the game.

## Working with elements

- Select a tile and press **Enter** to open it, **F2** to rename it (everything that names it is updated) and **Delete** to delete it.
- **Ctrl+K** searches the whole project (elements, textures, sounds, lang keys, variables, tags) and opens the result where it lives. **Ctrl+F** jumps to the search box. Folders, the filter and the sort keep the list tidy.
- Every element, procedure and texture you open stays as a tab above the editor. **Ctrl+W** closes the shown tab; right-click a tab to close the others. **Alt+Left** and **Alt+Right** go back and forward between the editors you looked at. The tabs come back when you open the project again.
