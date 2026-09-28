[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$SupabaseUrl,
    [Parameter(Mandatory=$true)]
    [string]$PublishableKey,
    [string]$Mt5TerminalPath = "",
    [string]$Mt4GoldenDir = "",
    [string]$Mt4WorkRoot = "",
    [switch]$Mt4AllHistoryConfirmed,
    [switch]$SkipNetwork
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ServiceName = "TradingJournalCollector"
$Root = Join-Path $env:ProgramData $ServiceName
if ([string]::IsNullOrWhiteSpace($Mt4WorkRoot)) {
    $Mt4WorkRoot = Join-Path $Root "mt4-work"
}
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

function Test-BitLockerProtected {
    param([Parameter(Mandatory=$true)][string]$Path)

    if (-not (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ passed=$false; detail="Get-BitLockerVolume is unavailable." }
    }

    $rootHint = [IO.Path]::GetPathRoot($Path)
    if ([string]::IsNullOrWhiteSpace($rootHint) -or -not (Test-Path -LiteralPath $rootHint -PathType Container)) {
        return [pscustomobject]@{ passed=$false; detail="MT4 work volume is not mounted or accessible: $rootHint" }
    }

    $probe = $Path
    while (-not (Test-Path -LiteralPath $probe) -and $probe -ne $rootHint) {
        $probe = Split-Path -Parent $probe
    }
    if (-not (Test-Path -LiteralPath $probe)) {
        return [pscustomobject]@{ passed=$false; detail="Cannot resolve MT4 work path on $rootHint." }
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

$machinePython = Get-MachinePython312
if ($null -eq $machinePython) {
    Add-Check -Name "python_3_12" -Passed $false -Detail "Machine-wide Python 3.12 is required for the Windows service. Per-user Python under a user profile is not accepted."
} else {
    Add-Check -Name "python_3_12" -Passed $true -Detail ("Machine Python=" + $machinePython.version + " Path=" + $machinePython.exe)
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
        # Do not probe the PostgREST OpenAPI root here: hosted Supabase now requires
        # a secret API key for that endpoint. The collector must use only a public
        # publishable key, so validate it against the journal's read-only public RPC.
        $headers = @{
            apikey = $PublishableKey
            Accept = "application/json"
            "Content-Type" = "application/json"
        }
        $body = '{"p_email":"collector-preflight@invalid.local"}'
        $response = Invoke-WebRequest -Uri ($SupabaseUrl.TrimEnd('/') + "/rest/v1/rpc/signup_wait_seconds") -Headers $headers -Method Post -Body $body -TimeoutSec 20 -UseBasicParsing
        Add-Check -Name "supabase_network" -Passed ($response.StatusCode -eq 200) -Detail ("Publishable-key Data API probe HTTP " + $response.StatusCode)
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        Add-Check -Name "supabase_network" -Passed $false -Detail ("Supabase publishable-key Data API probe failed" + $(if($status){" HTTP " + $status}else{""}))
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
    $mt4WorkRootAbsolute = [IO.Path]::IsPathRooted($Mt4WorkRoot)
    Add-Check -Name "mt4_work_root_absolute" -Passed $mt4WorkRootAbsolute -Detail ($(if($mt4WorkRootAbsolute){"MT4 work root is absolute: $Mt4WorkRoot"}else{"MT4 work root must be an absolute local path."}))

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

    if ($mt4WorkRootAbsolute) {
        $bitlocker = Test-BitLockerProtected -Path $Mt4WorkRoot
        Add-Check -Name "mt4_bitlocker" -Passed ([bool]$bitlocker.passed) -Detail ([string]$bitlocker.detail)
    } else {
        Add-Check -Name "mt4_bitlocker" -Passed $false -Detail "Cannot verify BitLocker until MT4 work root is an absolute local path."
    }
} else {
    $results.Add([pscustomobject]@{ check="mt4_work_root_absolute"; passed=$null; detail="MT4 not requested for this install." })
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
