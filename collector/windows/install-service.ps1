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
    [string]$Mt4WorkRoot = "",
    [string]$Mt4BootstrapSymbol = "EURUSD",
    [switch]$Mt4AllHistoryConfirmed,
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ServiceName = "TradingJournalCollector"
$ServiceAccount = "NT SERVICE\$ServiceName"
$SystemSid = "S-1-5-18"
$AdministratorsSid = "S-1-5-32-544"
$ServiceSid = ""

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this installer from an elevated PowerShell session."
    }
}

function Get-MachinePython312 {
    $keys = @(
        "HKLM:\SOFTWARE\Python\PythonCore\3.12\InstallPath",
        "HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore\3.12\InstallPath"
    )

    foreach ($key in $keys) {
        if (-not (Test-Path -LiteralPath $key)) { continue }
        try {
            $item = Get-Item -LiteralPath $key -ErrorAction Stop
            $candidate = [string]$item.GetValue("ExecutablePath")
            if ([string]::IsNullOrWhiteSpace($candidate)) {
                $base = [string]$item.GetValue("")
                if (-not [string]::IsNullOrWhiteSpace($base)) {
                    $candidate = Join-Path $base "python.exe"
                }
            }
            if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                continue
            }
            $version = (& $candidate -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null).Trim()
            if ($version -match '^3\.12\.') {
                return [pscustomobject]@{ exe=$candidate; version=$version }
            }
        } catch {}
    }
    return $null
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Prepare-MachinePywin32ServiceHost {
    param(
        [Parameter(Mandatory=$true)][string]$MachinePythonExe
    )

    $expectedVersion = "312"
    $installedVersion = (& $MachinePythonExe -c "import importlib.metadata as m; print(m.version('pywin32') if 'pywin32' in {d.metadata['Name'].lower() for d in m.distributions()} else '')" 2>$null).Trim()
    if ($installedVersion -and $installedVersion -ne $expectedVersion) {
        throw "Machine-wide pywin32 version $installedVersion is installed; expected $expectedVersion. Refusing to modify a conflicting global pywin32 install."
    }
    if (-not $installedVersion) {
        Invoke-Checked $MachinePythonExe @(
            "-m", "pip", "install", "--disable-pip-version-check",
            ("pywin32==" + $expectedVersion)
        ) | Out-Host
    }

    $machineRoot = Split-Path -Parent $MachinePythonExe
    $postInstall = Join-Path $machineRoot "Scripts\pywin32_postinstall.py"
    if (-not (Test-Path -LiteralPath $postInstall -PathType Leaf)) {
        throw "Machine pywin32 post-install script is missing: $postInstall"
    }
    Invoke-Checked $MachinePythonExe @($postInstall, "-install") | Out-Host

    $purelib = (& $MachinePythonExe -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
    $serviceSource = Join-Path $purelib "win32\pythonservice.exe"
    $serviceExe = Join-Path $machineRoot "pythonservice.exe"
    if (-not (Test-Path -LiteralPath $serviceSource -PathType Leaf)) {
        throw "Machine pywin32 service host source is missing: $serviceSource"
    }
    Copy-Item -LiteralPath $serviceSource -Destination $serviceExe -Force

    if (-not (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
        throw "Machine pywin32 service host is missing after preparation: $serviceExe"
    }

    try {
        & $MachinePythonExe -c "import servicemanager, win32serviceutil" 2>$null
        if ($LASTEXITCODE -ne 0) { throw "import probe failed" }
    } catch {
        throw "Machine pywin32 import probe failed after post-install."
    }

    return [pscustomobject]@{
        exe = $serviceExe
        purelib = $purelib
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

    if ([string]::IsNullOrWhiteSpace($script:ServiceSid)) {
        throw "Service SID is not initialized."
    }

    Invoke-Checked "icacls.exe" @($Path, "/inheritance:r")
    Invoke-Checked "icacls.exe" @(
        $Path,
        "/grant:r",
        ("*" + $SystemSid + ":(OI)(CI)F"),
        ("*" + $AdministratorsSid + ":(OI)(CI)F"),
        ("*" + $script:ServiceSid + ":(OI)(CI)" + $ServiceRights)
    )
}

Assert-Administrator

$MachinePython = Get-MachinePython312
if ($null -eq $MachinePython) {
    throw "Machine-wide Python 3.12 is required for the Windows service. Install Python 3.12 for all users/machine scope and re-run the installer."
}

if ($Mt4WorkRoot) {
    if (-not [IO.Path]::IsPathRooted($Mt4WorkRoot)) {
        throw "Mt4WorkRoot must be an absolute local path."
    }
    $Mt4WorkRoot = [IO.Path]::GetFullPath($Mt4WorkRoot)
}

$preflightArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $PSScriptRoot "preflight.ps1"),
    "-SupabaseUrl", $SupabaseUrl,
    "-PublishableKey", $PublishableKey
)
if ($Mt5TerminalPath) { $preflightArgs += @("-Mt5TerminalPath", $Mt5TerminalPath) }
if ($Mt4GoldenDir) { $preflightArgs += @("-Mt4GoldenDir", $Mt4GoldenDir) }
if ($Mt4WorkRoot) { $preflightArgs += @("-Mt4WorkRoot", $Mt4WorkRoot) }
if ($Mt4AllHistoryConfirmed) { $preflightArgs += "-Mt4AllHistoryConfirmed" }

& powershell.exe @preflightArgs
if ($LASTEXITCODE -ne 0) {
    throw "Collector preflight failed. Installation aborted before runtime state was created."
}

$Root = Join-Path $env:ProgramData "TradingJournalCollector"
$IdentityDir = Join-Path $Root "identity"
if ([string]::IsNullOrWhiteSpace($Mt4WorkRoot)) {
    $Mt4WorkRoot = Join-Path $Root "mt4-work"
}
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
    Invoke-Checked $MachinePython.exe @("-m", "venv", $VenvDir)
}

