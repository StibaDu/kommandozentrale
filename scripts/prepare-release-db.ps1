param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = "Stop"
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$destinationDir = Split-Path -Parent $destinationPath
New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
if (Test-Path -LiteralPath $destinationPath) {
  Remove-Item -LiteralPath $destinationPath -Force
}
foreach ($suffix in @("-wal", "-shm")) {
  $extra = "$destinationPath$suffix"
  if (Test-Path -LiteralPath $extra) {
    Remove-Item -LiteralPath $extra -Force
  }
}

$python = @"
import sqlite3
import sys

source_path, destination_path = sys.argv[1], sys.argv[2]
source = sqlite3.connect(source_path)
destination = sqlite3.connect(destination_path)
source.backup(destination)
destination.close()
source.close()

con = sqlite3.connect(destination_path)
con.execute("PRAGMA foreign_keys = OFF")
tables = [
    "deck_chat_proposal",
    "deck_chat_message",
    "deck_simulation",
    "deck_revision",
    "deck_card",
    "deck",
    "build_run",
    "deck_explanation",
    "explain_run",
    "game_participant",
    "game",
    "pod_event",
    "pod_player",
    "pod_session",
    "combo_cache",
    "invites",
    "sessions",
    "users",
]
existing = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
for table in tables:
    if table in existing:
        con.execute(f'DELETE FROM "{table}"')
con.execute("DELETE FROM mpcfill_art WHERE nsfw = 1")
con.execute("DELETE FROM mpcfill_query")
con.commit()
con.execute("VACUUM")
con.commit()
for table in ("users", "sessions", "invites", "deck", "deck_card", "game", "pod_session"):
    if table in existing:
        count = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        if count:
            raise SystemExit(f"Release-DB enthält noch {count} Zeilen in {table}")
nsfw = con.execute("SELECT COUNT(*) FROM mpcfill_art WHERE nsfw = 1").fetchone()[0]
if nsfw:
    raise SystemExit(f"Release-DB enthält noch {nsfw} NSFW-Arts")
check = con.execute("PRAGMA integrity_check").fetchone()[0]
if check != "ok":
    raise SystemExit(f"SQLite integrity_check: {check}")
print(f"Release-DB bereit: {destination_path}")
con.close()
"@

$scriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("kz-prepare-release-" + [guid]::NewGuid().ToString("N") + ".py")
try {
  Set-Content -LiteralPath $scriptPath -Value $python -Encoding UTF8
  & python $scriptPath $sourcePath $destinationPath
  if ($LASTEXITCODE -ne 0) {
    throw "Release-Datenbank konnte nicht vorbereitet werden (Exit $LASTEXITCODE)."
  }
} finally {
  if (Test-Path -LiteralPath $scriptPath) {
    Remove-Item -LiteralPath $scriptPath -Force
  }
}
