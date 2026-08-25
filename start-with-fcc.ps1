# start-with-fcc.ps1
# Launches Claude Code pointed at the Free Claude Code (FCC) proxy.
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File .\start-with-fcc.ps1

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$FccBaseUrl = if ($env:FCC_BASE_URL) { $env:FCC_BASE_URL.TrimEnd("/") } else { "http://localhost:8082" }
$FccToken = if ($env:FCC_AUTH_TOKEN) { $env:FCC_AUTH_TOKEN } else { "freecc" }

function Test-FccProxy {
    param([string]$Url)

    try {
        Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 3 -UseBasicParsing | Out-Null
        return $true
    } catch {
        # Some proxies reject GET on /; a listening TCP port is still enough.
    }

    try {
        $uri = [Uri]$Url
        $tcp = New-Object System.Net.Sockets.TcpClient
        $async = $tcp.BeginConnect($uri.Host, $uri.Port, $null, $null)
        $connected = $async.AsyncWaitHandle.WaitOne(2000, $false)
        if (-not $connected) {
            $tcp.Close()
            return $false
        }
        $tcp.EndConnect($async)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

Write-Host "Starting ai-job-search with Free Claude Code..." -ForegroundColor Cyan

if (Test-FccProxy -Url $FccBaseUrl) {
    Write-Host "FCC proxy is reachable at $FccBaseUrl" -ForegroundColor Green
} else {
    Write-Host "WARNING: FCC does not seem to be running at $FccBaseUrl." -ForegroundColor Yellow
    Write-Host "Start Free Claude Code first (Start menu app, or run fcc-server)." -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue anyway? [y/N]"
    if ($continue -notmatch '^[Yy]$') {
        exit 1
    }
}

$localSettings = Join-Path $PSScriptRoot ".claude\settings.local.json"
$exampleSettings = Join-Path $PSScriptRoot ".claude\settings.local.json.example"
if (-not (Test-Path $localSettings)) {
    if (Test-Path $exampleSettings) {
        Copy-Item -Path $exampleSettings -Destination $localSettings
        Write-Host "Created .claude\settings.local.json from the example." -ForegroundColor Green
    } else {
        Write-Host "WARNING: .claude\settings.local.json.example is missing; env vars still apply for this session." -ForegroundColor Yellow
    }
}

$env:ANTHROPIC_AUTH_TOKEN = $FccToken
$env:ANTHROPIC_BASE_URL = $FccBaseUrl
$env:CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = "1"
$env:CLAUDE_CODE_AUTO_COMPACT_WINDOW = "190000"
$env:DISABLE_AUTOUPDATER = "1"
$env:DISABLE_FEEDBACK_COMMAND = "1"
$env:DISABLE_ERROR_REPORTING = "1"

Write-Host "Environment variables set. Launching Claude Code..." -ForegroundColor Cyan
Write-Host "You can now use /setup, /scrape, /rank, /apply as usual." -ForegroundColor Green
Write-Host ""

$fccClaude = Get-Command fcc-claude -ErrorAction SilentlyContinue
if ($fccClaude) {
    & fcc-claude @args
    exit $LASTEXITCODE
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
    Write-Host "fcc-claude not found; launching claude with FCC env vars." -ForegroundColor Yellow
    & claude @args
    exit $LASTEXITCODE
}

Write-Host "Neither fcc-claude nor claude was found on PATH." -ForegroundColor Red
Write-Host "Install Claude Code, then re-run the FCC installer and choose Claude Code." -ForegroundColor Yellow
Write-Host "Close and reopen PowerShell after installing so PATH updates apply." -ForegroundColor Yellow
exit 1
