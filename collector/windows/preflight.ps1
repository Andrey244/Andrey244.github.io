[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$SupabaseUrl,
    [Parameter(Mandatory=$true)]
    [string]$PublishableKey,
    [string]$Mt5TerminalPath = "",
    [string]$Mt4GoldenDir = "",
    [switch]$Mt4AllHistoryConfirmed,
    [switch]$SkipNetwork
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ServiceName = "TradingJournalCollector"
$Root = Join-Path $env:ProgramData $ServiceName
$Mt4WorkRoot = Join-Path $Root "mt4-work"
$results = [System.Collections.Generic.List[object]]::new()
$failed = $false

function Add-Check {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [Parameter(Mandatory=$true)][bool]$Passed,
        [Parameter(Mandatory=$true)][string]$Detail
    )
    $script:results.Add([pscustomobject]@{
        check = $Name
        passed = $Passed
        detail = $Detail
    })
    if (-not $Passed) { $script:failed = $true }
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-BitLockerProtected {
    param([Parameter(Mandatory=$true)][string]$Path)

    if (-not (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ passed=$false; detail="Get-BitLockerVolume is unavailable." }
    }

    $probe = $Path
    while (-not (Test-Path -LiteralPath $probe) -and $probe -ne [IO.Path]::GetPathRoot($probe)) {
        $probe = Split-Path -Parent $probe
    }
    if (-not (Test-Path -LiteralPath $probe)) {
        $probe = $env:ProgramData
    }

    $resolved = (Resolve-Path -LiteralPath $probe).Path
    $mountPoint = [IO.Path]::GetPathRoot($resolved)
    if ([string]::IsNullOrWhiteSpace($mountPoint)) {
        return [pscustomobject]@{ passed=$false; detail="Cannot resolve MT4 work volume." }
    }

    try {
        $volume = Get-BitLockerVolume -MountPoint $mountPoint -ErrorAction Stop
    } catch {
        return [pscustomobject]@{ passed=$false; detail="Cannot query BitLocker status for $mountPoint." }
    }

    $protection = [string]$volume.ProtectionStatus
    $status = [string]$volume.VolumeStatus
    $percentage = [int]$volume.EncryptionPercentage
    $ok = $protection -eq "On" -and $status -eq "FullyEncrypted" -and $percentage -eq 100

    return [pscustomobject]@{
        passed = $ok
        detail = "Mount=$mountPoint ProtectionStatus=$protection VolumeStatus=$status EncryptionPercentage=$percentage"
    }
}

Add-Check -Name "administrator" -Passed (Test-Administrator) -Detail "Preflight and installer require elevated PowerShell."

$os = Get-CimInstance Win32_OperatingSystem
Add-Check -Name "windows_x64" -Passed ([Environment]::Is64BitOperatingSystem) -Detail ("OS=" + $os.Caption + " Version=" + $os.Version)

$py = Get-Command py.exe -ErrorAction SilentlyContinue
if ($null -eq $py) {
    Add-Check -Name "python_3_12" -Passed $false -Detail "py.exe launcher not found."
} else {
    try {
        $version = (& py.exe -3.12 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null).Trim()
        Add-Check -Name "python_3_12" -Passed ($version -match '^3\.12\.') -Detail ("Python=" + $version)
    } catch {
        Add-Check -Name "python_3_12" -Passed $false -Detail "Python 3.12 is not available through py.exe."
    }
}

$rootParent = Split-Path -Parent $Root
Add-Check -Name "programdata_available" -Passed (Test-Path -LiteralPath $rootParent -PathType Container) -Detail ("ProgramData=" + $env:ProgramData)

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
Add-Check -Name "service_not_preexisting" -Passed ($null -eq $service) -Detail ($(if($null -eq $service){"Service is not installed."}else{"Existing service status=" + $service.Status}))

$uriOk = $false
try {
    $uri = [Uri]$SupabaseUrl
    $uriOk = $uri.IsAbsoluteUri -and $uri.Scheme -eq "https" -and -not [string]::IsNullOrWhiteSpace($uri.Host)
} catch {}
Add-Check -Name "supabase_https_url" -Passed $uriOk -Detail ($(if($uriOk){"HTTPS Supabase URL accepted."}else{"Supabase URL must be an absolute HTTPS URL."}))

$publishableShapeOk = -not [string]::IsNullOrWhiteSpace($PublishableKey) -and $PublishableKey.Length -ge 20
Add-Check -Name "publishable_key_shape" -Passed $publishableShapeOk -Detail "Publishable key is present; value is never printed."

if (-not $SkipNetwork -and $uriOk -and $publishableShapeOk) {
    try {
        $headers = @{ apikey = $PublishableKey; Accept = "application/openapi+json" }
        $response = Invoke-WebRequest -Uri ($SupabaseUrl.TrimEnd('/') + "/rest/v1/") -Headers $headers -Method Get -TimeoutSec 20 -UseBasicParsing
        Add-Check -Name "supabase_network" -Passed ($response.StatusCode -eq 200) -Detail ("REST endpoint HTTP " + $response.StatusCode)
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        Add-Check -Name "supabase_network" -Passed $false -Detail ("Supabase REST connectivity failed" + $(if($status){" HTTP " + $status}else{""}))
    }
} elseif ($SkipNetwork) {
    $results.Add([pscustomobject]@{
        check = "supabase_network"
        passed = $null
        detail = "Skipped explicitly; install-service.ps1 never uses SkipNetwork."
    })
}

if ($Mt5TerminalPath) {
    $mt5Exists = Test-Path -LiteralPath $Mt5TerminalPath -PathType Leaf
    Add-Check -Name "mt5_terminal" -Passed $mt5Exists -Detail ($(if($mt5Exists){"MT5 terminal path exists."}else{"MT5 terminal executable is missing."}))
} else {
    $results.Add([pscustomobject]@{ check="mt5_terminal"; passed=$null; detail="MT5 not requested for this install." })
}

if ($Mt4GoldenDir) {
    $mt4DirOk = Test-Path -LiteralPath $Mt4GoldenDir -PathType Container
    Add-Check -Name "mt4_golden_dir" -Passed $mt4DirOk -Detail ($(if($mt4DirOk){"MT4 golden directory exists."}else{"MT4 golden directory is missing."}))

    if ($mt4DirOk) {
        $terminal = Join-Path $Mt4GoldenDir "terminal.exe"
        $exporter = Join-Path $Mt4GoldenDir "MQL4\Scripts\TradeJournalExport_MT4.ex4"
        Add-Check -Name "mt4_terminal" -Passed (Test-Path -LiteralPath $terminal -PathType Leaf) -Detail "Golden MT4 terminal.exe must exist."
        Add-Check -Name "mt4_exporter_ex4" -Passed (Test-Path -LiteralPath $exporter -PathType Leaf) -Detail "Compiled TradeJournalExport_MT4.ex4 must exist."
    } else {
        Add-Check -Name "mt4_terminal" -Passed $false -Detail "Cannot validate terminal.exe without golden directory."
        Add-Check -Name "mt4_exporter_ex4" -Passed $false -Detail "Cannot validate exporter EX4 without golden directory."
    }

    Add-Check -Name "mt4_all_history_attestation" -Passed ([bool]$Mt4AllHistoryConfirmed) -Detail "Operator must verify MT4 Account History = All History before enabling direct MT4 sync."

    $bitlocker = Test-BitLockerProtected -Path $Mt4WorkRoot
    Add-Check -Name "mt4_bitlocker" -Passed ([bool]$bitlocker.passed) -Detail ([string]$bitlocker.detail)
} else {
    $results.Add([pscustomobject]@{ check="mt4_golden_dir"; passed=$null; detail="MT4 not requested for this install." })
    $results.Add([pscustomobject]@{ check="mt4_all_history_attestation"; passed=$null; detail="MT4 not requested for this install." })
    $results.Add([pscustomobject]@{ check="mt4_bitlocker"; passed=$null; detail="MT4 not requested for this install." })
}

$summary = [pscustomobject]@{
    ready = -not $failed
    service_name = $ServiceName
    checks = $results
}

$summary | ConvertTo-Json -Depth 6
if ($failed) { exit 1 }
exit 0
