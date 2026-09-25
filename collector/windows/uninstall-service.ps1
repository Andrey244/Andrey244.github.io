[CmdletBinding()]
param(
    [string]$Root = (Join-Path $env:ProgramData "TradingJournalCollector"),
    [switch]$PurgeData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Python = Join-Path $Root "venv\Scripts\python.exe"
if (Test-Path $Python) {
    & $Python -m trading_journal_collector.service --wait 30 stop 2>$null
    & $Python -m trading_journal_collector.service remove 2>$null
}

if ($PurgeData -and (Test-Path $Root)) {
    Remove-Item -Recurse -Force $Root
    Write-Host "Collector service removed and data purged."
} else {
    Write-Host "Collector service removed. Identity/config retained at $Root."
}
