<#
.SYNOPSIS
  Builds an MCEdge release: version bump, installers, public snapshot and the GitHub release command.

.DESCRIPTION
  Steps (docs/RELEASING.md):
    1. Sets package.json and package-lock.json to -Version and commits the bump ("MCEdge <version>") on the current
       branch, which must be main with a clean working tree (publish-public.ps1 snapshots main).
    2. npm run dist: release/MCEdge-Setup-<v>.exe, its .blockmap, latest.yml and MCEdge-Portable-<v>.exe.
    3. tools/release/publish-public.ps1 -Message "MCEdge <v>", with -Push only when -Push is given.
    4. Prints the gh release create command that uploads the four files; runs it only with -Publish (needs -Push, so
       the public main the tag points at already has the release).
  Installed copies update from the release's latest.yml, so it must be uploaded with the Setup exe and its blockmap.

.EXAMPLE
  pwsh tools/release/release.ps1 -Version 0.1.1
  pwsh tools/release/release.ps1 -Version 0.1.1 -NotesFile notes.md -Push -Publish
#>
param(
  [Parameter(Mandatory)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string] $Version,
  # Markdown shown on the release page and in the app's update dialog.
  [string] $NotesFile,
  [switch] $Push,
  [switch] $Publish
)
$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
Set-Location $repo
if ($Publish -and -not $Push) { throw "-Publish needs -Push: the release tag points at the public main" }
if ((git branch --show-current).Trim() -ne "main") { throw "run on main: publish-public.ps1 snapshots main" }
if (git status --porcelain) { throw "the working tree has changes; commit or stash them first" }

npm version $Version --no-git-tag-version --allow-same-version | Out-Null
if (git status --porcelain package.json package-lock.json) {
  git add package.json package-lock.json
  git commit -q -m "MCEdge $Version"
}

npm run dist
if ($LASTEXITCODE) { throw "npm run dist failed" }
$files = "MCEdge-Setup-$Version.exe", "MCEdge-Setup-$Version.exe.blockmap", "MCEdge-Portable-$Version.exe", "latest.yml" |
  ForEach-Object { Join-Path "release" $_ }
foreach ($file in $files) { if (-not (Test-Path $file)) { throw "missing $file" } }

& (Join-Path $PSScriptRoot "publish-public.ps1") -Message "MCEdge $Version" -Push:$Push

$notes = if ($NotesFile) { "--notes-file `"$NotesFile`"" } else { "--notes `"MCEdge $Version`"" }
$command = "gh release create v$Version --repo SalihEfeTosunBayraktar/MCEdge --target main --title `"MCEdge $Version`" $notes " +
  (($files | ForEach-Object { "`"$_`"" }) -join " ")
if ($Publish) {
  Invoke-Expression $command
  if ($LASTEXITCODE) { throw "gh release create failed" }
} else {
  Write-Host "Release files are ready. Create the GitHub release with:"
  Write-Host "  $command"
}
