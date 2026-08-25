Set-Location $PSScriptRoot\..
$cli = $args -contains "--cli"
$runner = if (Get-Command bun -ErrorAction SilentlyContinue) { "bun" } elseif (Get-Command node -ErrorAction SilentlyContinue) { "node" } else { "" }
if (-not $runner) {
  Write-Error "Need bun or node on PATH, or install the Job Search Desk app from Releases."
  exit 1
}
if ($cli) {
  & $runner gui/server.mjs --cli
} else {
  & $runner gui/server.mjs
}
