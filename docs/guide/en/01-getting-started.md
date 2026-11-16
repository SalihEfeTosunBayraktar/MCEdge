# Getting started

MCEdge makes Minecraft mods without writing Java. A project is a folder with an `mcedge.json` file; MCEdge generates the mod for every supported game version (an engine: Fabric, NeoForge and Forge on several Minecraft versions) from the same project.

## Open a project

- **File > Open project...** picks a project folder. A plain Gradle mod opens in code project mode.
- **File > Open example project** opens Hello MCEdge, a small mod with an item, a block, a tool, recipes and a creative tab.
- **File > Open recent** and the welcome screen list the projects you opened before.

## The window

- The **menu bar** holds the menus, the open project, the Build and Run buttons and the engine you build for.
- The **rail** on the left switches between the sections: Mod elements, Resources, Element tags, Variables, Localization, Version control and Workspace settings.
- Every section starts with a **find bar** (search, filter, sort) and a **toolbar**. Actions act on the selection.
- The **status bar** shows whether everything is saved, the problems and the build state. Click it to open the Build output or Problems panel.

Everything you change is saved on its own. **Window > Preferences...** sets the language, the theme and the text size.

The installed MCEdge updates itself: a new release downloads in the background and the status bar shows its progress, then **Restart now** installs it (or it installs when you quit). Click the status bar item for the release notes. **Help > Check for updates...** checks at once; Preferences can turn the automatic checks off.

## Next

- Make your first item
- Blocks, recipes and creative tabs
- Build, run and export
