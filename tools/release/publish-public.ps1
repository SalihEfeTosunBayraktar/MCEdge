<#
.SYNOPSIS
  Builds the public GitHub snapshot of MCEdge and optionally pushes it.

.DESCRIPTION
  The private history (queue screenshots, audits of the private ETREconomy mod) never goes public. The public repo
  gets a separate history on the orphan branch "public": each run copies the tree of -Source (default main), drops
  every path listed in .publicignore, refuses to continue when a secret-like string is found, and commits the result
  as one new commit. With -Push the branch is pushed to the "public" remote's main branch.

.EXAMPLE
  pwsh tools/release/publish-public.ps1 -Message "MCEdge 0.1.0"
  pwsh tools/release/publish-public.ps1 -Message "MCEdge 0.1.0" -Push
#>
param(
  [Parameter(Mandatory)] [string] $Message,
  [string] $Source = "main",
  [switch] $Push
)
$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim()
$snapshot = Join-Path (Split-Path $repo) "MCEdge-public"

if (-not (Test-Path (Join-Path $snapshot ".git"))) {
  if (git -C $repo branch --list public) { git -C $repo worktree add $snapshot public | Out-Null }
  else { git -C $repo worktree add --orphan -b public $snapshot | Out-Null }
}

# Replace the snapshot's files with the source tree.
Get-ChildItem $snapshot -Force | Where-Object Name -ne ".git" | Remove-Item -Recurse -Force
$archive = Join-Path ([IO.Path]::GetTempPath()) "mcedge-public.tar"
git -C $repo archive --format=tar -o $archive $Source
tar -xf $archive -C $snapshot
Remove-Item $archive

# Drop the private paths.
$ignored = Get-Content (Join-Path $repo ".publicignore") | Where-Object { $_ -and -not $_.StartsWith("#") } | ForEach-Object { $_.Trim() }
foreach ($pattern in $ignored) {
  $path = Join-Path $snapshot $pattern.TrimEnd("/")
  if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}

# Stop on anything that looks like a credential.
$secret = 'ghp_[A-Za-z0-9]{20,}|github_pat_|sk-ant-|sk-[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}'
$hits = Get-ChildItem $snapshot -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Length -lt 5MB -and $_.Name -ne "publish-public.ps1" } |
  Select-String -Pattern $secret -List
if ($hits) { $hits | ForEach-Object { Write-Host "secret-like: $($_.Path):$($_.LineNumber)" }; throw "snapshot not committed" }

git -C $snapshot add -A
if (git -C $snapshot status --porcelain) {
  git -C $snapshot commit -q -m $Message
  Write-Host "committed: $(git -C $snapshot log --oneline -1)"
} else {
  Write-Host "no changes since the last snapshot"
}
if ($Push) { git -C $repo push public public:main }
