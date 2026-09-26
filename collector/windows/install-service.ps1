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
    [switch]$Mt4AllHistoryConfirmed,
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ServiceName = "TradingJournalCollector"
$ServiceAccount = "NT SERVICE\$ServiceName"

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

function Assert-BitLockerProtected {
    param([Parameter(Mandatory=$true)][string]$Path)

    $resolved = (Resolve-Path $Path).Path
    $mountPoint = [IO.Path]::GetPathRoot($resolved)
    if ([string]::IsNullOrWhiteSpace($mountPoint)) {
        throw "Cannot resolve the volume for MT4 work path: $resolved"
    }

    if (-not (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) {
        throw "MT4 direct sync requires a verifiable encrypted work volume, but Get-BitLockerVolume is unavailable."
    }

    $volume = Get-BitLockerVolume -MountPoint $mountPoint -ErrorAction Stop
    if ($null -eq $volume) {
        throw "Cannot verify BitLocker protection for $mountPoint."
    }

    $protection = [string]$volume.ProtectionStatus
    $status = [string]$volume.VolumeStatus
    $percentage = [int]$volume.EncryptionPercentage

    if ($protection -ne "On" -or $status -ne "FullyEncrypted" -or $percentage -ne 100) {
        throw "MT4 direct sync requires BitLocker protection on $mountPoint (ProtectionStatus=On, VolumeStatus=FullyEncrypted, EncryptionPercentage=100)."
    }
}

function Set-DirectoryAcl {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$ServiceRights
    )

    Invoke-Checked "icacls.exe" @($Path, "/inheritance:r")
    Invoke-Checked "icacls.exe" @(
        $Path,
        "/grant:r",
        "SYSTEM:(OI)(CI)F",
        "BUILTIN\Administrators:(OI)(CI)F",
        ($ServiceAccount + ":(OI)(CI)" + $ServiceRights)
    )
}

Assert-Administrator

$preflightArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $PSScriptRoot "preflight.ps1"),
    "-SupabaseUrl", $SupabaseUrl,
    "-PublishableKey", $PublishableKey
)
if ($Mt5TerminalPath) { $preflightArgs += @("-Mt5TerminalPath", $Mt5TerminalPath) }
if ($Mt4GoldenDir) { $preflightArgs += @("-Mt4GoldenDir", $Mt4GoldenDir) }
if ($Mt4AllHistoryConfirmed) { $preflightArgs += "-Mt4AllHistoryConfirmed" }

& powershell.exe @preflightArgs
if ($LASTEXITCODE -ne 0) {
    throw "Collector preflight failed. Installation aborted before runtime state was created."
}

$Root = Join-Path $env:ProgramData "TradingJournalCollector"
$IdentityDir = Join-Path $Root "identity"
$Mt4WorkRoot = Join-Path $Root "mt4-work"
$StateDir = Join-Path $Root "state"
$VenvDir = Join-Path $Root "venv"
$ConfigPath = Join-Path $Root "collector.json"
$Python = Join-Path $VenvDir "Scripts\python.exe"

if ($SupabaseUrl -notmatch '^https://') { throw "SupabaseUrl must use https." }
if ($PublishableKey.Length -lt 20) { throw "PublishableKey is invalid." }
if ([string]::IsNullOrWhiteSpace($CollectorName) -or $CollectorName.Length -gt 120) {
    throw "CollectorName must be 1..120 characters."
}
if ($Mt4GoldenDir -and -not (Test-Path -LiteralPath $Mt4GoldenDir -PathType Container)) {
    throw "Mt4GoldenDir does not exist."
}
if ($Mt5TerminalPath -and -not (Test-Path -LiteralPath $Mt5TerminalPath -PathType Leaf)) {
    throw "Mt5TerminalPath does not exist."
}

New-Item -ItemType Directory -Force -Path $Root,$IdentityDir,$Mt4WorkRoot,$StateDir | Out-Null

if ($Mt4GoldenDir) {
    Assert-BitLockerProtected -Path $Mt4WorkRoot
}

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
    mt4_history_all_confirmed = [bool]$Mt4AllHistoryConfirmed
    initial_sync_days = 730
    sync_overlap_seconds = 120
    ingest_batch_size = 100
}
$json = $config | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($ConfigPath, $json, [Text.UTF8Encoding]::new($false))

$env:TJ_CONFIG_PATH = $ConfigPath
Invoke-Checked $Python @(
    "-m", "trading_journal_collector.service",
    "--startup", "delayed",
    "install"
)

# Microsoft-supported per-service virtual account. No reusable Windows
# password is created or passed to the service installer.
Invoke-Checked "sc.exe" @("config", $ServiceName, "obj=", $ServiceAccount)

# Root/runtime is read+execute only for the collector identity. Mutable state is
# limited to the three dedicated directories below.
Set-DirectoryAcl -Path $Root -ServiceRights "RX"
Set-DirectoryAcl -Path $IdentityDir -ServiceRights "M"
Set-DirectoryAcl -Path $Mt4WorkRoot -ServiceRights "M"
Set-DirectoryAcl -Path $StateDir -ServiceRights "M"

Invoke-Checked "icacls.exe" @($ConfigPath, "/inheritance:r")
Invoke-Checked "icacls.exe" @(
    $ConfigPath,
    "/grant:r",
    "SYSTEM:F",
    "BUILTIN\Administrators:F",
    ($ServiceAccount + ":R")
)

if ($Mt4GoldenDir) {
    Invoke-Checked "icacls.exe" @(
        (Resolve-Path $Mt4GoldenDir).Path,
        "/grant:r",
        ($ServiceAccount + ":(OI)(CI)RX")
    )
    if (-not $Mt4AllHistoryConfirmed) {
        Write-Warning "MT4 is installed fail-closed for history sync. Re-run with -Mt4AllHistoryConfirmed only after the golden terminal Account History is explicitly set to All History and validated."
    }
}

Invoke-Checked "sc.exe" @(
    "failure", $ServiceName,
    "reset=", "86400",
    "actions=", "restart/5000/restart/30000/restart/120000"
)
Invoke-Checked "sc.exe" @("failureflag", $ServiceName, "1")

if (-not $NoStart) {
    Invoke-Checked $Python @(
        "-m", "trading_journal_collector.service",
        "--wait", "30",
        "start"
    )
}

Write-Host "Trading Journal Collector installed."
Write-Host "Service identity: $ServiceAccount"
Write-Host "Config: $ConfigPath"
Write-Host "Identity: $IdentityDir"
Write-Host "Registration bundle: $(Join-Path $StateDir 'registration.json')"
Write-Host "The registration bundle contains only public-key material and a token hash."
