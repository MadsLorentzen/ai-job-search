# install-windows-deps.ps1
# One-command Windows helpers for this fork: ATS extractor, optional Typst, optional Poppler.
#
#   powershell -ExecutionPolicy Bypass -File .\tools\install-windows-deps.ps1
#   powershell -ExecutionPolicy Bypass -File .\tools\install-windows-deps.ps1 -SkipTypst -SkipPoppler

[CmdletBinding()]
param(
    [switch]$SkipTypst,
    [switch]$SkipPoppler
)

$ErrorActionPreference = "Continue"

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host "Installing ai-job-search Windows helpers..." -ForegroundColor Cyan

$python = $null
foreach ($candidate in @("py", "python", "python3")) {
    if (Test-Command $candidate) {
        $python = $candidate
        break
    }
}

if (-not $python) {
    Write-Host "Python was not found on PATH. Install Python 3.10+ first." -ForegroundColor Red
    exit 1
}

Write-Host "Installing pymupdf (default ATS text extractor)..." -ForegroundColor Cyan
if ($python -eq "py") {
    & py -m pip install --upgrade pymupdf
} else {
    & $python -m pip install --upgrade pymupdf
}
if ($LASTEXITCODE -eq 0) {
    Write-Host "pymupdf installed." -ForegroundColor Green
} else {
    Write-Host "WARNING: pip install pymupdf failed. ATS checks will try pypdf, then pdftotext." -ForegroundColor Yellow
}

if (-not $SkipTypst) {
    if (Test-Command "typst") {
        Write-Host "typst already on PATH." -ForegroundColor Green
    } elseif (Test-Command "winget") {
        Write-Host "Installing Typst via winget..." -ForegroundColor Cyan
        winget install --id Typst.Typst --accept-package-agreements --accept-source-agreements
    } else {
        Write-Host "winget not found. Install Typst from https://github.com/typst/typst/releases" -ForegroundColor Yellow
    }
}

if (-not $SkipPoppler) {
    if (Test-Command "pdftotext") {
        Write-Host "pdftotext already on PATH." -ForegroundColor Green
    } elseif (Test-Command "choco") {
        Write-Host "Installing Poppler via chocolatey (optional pdftotext fallback)..." -ForegroundColor Cyan
        choco install poppler -y
    } elseif (Test-Command "winget") {
        Write-Host "Installing Poppler via winget (optional pdftotext fallback)..." -ForegroundColor Cyan
        winget install --id oschwartz10612.Poppler --accept-package-agreements --accept-source-agreements
    } else {
        Write-Host "Poppler not installed (optional). pymupdf is enough for ATS checks." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done. Next:" -ForegroundColor Cyan
Write-Host "  pip/pymupdf  -> python tools/extract_pdf_text.py <file.pdf>"
Write-Host "  Typst        -> /add-template --use typst   (inside Claude Code)"
Write-Host "  FCC (tokens) -> .\\start-with-fcc.ps1"
