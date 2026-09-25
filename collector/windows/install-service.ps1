[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$SupabaseUrl,
    [Parameter(Mandatory=$true)]
    [string]$PublishableKey,
    [string]$CollectorName = $env:COMPUTERNAME,
    [string]$CollectorSource = (Resolve-Path (Join-Path $PSScriptRoot "..")),
    [string]$Mt5TerminalPath = "",
    [string]$Mt4GoldenDir = "",
    [string]$Mt4BootstrapSymbol = "EURUSD",
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this installer from an elevated PowerShell session."
    }
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

Assert-Administrator
$Root = Join-Path $env:ProgramData "TradingJournalCollector"

if ($SupabaseUrl -notmatch '^https://') { throw "SupabaseUrl must use https." }
if ($PublishableKey.Length -lt 20) { throw "PublishableKey is invalid." }
if ([string]::IsNullOrWhiteSpace($CollectorName) -or $CollectorName.Length -gt 120) {
    throw "CollectorName must be 1..120 characters."
}

$IdentityDir = Join-Path $Root "identity"
$Mt4WorkRoot = Join-Path $Root "mt4-work"
$VenvDir = Join-Path $Root "venv"
$ConfigPath = Join-Path $Root "collector.json"
$Python = Join-Path $VenvDir "Scripts\python.exe"

New-Item -ItemType Directory -Force -Path $Root,$IdentityDir,$Mt4WorkRoot | Out-Null

Invoke-Checked "icacls.exe" @($Root, "/inheritance:r")
Invoke-Checked "icacls.exe" @(
    $Root,
    "/grant:r",
    "SYSTEM:(OI)(CI)F",
    "BUILTIN\Administrators:(OI)(CI)F",
    "NT AUTHORITY\LOCAL SERVICE:(OI)(CI)M"
)

if (-not (Test-Path $Python)) {
    Invoke-Checked "py.exe" @("-3.12", "-m", "venv", $VenvDir)
}

Invoke-Checked $Python @(
    "-m", "pip", "install", "--disable-pip-version-check",
    ($CollectorSource + "[windows]")
)

$config = [ordered]@{
    collector_name = $CollectorName
    supabase_url = $SupabaseUrl
    supabase_publishable_key = $PublishableKey
    identity_dir = $IdentityDir
    mt5_terminal_path = $Mt5TerminalPath
    mt4_golden_dir = $Mt4GoldenDir
    mt4_work_root = $Mt4WorkRoot
    mt4_bootstrap_symbol = $Mt4BootstrapSymbol
    initial_sync_days = 730
    sync_overlap_seconds = 120
    ingest_batch_size = 100
}
$json = $config | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($ConfigPath, $json, [Text.UTF8Encoding]::new($false))

$env:TJ_CONFIG_PATH = $ConfigPath
Invoke-Checked $Python @(
    "-m", "trading_journal_collector.service",
    "--username", "NT AUTHORITY\LocalService",
    "--startup", "delayed",
    "install"
)

Invoke-Checked "sc.exe" @(
    "failure", "TradingJournalCollector",
    "reset=", "86400",
    "actions=", "restart/5000/restart/30000/restart/120000"
)
Invoke-Checked "sc.exe" @("failureflag", "TradingJournalCollector", "1")

if (-not $NoStart) {
    Invoke-Checked $Python @(
        "-m", "trading_journal_collector.service",
        "--wait", "30",
        "start"
    )
}

Write-Host "Trading Journal Collector installed."
Write-Host "Config: $ConfigPath"
Write-Host "Identity: $IdentityDir"
Write-Host "Registration bundle: $(Join-Path $Root 'registration.json')"
Write-Host "The registration bundle contains only public-key material and a token hash."
