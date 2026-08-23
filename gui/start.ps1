Set-Location $PSScriptRoot\..
if (Get-Command bun -ErrorAction SilentlyContinue) {
  bun gui/server.mjs
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
  node gui/server.mjs
} else {
  Write-Error "Need bun or node on PATH, or install the Job Search Desk app from Releases."
  exit 1
}
