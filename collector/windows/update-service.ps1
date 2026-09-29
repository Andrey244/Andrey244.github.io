param(
    [Parameter(Mandatory=$true)]
    [string]$CollectorSource,
    [string]$ServiceName = "TradingJournalCollector",
    [string]$Root = "$env:ProgramData\TradingJournalCollector"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this updater from an elevated PowerShell session."
    }
}

function Wait-ServiceState {
    param(
        [string]$Name,
        [string]$State,
        [int]$TimeoutSeconds = 40
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
        if ($null -ne $service -and [string]$service.Status -eq $State) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

Assert-Administrator

$sourcePath = (Resolve-Path -LiteralPath $CollectorSource).Path
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath "pyproject.toml") -PathType Leaf)) {
    throw "CollectorSource must point to the collector project containing pyproject.toml."
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -eq $service) {
    throw "Collector service is not installed."
}

$python = Join-Path $Root "venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Collector venv Python is missing: $python"
}

$registration = Join-Path $Root "state\registration.json"
if (-not (Test-Path -LiteralPath $registration -PathType Leaf)) {
    throw "Existing collector registration bundle is missing; refusing in-place update."
}

$tempRoot = Join-Path $env:TEMP ("tj-collector-update-" + [Guid]::NewGuid().ToString("N"))
$wheelDir = Join-Path $tempRoot "wheel"
$backupDir = Join-Path $tempRoot "backup"
New-Item -ItemType Directory -Force -Path $wheelDir,$backupDir | Out-Null

$purelib = (& $python -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
$packageDir = Join-Path $purelib "trading_journal_collector"
if (-not (Test-Path -LiteralPath $packageDir -PathType Container)) {
    throw "Installed Collector package is missing: $packageDir"
}
$distInfos = @(Get-ChildItem -LiteralPath $purelib -Directory -Filter "trading_journal_collector-*.dist-info")

try {
    # Build first while the live service is still untouched.
    & $python -m pip wheel --disable-pip-version-check --no-deps --wheel-dir $wheelDir $sourcePath | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Collector wheel build failed with exit code $LASTEXITCODE."
    }
    $wheel = @(Get-ChildItem -LiteralPath $wheelDir -File -Filter "trading_journal_collector-*.whl" | Sort-Object LastWriteTime -Descending)[0]
    if ($null -eq $wheel) {
        throw "Collector wheel was not produced."
    }

    Copy-Item -LiteralPath $packageDir -Destination $backupDir -Recurse -Force
    foreach ($distInfo in $distInfos) {
        Copy-Item -LiteralPath $distInfo.FullName -Destination $backupDir -Recurse -Force
    }

    Stop-Service -Name $ServiceName -Force
    if (-not (Wait-ServiceState -Name $ServiceName -State "Stopped" -TimeoutSeconds 30)) {
        throw "Collector service did not stop in time."
    }

    & $python -m pip install --disable-pip-version-check --no-deps --force-reinstall $wheel.FullName | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Collector package update failed with exit code $LASTEXITCODE."
    }

    & $python -c "import trading_journal_collector.worker, trading_journal_collector.service; print('collector import probe OK')" | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Updated Collector import probe failed."
    }

    Start-Service -Name $ServiceName
    if (-not (Wait-ServiceState -Name $ServiceName -State "Running" -TimeoutSeconds 40)) {
        throw "Updated Collector service did not reach Running."
    }
    if (-not (Test-Path -LiteralPath $registration -PathType Leaf)) {
        throw "Collector registration bundle disappeared after update."
    }

    Write-Host "Trading Journal Collector updated in place."
    Write-Host "Service status: Running"
    Write-Host "Identity/config/state preserved."
}
catch {
    $updateError = $_
    Write-Warning "Collector update failed; attempting package rollback."

    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Wait-ServiceState -Name $ServiceName -State "Stopped" -TimeoutSeconds 20 | Out-Null

    Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $purelib -Directory -Filter "trading_journal_collector-*.dist-info" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $backupPackage = Join-Path $backupDir "trading_journal_collector"
    if (Test-Path -LiteralPath $backupPackage -PathType Container) {
        Copy-Item -LiteralPath $backupPackage -Destination $purelib -Recurse -Force
    }
    Get-ChildItem -LiteralPath $backupDir -Directory -Filter "trading_journal_collector-*.dist-info" -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $purelib -Recurse -Force }

    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
    $rollbackRunning = Wait-ServiceState -Name $ServiceName -State "Running" -TimeoutSeconds 40
    if (-not $rollbackRunning) {
        throw "Collector update failed and automatic package rollback could not restore a Running service. Original error: $($updateError.Exception.Message)"
    }
    throw "Collector update failed; previous package was restored and service is Running. Original error: $($updateError.Exception.Message)"
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
