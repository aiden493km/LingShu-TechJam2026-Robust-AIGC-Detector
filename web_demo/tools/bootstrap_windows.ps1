$ArchiveName = "windows-x86_64-python.zip"
$ExpectedBytes = 11133606
$ExpectedSha256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
$CacheName = "windows-x86_64-4acbed6dd1c7"
$Entrypoint = "python.exe"

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-StreamingSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $hasher.ComputeHash($stream)
        return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

function Test-ReparsePoint {
    param([Parameter(Mandatory = $true)][System.IO.FileSystemInfo]$Item)

    return (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Assert-CacheRootSafe {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([System.IO.File]::Exists($Path)) {
        throw "Runtime cache root is a file: $Path"
    }
    if (-not [System.IO.Directory]::Exists($Path)) {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
    }

    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or (Test-ReparsePoint $item)) {
        throw "Runtime cache root must be a local non-reparse directory: $Path"
    }
}

function Get-SafeDerivedDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $parentPath = [System.IO.Path]::GetDirectoryName($fullPath)
    if (-not [System.StringComparer]::OrdinalIgnoreCase.Equals($parentPath, $script:CacheRoot)) {
        throw "Refusing to manage a runtime directory outside the cache root: $fullPath"
    }

    $item = Get-Item -LiteralPath $fullPath -Force
    if (-not $item.PSIsContainer -or (Test-ReparsePoint $item)) {
        throw "Runtime cache entry must be a non-reparse directory: $fullPath"
    }
    return $item
}

function Remove-SafeDerivedDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $null = Get-SafeDerivedDirectory $Path
    Remove-Item -LiteralPath $Path -Recurse -Force
}

function Test-BundledPython {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not [System.IO.File]::Exists($Path)) {
        return $false
    }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or (Test-ReparsePoint $item)) {
        return $false
    }

    $probe = "import platform,sys; arch=platform.machine().lower(); ok=(platform.python_implementation()=='CPython' and sys.version_info[:2]==(3,12) and arch in ('amd64','x86_64')); print('{}|{}|{}'.format(platform.python_implementation(),platform.python_version(),platform.machine())); raise SystemExit(0 if ok else 1)"
    $probeOutput = @(& $Path -E -s -B -X utf8 -c $probe 2>&1)
    $probeExit = $LASTEXITCODE
    if ($probeExit -ne 0) {
        return $false
    }

    $identity = (($probeOutput | ForEach-Object { [string]$_ }) -join "").Trim()
    return ($identity -match '^CPython\|3\.12\.\d+\|(AMD64|x86_64)$')
}

function Test-RuntimeCache {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not [System.IO.Directory]::Exists($Path)) {
        return $false
    }
    try {
        $null = Get-SafeDerivedDirectory $Path
        $markerPath = Join-Path $Path ".complete-sha256"
        $pythonPath = [System.IO.Path]::GetFullPath((Join-Path $Path $Entrypoint))
        if (-not [System.IO.File]::Exists($markerPath)) {
            return $false
        }
        $markerItem = Get-Item -LiteralPath $markerPath -Force
        if ($markerItem.PSIsContainer -or (Test-ReparsePoint $markerItem)) {
            return $false
        }
        if ([System.IO.File]::ReadAllText($markerPath).Trim() -cne $ExpectedSha256) {
            return $false
        }
        return (Test-BundledPython $pythonPath)
    }
    catch {
        return $false
    }
}

function Enter-CacheLock {
    $deadline = [System.DateTime]::UtcNow.AddSeconds(30)
    while ($true) {
        try {
            if ([System.IO.File]::Exists($script:LockPath)) {
                $lockItem = Get-Item -LiteralPath $script:LockPath -Force
                if ($lockItem.PSIsContainer -or (Test-ReparsePoint $lockItem)) {
                    throw "Runtime cache lock must be a non-reparse file: $script:LockPath"
                }
            }
            $stream = [System.IO.File]::Open(
                $script:LockPath,
                [System.IO.FileMode]::OpenOrCreate,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None
            )
            return ,$stream
        }
        catch [System.IO.IOException] {
            if ([System.DateTime]::UtcNow -ge $deadline) {
                throw "Timed out waiting for another WebDemo runtime bootstrap"
            }
            [System.Threading.Thread]::Sleep(100)
        }
    }
}

function Remove-InvalidFixedCache {
    if ([System.IO.File]::Exists($script:FixedCache)) {
        throw "Runtime cache entry is a file: $script:FixedCache"
    }
    if (-not [System.IO.Directory]::Exists($script:FixedCache)) {
        return
    }

    $null = Get-SafeDerivedDirectory $script:FixedCache
    $renamed = Join-Path $script:CacheRoot ("{0}.invalid-{1}" -f $CacheName, [System.Guid]::NewGuid().ToString("N"))
    [System.IO.Directory]::Move($script:FixedCache, $renamed)
    Remove-SafeDerivedDirectory $renamed
}

function Clear-InheritedPythonEnvironment {
    $names = @{}
    foreach ($name in @(
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONUSERBASE",
        "VIRTUAL_ENV",
        "CONDA_PREFIX",
        "__PYVENV_LAUNCHER__"
    )) {
        $names[$name] = $true
    }

    $environment = [System.Environment]::GetEnvironmentVariables("Process")
    foreach ($key in $environment.Keys) {
        $name = [string]$key
        if ($name.StartsWith("PYTHON", [System.StringComparison]::OrdinalIgnoreCase)) {
            $names[$name] = $true
        }
    }
    foreach ($name in @($names.Keys)) {
        [System.Environment]::SetEnvironmentVariable([string]$name, $null, "Process")
    }
}

