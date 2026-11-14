# Build, run and export

## Choose an engine

The engine menu at the top right picks the game version and loader you build and run. Each engine downloads its Java and Gradle the first time; this takes a few minutes once.

## Build and run

| Action | Where | Shortcut |
| --- | --- | --- |
| Build the selected engine | Build & run > Build | Ctrl+B |
| Build every engine | Build & run > Build all engines | Ctrl+Shift+B |
| Start Minecraft with the mod | Build & run > Run client | F5 |
| Stop the game | Build & run > Stop client | Shift+F5 |
| Start a server | Build & run > Run server | |
| Start another player's client | Build & run > Run another client... | |
| Join the running server | Build & run > Join test server | |

The **Build output** panel shows the log of every build and run. Errors in the generated code point back to the element that caused them.

To test multiplayer, start the server, then clients with different player names (Dev, Dev2...): each has its own entry in Build output with its own Stop button. The test server runs in offline mode, so these clients can join it, from the Multiplayer menu or straight away with Join test server.

## Export the mod

**File > Export mod jar...** (**Ctrl+E**) builds the engines you choose and copies each jar into one folder, named by a pattern you set. Put the jar in a Minecraft `mods` folder, or upload it.

Other mods your mod needs are listed in **Workspace settings > Dependencies**; their jars are downloaded for test runs.

## Keep your work

**Version control** commits and shares the project with Git. The whole project goes into one zip file with **File > Export workspace to file...**

Every keyboard shortcut is listed in **Help > Keyboard shortcuts**.