Invoke-Checked $Python @(
    "-m", "pip", "install", "--disable-pip-version-check",
    ($CollectorSource + "[windows]")
)

# pywin32 services are machine-global by design. Keep Collector dependencies
# isolated in the venv, but host the Windows service with machine-wide pywin32.
$MachineServiceHost = Prepare-MachinePywin32ServiceHost -MachinePythonExe $MachinePython.exe
$VenvPurelib = (& $Python -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
$ServiceClassString = $VenvPurelib + "\trading_journal_collector.service.TradingJournalCollectorService"

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
$env:TJ_PYTHON_SERVICE_EXE = $MachineServiceHost.exe
$env:TJ_SERVICE_CLASS_STRING = $ServiceClassString
try {
    Invoke-Checked $Python @(
        "-m", "trading_journal_collector.service",
        "--startup", "delayed",
        "install"
    )
} finally {
    Remove-Item Env:TJ_PYTHON_SERVICE_EXE -ErrorAction SilentlyContinue
    Remove-Item Env:TJ_SERVICE_CLASS_STRING -ErrorAction SilentlyContinue
}

# Microsoft-supported per-service virtual account. No reusable Windows
# password is created or passed to the service installer.
Invoke-Checked "sc.exe" @("config", $ServiceName, "obj=", $ServiceAccount)

try {
    $script:ServiceSid = ([Security.Principal.NTAccount]$ServiceAccount).Translate([Security.Principal.SecurityIdentifier]).Value
} catch {
    throw "Cannot resolve Windows service SID for $ServiceAccount."
}

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
    ("*" + $SystemSid + ":F"),
    ("*" + $AdministratorsSid + ":F"),
    ("*" + $ServiceSid + ":R")
)

if ($Mt4GoldenDir) {
    Invoke-Checked "icacls.exe" @(
        (Resolve-Path $Mt4GoldenDir).Path,
        "/grant:r",
        ("*" + $ServiceSid + ":(OI)(CI)RX")
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

$RegistrationPath = Join-Path $StateDir "registration.json"

if (-not $NoStart) {
    Invoke-Checked $Python @(
        "-m", "trading_journal_collector.service",
        "--wait", "30",
        "start"
    )

    $deadline = (Get-Date).AddSeconds(40)
    $serviceReady = $false
    while ((Get-Date) -lt $deadline) {
        $serviceState = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($null -ne $serviceState -and $serviceState.Status -eq "Running" -and (Test-Path -LiteralPath $RegistrationPath -PathType Leaf)) {
            $serviceReady = $true
            break
        }
        if ($null -ne $serviceState -and $serviceState.Status -eq "Stopped") {
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $serviceReady) {
        $finalState = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        $statusText = $(if($null -eq $finalState){"MISSING"}else{[string]$finalState.Status})
        throw "Collector service failed runtime proof: status=$statusText registration_bundle_exists=$(Test-Path -LiteralPath $RegistrationPath -PathType Leaf)."
    }
}

Write-Host "Trading Journal Collector installed."
Write-Host "Service identity: $ServiceAccount"
Write-Host "Config: $ConfigPath"
Write-Host "Identity: $IdentityDir"
Write-Host "Registration bundle: $RegistrationPath"
Write-Host "The registration bundle contains only public-key material and a token hash."