$TempCache = $null
try {
    $nativeArchitecture = if ($env:PROCESSOR_ARCHITEW6432) {
        $env:PROCESSOR_ARCHITEW6432
    }
    else {
        $env:PROCESSOR_ARCHITECTURE
    }
    if ($env:OS -cne "Windows_NT" -or -not [System.Environment]::Is64BitOperatingSystem -or $nativeArchitecture -notmatch '^(AMD64|x86_64)$') {
        throw "This bundled runtime requires Windows x86-64"
    }

    $webDemoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    $archivePath = [System.IO.Path]::GetFullPath((Join-Path $webDemoRoot (Join-Path "runtimes" $ArchiveName)))
    $serveDemo = [System.IO.Path]::GetFullPath((Join-Path $webDemoRoot (Join-Path "tools" "serve_demo.py")))
    $script:CacheRoot = [System.IO.Path]::GetFullPath((Join-Path $webDemoRoot ".runtime-cache"))
    $script:FixedCache = [System.IO.Path]::GetFullPath((Join-Path $script:CacheRoot $CacheName))
    $script:LockPath = [System.IO.Path]::GetFullPath((Join-Path $script:CacheRoot ("$CacheName.lock")))

    if (-not [System.IO.File]::Exists($archivePath)) {
        throw "Bundled runtime archive is missing: $archivePath"
    }
    $archive = Get-Item -LiteralPath $archivePath -Force
    if ($archive.PSIsContainer -or (Test-ReparsePoint $archive)) {
        throw "Bundled runtime archive must be a regular file: $archivePath"
    }
    if ($archive.Length -ne $ExpectedBytes) {
        throw "Bundled runtime archive size mismatch for $ArchiveName"
    }
    if ((Get-StreamingSha256 $archivePath) -cne $ExpectedSha256) {
        throw "Bundled runtime archive SHA-256 mismatch for $ArchiveName"
    }
    if (-not [System.IO.File]::Exists($serveDemo)) {
        throw "WebDemo server entry point is missing: $serveDemo"
    }

    Assert-CacheRootSafe $script:CacheRoot
    $cacheState = $null
    $cacheLock = Enter-CacheLock
    try {
        if (Test-RuntimeCache $script:FixedCache) {
            $cacheState = "reused"
        }
        else {
            Remove-InvalidFixedCache
        }
    }
    finally {
        $cacheLock.Dispose()
    }

    if ($null -eq $cacheState) {
        $TempCache = Join-Path $script:CacheRoot ("{0}.tmp-{1}" -f $CacheName, [System.Guid]::NewGuid().ToString("N"))
        [System.IO.Directory]::CreateDirectory($TempCache) | Out-Null
        $null = Get-SafeDerivedDirectory $TempCache
        Expand-Archive -LiteralPath $archivePath -DestinationPath $TempCache -Force

        $tempPython = [System.IO.Path]::GetFullPath((Join-Path $TempCache $Entrypoint))
        if (-not (Test-BundledPython $tempPython)) {
            throw "Extracted runtime failed the CPython 3.12 x86-64 self-test"
        }
        $markerPath = Join-Path $TempCache ".complete-sha256"
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($markerPath, "$ExpectedSha256`n", $utf8NoBom)

        $cacheLock = Enter-CacheLock
        try {
            if (Test-RuntimeCache $script:FixedCache) {
                $cacheState = "reused"
            }
            else {
                Remove-InvalidFixedCache
                [System.IO.Directory]::Move($TempCache, $script:FixedCache)
                $TempCache = $null
                $cacheState = "created"
            }
        }
        finally {
            $cacheLock.Dispose()
        }
    }

    if ($null -ne $TempCache -and [System.IO.Directory]::Exists($TempCache)) {
        Remove-SafeDerivedDirectory $TempCache
        $TempCache = $null
    }

    $bundledPython = [System.IO.Path]::GetFullPath((Join-Path $script:FixedCache $Entrypoint))
    if (-not (Test-RuntimeCache $script:FixedCache)) {
        throw "Bundled runtime cache failed final validation"
    }

    Clear-InheritedPythonEnvironment
    Set-Location -LiteralPath $webDemoRoot
    [System.Console]::Out.WriteLine("RUNTIME bundled CPython 3.12.10 (Windows x86_64)")
    [System.Console]::Out.WriteLine("CACHE $cacheState")
    [System.Console]::Out.WriteLine("ISOLATION inherited Python environments disabled")

    & $bundledPython -E -s -B -X utf8 $serveDemo @args
    exit $LASTEXITCODE
}
catch {
    if ($null -ne $TempCache -and [System.IO.Directory]::Exists($TempCache)) {
        try {
            Remove-SafeDerivedDirectory $TempCache
        }
        catch {
        }
    }
    $message = ([string]$_.Exception.Message -replace '[\r\n]+', ' ').Trim()
    [System.Console]::Error.WriteLine("ERROR: WebDemo bootstrap failed: $message Restore the committed web_demo runtime and try again.")
    exit 1
}
