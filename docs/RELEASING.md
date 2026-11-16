# Releasing MCEdge

Installed copies of MCEdge update themselves from the latest GitHub release of
[SalihEfeTosunBayraktar/MCEdge](https://github.com/SalihEfeTosunBayraktar/MCEdge/releases): on start and every
6 hours (Preferences > Updates can turn this off; Help > Check for updates always works) they read the release's
`latest.yml`, download the new Setup exe in the background and install it on Restart now or when the app quits. The
portable exe cannot replace itself; it shows the new release in the status bar and links to it.

## Steps

`tools/release/release.ps1` does all of them. Run it on `main` with a clean working tree:

```
pwsh tools/release/release.ps1 -Version 0.1.1 -NotesFile notes.md
```

1. **Version bump.** `package.json` and `package-lock.json` get the new version, committed as `MCEdge <version>`.
2. **Build.** `npm run dist` writes to `release/`:
   - `MCEdge-Setup-<version>.exe` (installer)
   - `MCEdge-Setup-<version>.exe.blockmap` (lets the updater download only the changed blocks)
   - `latest.yml` (version, file name and SHA-512 the installed copies read)
   - `MCEdge-Portable-<version>.exe`
3. **Public snapshot.** `tools/release/publish-public.ps1 -Message "MCEdge <version>"` commits the public tree
   (without the paths in `.publicignore`) on the `public` branch. Add `-Push` to `release.ps1` to push it to the public
   repo's `main`.
4. **GitHub release.** The script prints the `gh release create v<version>` command that uploads the four files; with
   `-Push -Publish` it runs it. All four are needed: without `latest.yml` and the blockmap installed copies do not see
   the release. The notes file becomes the release text, which the app shows in its update dialog.

Check after publishing: an installed older copy shows "Update <version>: downloading" in the status bar within a
minute of starting, then "Update <version> is ready" with Restart now.

## Testing an update locally

`tools/ui-test/auto-update.ts` (manual, slow: two full builds) installs the current version to a temporary folder,
builds the next patch version, serves its `latest.yml`, Setup exe and blockmap from `http://127.0.0.1` and checks that
the installed copy downloads it, restarts and becomes the new version. The installed app reads the local feed from
the `MCEDGE_UPDATE_FEED` environment variable, which only this test sets.

```
node tools/ui-test/auto-update.ts
```
