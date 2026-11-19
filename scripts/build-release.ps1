param(
  [string]$Version = "0.1.0",
  [string]$IsccPath = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BuildRoot = Join-Path $Root "build\release"
$Stage = Join-Path $BuildRoot "stage"
$Artifact = Join-Path $BuildRoot "Kommandozentrale-Setup-$Version.exe"

function Find-Bun {
  $candidate = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  $command = Get-Command bun -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "Bun wurde nicht gefunden. Installiere Bun oder setze PATH."
}

function Find-Iscc {
  param([string]$Explicit)
  if ($Explicit) {
    if (-not (Test-Path -LiteralPath $Explicit)) { throw "ISCC.exe nicht gefunden: $Explicit" }
    return $Explicit
  }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 7\ISCC.exe"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "Inno Setup (ISCC.exe) wurde nicht gefunden."
}

$Bun = Find-Bun
$Iscc = Find-Iscc -Explicit $IsccPath

Write-Host "Baue Client ..."
& $Bun run build:client
if ($LASTEXITCODE -ne 0) { throw "Client-Build fehlgeschlagen." }

Write-Host "Bereite Staging vor: $Stage"
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "runtime") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "data") | Out-Null

Copy-Item -LiteralPath (Join-Path $Root "src") -Destination $Stage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "public") -Destination $Stage -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $Stage "public") -Filter "*.map" -File -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item -LiteralPath (Join-Path $Root "package.json") -Destination $Stage -Force
foreach ($file in @("bun.lock", "tsconfig.json")) {
  $path = Join-Path $Root $file
  if (Test-Path -LiteralPath $path) { Copy-Item -LiteralPath $path -Destination $Stage -Force }
}
Copy-Item -LiteralPath (Join-Path $Root "installer\Kommandozentrale.cmd") -Destination (Join-Path $Stage "Kommandozentrale.cmd") -Force
Copy-Item -LiteralPath (Join-Path $Root "installer\README-WINDOWS.txt") -Destination (Join-Path $Stage "README.txt") -Force
Copy-Item -LiteralPath $Bun -Destination (Join-Path $Stage "runtime\bun.exe") -Force

Write-Host "Installiere Produktionsabhängigkeiten ..."
Push-Location $Stage
try {
  & $Bun install --production --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "bun install --production fehlgeschlagen." }
} finally {
  Pop-Location
}

Write-Host "Bereinige Release-Datenbank (ohne Profile/Decks/NSFW) ..."
& (Join-Path $PSScriptRoot "prepare-release-db.ps1") -Source (Join-Path $Root "data\kommandozentrale.db") -Destination (Join-Path $Stage "data\kommandozentrale.db")

Write-Host "Kompiliere Inno-Setup ..."
& $Iscc "/DAppVersion=$Version" "/DStageDir=$Stage" (Join-Path $Root "installer\Kommandozentrale.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno-Setup fehlgeschlagen." }

if (-not (Test-Path -LiteralPath $Artifact)) {
  throw "Setup wurde nicht erstellt: $Artifact"
}
$info = Get-Item -LiteralPath $Artifact
$hash = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash
Write-Host ""
Write-Host "Fertig: $($info.FullName)"
Write-Host "Größe:  $([math]::Round($info.Length / 1MB, 1)) MB"
Write-Host "SHA256: $hash"
