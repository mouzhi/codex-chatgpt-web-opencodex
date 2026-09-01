#requires -Version 7.0

<#
Windows operations for the packaged Codex Web GPT OpenCodex launcher.

This module deliberately owns no provider credentials.  The packaged launcher owns its
configuration and control token under the fixed provider profile; this module only starts the
signed package, probes its unauthenticated loopback health endpoint, and manages a per-user
autostart entry.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows)) {
  throw "OpenCodexProviderLauncher is supported only on Windows."
}

Set-Variable -Name ProviderPort -Option ReadOnly -Scope Script -Value 17841
Set-Variable -Name ProviderHost -Option ReadOnly -Scope Script -Value "127.0.0.1"
Set-Variable -Name ProviderService -Option ReadOnly -Scope Script -Value "codex-chatgpt-web"
Set-Variable -Name ProviderProductName -Option ReadOnly -Scope Script -Value "Codex Web GPT OpenCodex"
Set-Variable -Name ProviderExecutableName -Option ReadOnly -Scope Script -Value "$ProviderProductName.exe"
Set-Variable -Name ProviderNsisGuid -Option ReadOnly -Scope Script -Value "7a35d84f-bf5d-4d71-9f59-8e78c35c5a52"
Set-Variable -Name ProviderArgument -Option ReadOnly -Scope Script -Value "--opencodex-provider"
Set-Variable -Name HiddenArgument -Option ReadOnly -Scope Script -Value "--hidden"
Set-Variable -Name AutostartValueName -Option ReadOnly -Scope Script -Value $ProviderProductName
Set-Variable -Name AutostartKey -Option ReadOnly -Scope Script -Value `
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

function Get-ProviderPaths {
  [CmdletBinding()]
  param()

  $userHome = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if ([string]::IsNullOrWhiteSpace($userHome) -or [string]::IsNullOrWhiteSpace($localAppData)) {
    throw "Windows user profile paths could not be resolved."
  }

  [ordered]@{
    UserHome = [IO.Path]::GetFullPath($userHome)
    LocalAppData = [IO.Path]::GetFullPath($localAppData)
    ProviderHome = [IO.Path]::GetFullPath((Join-Path $userHome ".codex-chatgpt-web-opencodex"))
    ProviderCodexHome = [IO.Path]::GetFullPath((Join-Path $userHome ".codex-opencodex-web-bridge"))
    ProviderUserData = [IO.Path]::GetFullPath((Join-Path $localAppData $ProviderProductName))
    ProviderHost = $ProviderHost
    ProviderPort = $ProviderPort
    HealthUri = "http://${ProviderHost}:${ProviderPort}/healthz"
    InstallerRegistryKey = "HKCU:\Software\$ProviderNsisGuid"
    ExecutableName = $ProviderExecutableName
  }
}

function Test-AbsoluteWindowsPath {
  [CmdletBinding()]
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path) -or $Path.IndexOfAny([char[]]@('"', "`r", "`n")) -ge 0) {
    return $false
  }
  try {
    return [IO.Path]::IsPathFullyQualified($Path)
  } catch {
    return $false
  }
}

function Get-NormalizedPath {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-AbsoluteWindowsPath -Path $Path)) {
    throw "Expected an absolute Windows path."
  }
  return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Test-PathUnderRoot {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Root
  )

  try {
    $candidate = Get-NormalizedPath -Path $Path
    $rootPath = Get-NormalizedPath -Path $Root
  } catch {
    return $false
  }
  if ([string]::Equals($candidate, $rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  return $candidate.StartsWith("$rootPath\", [StringComparison]::OrdinalIgnoreCase)
}

function Test-PortableExecutable {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-AbsoluteWindowsPath -Path $Path)) {
    throw "Executable path must be absolute."
  }
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.PSIsContainer) { throw "Packaged launcher path is a directory: $Path" }
  if (-not [string]::Equals($item.Extension, ".exe", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Packaged launcher must be an .exe file: $Path"
  }
  if ($item.Length -lt 2) { throw "Packaged launcher is empty: $Path" }

  $stream = [IO.File]::OpenRead($item.FullName)
  try {
    $header = [byte[]]::new(2)
    if ($stream.Read($header, 0, 2) -ne 2 -or $header[0] -ne 0x4d -or $header[1] -ne 0x5a) {
      throw "Packaged launcher is not a Windows PE executable: $Path"
    }
  } finally {
    $stream.Dispose()
  }

  # A locally built package may be unsigned, but an attached invalid signature must never be
  # ignored.  NotSigned/UnknownError are reported as metadata and remain usable for development.
  $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
  if ([string]$signature.Status -eq "HashMismatch") {
    throw "Packaged launcher has an invalid Authenticode hash: $Path"
  }

  return $item
}

function Assert-ProviderExecutable {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Path,
    [ValidateSet("Installed", "Installer")][string]$Role = "Installed",
    [AllowEmptyString()][string]$ExpectedSha256,
    [switch]$RequireTrustedSignature,
    [switch]$AllowUnsignedDevelopmentBuild
  )

  $item = Test-PortableExecutable -Path $Path
  if ($Role -eq "Installed") {
    if (-not [string]::Equals($item.Name, $ProviderExecutableName, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Installed provider executable must be named '$ProviderExecutableName': $($item.FullName)"
    }
  } else {
    if ($item.Name -notmatch '^codex-web-gpt-opencodex-[A-Za-z0-9][A-Za-z0-9._-]*-win-x64\.exe$') {
      throw "Provider installer has an unexpected name: $($item.Name)"
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
    if ($ExpectedSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
      throw "Expected SHA-256 must contain exactly 64 hexadecimal characters."
    }
    $actual = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
    if (-not [string]::Equals($actual, $ExpectedSha256, [StringComparison]::OrdinalIgnoreCase)) {
      throw "SHA-256 verification failed for $($item.Name)."
    }
  } elseif ($RequireTrustedSignature) {
    $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
    if ([string]$signature.Status -ne "Valid" -and -not $AllowUnsignedDevelopmentBuild) {
      throw "Provider installer is not Authenticode-valid; provide a matching checksums file or explicitly use -AllowUnsignedDevelopmentBuild."
    }
  }
  return $item
}

function Resolve-ProviderExecutable {
  [CmdletBinding()]
  param([switch]$AllowMissing)

  $paths = Get-ProviderPaths
  $candidates = [System.Collections.Generic.List[string]]::new()
  try {
    $installLocation = [string](Get-ItemPropertyValue -LiteralPath $paths.InstallerRegistryKey `
      -Name "InstallLocation" -ErrorAction Stop)
    if (Test-AbsoluteWindowsPath -Path $installLocation) {
      [void]$candidates.Add((Join-Path $installLocation $ProviderExecutableName))
    }
  } catch {
    # The registry value is absent before the first install; use the deterministic NSIS default.
  }

  [void]$candidates.Add((Join-Path $paths.LocalAppData "Programs\$ProviderProductName\$ProviderExecutableName"))
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Assert-ProviderExecutable -Path $candidate -Role Installed).FullName
    }
  }
  if ($AllowMissing) { return $null }
  throw "Installed OpenCodex provider executable was not found. Run the install command first."
}

function Get-ProviderProcessRecords {
  [CmdletBinding()]
  param()

  $paths = Get-ProviderPaths
  $installed = Resolve-ProviderExecutable -AllowMissing
  $installedRoot = if ($installed) { [IO.Path]::GetDirectoryName($installed) } else { $null }
  $records = Get-CimInstance -ClassName Win32_Process -ErrorAction Stop
  $matches = [System.Collections.Generic.List[object]]::new()
  foreach ($record in $records) {
    $image = [string]$record.ExecutablePath
    $commandLine = [string]$record.CommandLine
    $isNamedProvider = [string]::Equals([string]$record.Name, $ProviderExecutableName, `
      [StringComparison]::OrdinalIgnoreCase)
    $knownImage = $false
    if ($installed -and $image) {
      $knownImage = [string]::Equals((Get-NormalizedPath -Path $image), `
        (Get-NormalizedPath -Path $installed), [StringComparison]::OrdinalIgnoreCase)
      if (-not $knownImage -and $installedRoot) {
        $knownImage = Test-PathUnderRoot -Path $image -Root $installedRoot
      }
    }
    if (-not $knownImage -and $image -and (Test-PathUnderRoot -Path $image -Root $paths.ProviderHome)) {
      # Bun, browser helpers, and Electron utility processes owned by this provider are all below
      # the provider's fixed core home.  Do not use a broad process-name match for them.
      $knownImage = $true
    }
    $knownCommand = $false
    if ($commandLine) {
      $knownCommand = $commandLine.IndexOf($paths.ProviderHome, [StringComparison]::OrdinalIgnoreCase) -ge 0 `
        -or $commandLine.IndexOf($paths.ProviderUserData, [StringComparison]::OrdinalIgnoreCase) -ge 0 `
        -or ($installed -and $commandLine.IndexOf($installed, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    }
    $isProvider = $knownImage -or $knownCommand -or $isNamedProvider
    if ($isProvider) {
      # Never return command lines: they are not needed by callers and could contain future
      # provider arguments.  PID/image/name are sufficient for a refusal or status message.
      [void]$matches.Add([pscustomobject]@{
          ProcessId = [int]$record.ProcessId
          Name = [string]$record.Name
          ExecutablePath = $image
          Verified = [bool]($knownImage -or $knownCommand)
        })
    }
  }
  return @($matches)
}

function Assert-NoProviderProcesses {
  [CmdletBinding()]
  param([string]$Operation = "the requested operation")

  try {
    $processes = @(Get-ProviderProcessRecords)
  } catch {
    throw "Refusing $Operation because provider process inspection failed: $($_.Exception.Message)"
  }
  if ($processes.Count -gt 0) {
    $pids = ($processes | ForEach-Object { $_.ProcessId } | Sort-Object -Unique) -join ","
    throw "Refusing $Operation while OpenCodex provider process(es) are running (pid $pids). Quit the provider and retry."
  }
}

function Get-ProviderStartArguments {
  [CmdletBinding()]
  param([switch]$Hidden)

  $arguments = [System.Collections.Generic.List[string]]::new()
  [void]$arguments.Add($ProviderArgument)
  if ($Hidden) { [void]$arguments.Add($HiddenArgument) }
  return @($arguments)
}

function New-ProviderProcessStartInfo {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ExecutablePath,
    [switch]$Hidden
  )

  $paths = Get-ProviderPaths
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $ExecutablePath
  $startInfo.WorkingDirectory = [IO.Path]::GetDirectoryName($ExecutablePath)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $false
  foreach ($argument in (Get-ProviderStartArguments -Hidden:$Hidden)) {
    [void]$startInfo.ArgumentList.Add($argument)
  }

  # Do not set a global CODEX_HOME (or any launcher override).  Remove inherited overrides from
  # this child and pin only the ordinary Windows home variables used by Node/Bun path resolution.
  $overrideNames = @(
    "CODEX_HOME", "CODEX_CHATGPT_WEB_HOME", "CODEX_WEB_GPT_LAUNCHER_DATA_DIR",
    "CODEX_WEB_GPT_DEV_HOME", "CODEX_CHATGPT_WEB_BUN", "CODEX_WEB_GPT_BUN"
  )
  foreach ($name in $overrideNames) {
    [void]$startInfo.Environment.Remove($name)
  }
  $startInfo.Environment["USERPROFILE"] = $paths.UserHome
  $startInfo.Environment["LOCALAPPDATA"] = $paths.LocalAppData
  $startInfo.Environment["HOME"] = $paths.UserHome
  return $startInfo
}

function Start-ProviderLauncher {
  [CmdletBinding()]
  param([switch]$Hidden)

  $executable = Resolve-ProviderExecutable
  $existing = @(Get-ProviderProcessRecords)
  if ($existing.Count -gt 0) {
    if (@($existing | Where-Object { $_.Verified -ne $true }).Count -gt 0) {
      throw "Refusing to start while an unverified process uses the provider executable name; inspect it before retrying."
    }
    return [pscustomobject]@{
      Status = "already-running"
      ProcessId = $existing[0].ProcessId
      Executable = $executable
      Host = $ProviderHost
      Port = $ProviderPort
    }
  }

  $startInfo = New-ProviderProcessStartInfo -ExecutablePath $executable -Hidden:$Hidden
  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw "Windows did not return a provider process handle." }
  Start-Sleep -Milliseconds 350
  if ($process.HasExited) {
    throw "OpenCodex provider exited immediately with code $($process.ExitCode)."
  }
  return [pscustomobject]@{
    Status = "started"
    ProcessId = $process.Id
    Executable = $executable
    Host = $ProviderHost
    Port = $ProviderPort
  }
}

function Get-ProviderHealth {
  [CmdletBinding()]
  param([ValidateRange(1, 30)][int]$TimeoutSeconds = 3)

  $paths = Get-ProviderPaths
  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $client = [Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
  try {
    $response = $client.GetAsync($paths.HealthUri).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      return [pscustomobject]@{ Status = "unhealthy"; HttpStatus = [int]$response.StatusCode; Uri = $paths.HealthUri }
    }
    try { $health = $body | ConvertFrom-Json -ErrorAction Stop } catch {
      return [pscustomobject]@{ Status = "unhealthy"; HttpStatus = [int]$response.StatusCode; Uri = $paths.HealthUri }
    }
    $healthValue = {
      param([string]$Name)
      $property = $health.PSObject.Properties[$Name]
      if ($null -eq $property) { return $null }
      return $property.Value
    }
    $healthHost = [string](& $healthValue "host")
    $healthPortValue = & $healthValue "port"
    $healthPort = if ($null -ne $healthPortValue) { [int]$healthPortValue } else { $null }
    $healthStatus = [string](& $healthValue "status")
    $healthService = [string](& $healthValue "service")
    $healthPurpose = [string](& $healthValue "purpose")
    $valid = $healthStatus -eq "ok" -and $healthService -eq $ProviderService `
      -and $healthPurpose -eq "opencodex-provider" `
      -and ([string]::IsNullOrEmpty($healthHost) -or $healthHost -eq $ProviderHost) `
      -and $healthPort -eq $ProviderPort
    $providerProcesses = @(Get-ProviderProcessRecords)
    $healthPidValue = & $healthValue "pid"
    $healthPid = if ($null -ne $healthPidValue) { [int]$healthPidValue } else { $null }
    # The ordinary launcher uses the same service name and port.  A health response is provider
    # health only when its PID is one of the exact provider-owned processes discovered from the
    # fixed executable/core-home/userData paths; this prevents a normal launcher from false-green.
    $matchingProviderProcesses = @($providerProcesses | Where-Object {
      $_.ProcessId -eq $healthPid
    })
    $pidMatchesProvider = $null -ne $healthPid -and $matchingProviderProcesses.Count -eq 1
    $valid = $valid -and $pidMatchesProvider
    # The current health contract does not include host, so an absent host is accepted above; the
    # request itself is always sent to the fixed loopback URI.
    [pscustomobject]@{
      Status = if ($valid) { "healthy" } else { "unhealthy" }
      HttpStatus = [int]$response.StatusCode
      Uri = $paths.HealthUri
      Service = $healthService
      Purpose = $healthPurpose
      RuntimeStatus = [string](& $healthValue "status")
      Version = [string](& $healthValue "version")
      Mode = [string](& $healthValue "mode")
      ProcessId = $healthPid
      Port = $healthPort
      AcceptingTurns = if ($null -ne (& $healthValue "accepting_turns")) { [bool](& $healthValue "accepting_turns") } else { $null }
      ActiveHttpTurns = if ($null -ne (& $healthValue "active_http_turns")) { [int](& $healthValue "active_http_turns") } else { $null }
      ActiveBrowserTurns = if ($null -ne (& $healthValue "active_browser_turns")) { [int](& $healthValue "active_browser_turns") } else { $null }
      ProviderProcessMatched = $pidMatchesProvider
    }
  } catch {
    # Do not echo response text or inherited environment values; the loopback URI and error class
    # are sufficient for an operator and cannot leak provider credentials.
    return [pscustomobject]@{ Status = "unreachable"; Uri = $paths.HealthUri; Error = $_.Exception.GetType().Name }
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

function Get-ChecksumForAsset {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$ChecksumsPath,
    [Parameter(Mandatory)][string]$AssetName
  )

  $lines = Get-Content -LiteralPath $ChecksumsPath -ErrorAction Stop
  $escapedAssetName = [regex]::Escape($AssetName)
  foreach ($line in $lines) {
    if ($line -match "^\s*([A-Fa-f0-9]{64})\s+\*?$escapedAssetName\s*$") {
      return $Matches[1]
    }
  }
  throw "Checksums file has no entry for $AssetName."
}

function Download-ProviderPackage {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Repository,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$ChecksumsDestination
  )

  if ($Version.StartsWith("v", [StringComparison]::OrdinalIgnoreCase)) { $Version = $Version.Substring(1) }
  if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "Invalid release version: $Version" }
  if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "Invalid GitHub repository: $Repository" }
  $assetName = "codex-web-gpt-opencodex-$Version-win-x64.exe"
  $baseUri = "https://github.com/$Repository/releases/download/v$Version"
  Invoke-WebRequest -Uri "$baseUri/$assetName" -OutFile $Destination -TimeoutSec 900 -MaximumRedirection 5
  Invoke-WebRequest -Uri "$baseUri/checksums.txt" -OutFile $ChecksumsDestination -TimeoutSec 60 -MaximumRedirection 5
  $expected = Get-ChecksumForAsset -ChecksumsPath $ChecksumsDestination -AssetName $assetName
  return [pscustomobject]@{ Path = $Destination; AssetName = $assetName; Sha256 = $expected }
}

function Install-ProviderLauncher {
  [CmdletBinding()]
  param(
    [AllowEmptyString()][string]$PackagePath,
    [AllowEmptyString()][string]$Version,
    [AllowEmptyString()][string]$Repository = "miuuyy/codex-chatgpt-web",
    [AllowEmptyString()][string]$ChecksumsPath,
    [switch]$AllowUnsignedDevelopmentBuild
  )

  Assert-NoProviderProcesses -Operation "installing or replacing the provider"
  if (-not [string]::IsNullOrWhiteSpace($PackagePath) -and -not [string]::IsNullOrWhiteSpace($Version)) {
    throw "Specify either PackagePath or Version, not both."
  }
  $temporaryFiles = [System.Collections.Generic.List[string]]::new()
  try {
    $package = $null
    $expectedSha = $null
    if (-not [string]::IsNullOrWhiteSpace($Version)) {
      $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "opencodex-provider-$([guid]::NewGuid().ToString('N'))"
      New-Item -ItemType Directory -LiteralPath $tempRoot -Force | Out-Null
      # Keep the release asset name on disk so the installer-name contract is checked before
      # electron-builder/NSIS ever runs.  A generic temporary filename would bypass that check.
      $assetName = "codex-web-gpt-opencodex-$($Version.TrimStart('v'))-win-x64.exe"
      $package = Join-Path $tempRoot $assetName
      $checksums = Join-Path $tempRoot "checksums.txt"
      [void]$temporaryFiles.Add($package)
      [void]$temporaryFiles.Add($checksums)
      $download = Download-ProviderPackage -Version $Version -Repository $Repository `
        -Destination $package -ChecksumsDestination $checksums
      $expectedSha = $download.Sha256
    } elseif (-not [string]::IsNullOrWhiteSpace($PackagePath)) {
      $package = if (Test-AbsoluteWindowsPath -Path $PackagePath) {
        Get-NormalizedPath -Path $PackagePath
      } else {
        (Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop).Path
      }
      if (-not [string]::IsNullOrWhiteSpace($ChecksumsPath)) {
        $expectedSha = Get-ChecksumForAsset -ChecksumsPath $ChecksumsPath `
          -AssetName ([IO.Path]::GetFileName($package))
      }
    } else {
      throw "Install requires PackagePath or Version."
    }
    if ([string]::IsNullOrWhiteSpace($expectedSha) -and -not $AllowUnsignedDevelopmentBuild) {
      # A local package must be independently authenticated.  Release downloads always populate
      # expectedSha from checksums.txt; unsigned local development packages require an explicit,
      # visible opt-in so a normal operator invocation cannot execute an arbitrary matching-name PE.
      [void](Assert-ProviderExecutable -Path $package -Role Installer -RequireTrustedSignature)
    } else {
      [void](Assert-ProviderExecutable -Path $package -Role Installer -ExpectedSha256 $expectedSha `
        -RequireTrustedSignature -AllowUnsignedDevelopmentBuild:$AllowUnsignedDevelopmentBuild)
    }
    $installer = Start-Process -FilePath $package -ArgumentList @("/S", "/currentuser") `
      -WorkingDirectory ([IO.Path]::GetDirectoryName($package)) -Wait -PassThru -WindowStyle Hidden
    if ($installer.ExitCode -ne 0) { throw "Provider installer exited with code $($installer.ExitCode)." }
    $installed = Resolve-ProviderExecutable
    [pscustomobject]@{
      Status = "installed"
      Executable = $installed
      ProviderHome = (Get-ProviderPaths).ProviderHome
      ProviderCodexHome = (Get-ProviderPaths).ProviderCodexHome
      ProviderUserData = (Get-ProviderPaths).ProviderUserData
      Host = $ProviderHost
      Port = $ProviderPort
    }
  } finally {
    foreach ($file in $temporaryFiles) {
      if (Test-Path -LiteralPath $file -PathType Leaf) {
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
      }
    }
    if ($temporaryFiles.Count -gt 0) {
      $tempRoot = [IO.Path]::GetDirectoryName($temporaryFiles[0])
      if (Test-Path -LiteralPath $tempRoot -PathType Container) {
        # Only remove the empty helper directory; never recursively delete a user path.
        try { [IO.Directory]::Delete($tempRoot, $false) } catch { }
      }
    }
  }
}

function Get-AutostartCommand {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$ExecutablePath)

  if ($ExecutablePath.IndexOf('"') -ge 0) { throw "Executable path contains an unsafe quote." }
  return "`"$ExecutablePath`" $ProviderArgument $HiddenArgument"
}

function Register-ProviderAutostart {
  [CmdletBinding()]
  param()

  $executable = Resolve-ProviderExecutable
  $command = Get-AutostartCommand -ExecutablePath $executable
  $existing = $null
  try { $existing = [string](Get-ItemPropertyValue -LiteralPath $AutostartKey -Name $AutostartValueName -ErrorAction Stop) } catch { }
  if ($existing -and -not [string]::Equals($existing, $command, [StringComparison]::Ordinal)) {
    throw "Autostart entry '$AutostartValueName' exists with different contents; refusing to overwrite it."
  }
  New-Item -Path $AutostartKey -Force | Out-Null
  New-ItemProperty -LiteralPath $AutostartKey -Name $AutostartValueName -Value $command `
    -PropertyType String -Force | Out-Null
  [pscustomobject]@{ Status = "registered"; RegistryKey = $AutostartKey; ValueName = $AutostartValueName }
}

function Unregister-ProviderAutostart {
  [CmdletBinding()]
  param()

  $executable = Resolve-ProviderExecutable -AllowMissing
  $expected = if ($executable) { Get-AutostartCommand -ExecutablePath $executable } else { $null }
  $existing = $null
  try { $existing = [string](Get-ItemPropertyValue -LiteralPath $AutostartKey -Name $AutostartValueName -ErrorAction Stop) } catch { }
  if (-not $existing) { return [pscustomobject]@{ Status = "not-registered"; RegistryKey = $AutostartKey; ValueName = $AutostartValueName } }
  if ($expected -and -not [string]::Equals($existing, $expected, [StringComparison]::Ordinal)) {
    throw "Autostart entry '$AutostartValueName' does not point to the fixed provider executable; refusing to remove it."
  }
  if (-not $expected -and $existing -notmatch '^\s*"[^"]+[\\/]Codex Web GPT OpenCodex\.exe"\s+--opencodex-provider\s+--hidden\s*$') {
    throw "Autostart entry '$AutostartValueName' is not recognized as the provider entry; refusing to remove it."
  }
  Remove-ItemProperty -LiteralPath $AutostartKey -Name $AutostartValueName -ErrorAction Stop
  [pscustomobject]@{ Status = "unregistered"; RegistryKey = $AutostartKey; ValueName = $AutostartValueName }
}

function Resolve-IdentitySid {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$IdentityReference)

  if ($IdentityReference -is [Security.Principal.SecurityIdentifier]) { return $IdentityReference.Value }
  try {
    return $IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  } catch {
    return [string]$IdentityReference.Value
  }
}

function Test-BroadFileSystemAce {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Rule)

  if ($Rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { return $false }
  $rights = [int64]$Rule.FileSystemRights
  foreach ($broad in @(
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.FileSystemRights]::Modify,
      [Security.AccessControl.FileSystemRights]::Write,
      [Security.AccessControl.FileSystemRights]::ReadAndExecute,
      [Security.AccessControl.FileSystemRights]::Read,
      [Security.AccessControl.FileSystemRights]::ListDirectory,
      [Security.AccessControl.FileSystemRights]::ReadData,
      [Security.AccessControl.FileSystemRights]::ExecuteFile
    )) {
    $mask = [int64]$broad
    if (($rights -band $mask) -eq $mask) { return $true }
  }
  return $false
}

function Test-ReadDisclosureAce {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Rule)

  if ($Rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { return $false }
  $rights = [int64]$Rule.FileSystemRights
  foreach ($readRight in @(
      [Security.AccessControl.FileSystemRights]::Read,
      [Security.AccessControl.FileSystemRights]::ReadAndExecute,
      [Security.AccessControl.FileSystemRights]::ReadData,
      [Security.AccessControl.FileSystemRights]::ListDirectory,
      [Security.AccessControl.FileSystemRights]::ExecuteFile,
      [Security.AccessControl.FileSystemRights]::ReadAttributes,
      [Security.AccessControl.FileSystemRights]::ReadExtendedAttributes,
      [Security.AccessControl.FileSystemRights]::ReadPermissions
    )) {
    $mask = [int64]$readRight
    if (($rights -band $mask) -eq $mask) { return $true }
  }
  return $false
}

function Get-AceKey {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Rule)

  return @(
    (Resolve-IdentitySid -IdentityReference $Rule.IdentityReference),
    [string]$Rule.AccessControlType,
    [int64]$Rule.FileSystemRights,
    [int]$Rule.InheritanceFlags,
    [int]$Rule.PropagationFlags
  ) -join "|"
}

function Get-PreservedAceKeys {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$Acl,
    [Parameter(Mandatory)][string]$RemovedGroupSid
  )

  $keys = [System.Collections.Generic.List[string]]::new()
  foreach ($rule in $Acl.Access) {
    if ((Resolve-IdentitySid -IdentityReference $rule.IdentityReference) -eq $RemovedGroupSid `
        -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow `
        -and (Test-BroadFileSystemAce -Rule $rule)) {
      continue
    }
    [void]$keys.Add((Get-AceKey -Rule $rule))
  }
  return @($keys | Sort-Object)
}

function New-AccessOnlyDirectoryAcl {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$SourceAcl,
    [string]$RemovedGroupSid,
    [switch]$Harden
  )

  $result = [Security.AccessControl.DirectorySecurity]::new()
  $result.SetSecurityDescriptorBinaryForm(
    $SourceAcl.GetSecurityDescriptorBinaryForm(),
    [Security.AccessControl.AccessControlSections]::Access
  )
  if ($Harden) {
    $targetSid = [Security.Principal.SecurityIdentifier]::new($RemovedGroupSid)
    $nonAllow = @($SourceAcl.Access | Where-Object {
        (Resolve-IdentitySid -IdentityReference $_.IdentityReference) -eq $RemovedGroupSid `
          -and $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow
      })
    if ($nonAllow.Count -gt 0) {
      throw "Target CodexSandboxUsers has non-Allow ACEs; refusing broad SID purge."
    }
    # Copy inherited entries to explicit entries before purging the one target SID. Using the raw
    # DACL preserves Chromium capability ACEs that carry generic rights not accepted by the
    # FileSystemAccessRule convenience constructor.
    $result.SetAccessRuleProtection($true, $true)
    $result.PurgeAccessRules($targetSid)
  }
  return $result
}

function Assert-PreservedSecurityPrincipals {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$BeforeAcl,
    [Parameter(Mandatory)]$AfterAcl,
    [Parameter(Mandatory)][string]$RemovedGroupSid
  )

  $before = @(Get-PreservedAceKeys -Acl $BeforeAcl -RemovedGroupSid $RemovedGroupSid)
  $after = @(Get-PreservedAceKeys -Acl $AfterAcl -RemovedGroupSid $RemovedGroupSid)
  $beforeCounts = @{}
  $afterCounts = @{}
  foreach ($key in $before) { $beforeCounts[$key] = 1 + [int]($beforeCounts[$key]) }
  foreach ($key in $after) { $afterCounts[$key] = 1 + [int]($afterCounts[$key]) }
  foreach ($key in $beforeCounts.Keys) {
    if (-not $afterCounts.ContainsKey($key) -or $afterCounts[$key] -lt $beforeCounts[$key]) {
      throw "ACL verification failed: a non-target security principal ACE was not preserved."
    }
  }

  # Keep an explicit check for the SIDs called out by the hardening contract.  This catches a
  # future refactor that accidentally filters the general preservation set too aggressively.
  $protectedPatterns = @("^S-1-5-18$", "^S-1-5-32-544$", "^S-1-15-3-")
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $protectedPatterns += "^$([regex]::Escape($currentSid))$"
  foreach ($pattern in $protectedPatterns) {
    $beforeCount = @($BeforeAcl.Access | Where-Object {
        (Resolve-IdentitySid -IdentityReference $_.IdentityReference) -match $pattern
      }).Count
    $afterCount = @($AfterAcl.Access | Where-Object {
        (Resolve-IdentitySid -IdentityReference $_.IdentityReference) -match $pattern
      }).Count
    if ($afterCount -lt $beforeCount) {
      throw "ACL verification failed: protected SID $pattern was changed."
    }
  }
}

function Resolve-LocalCodexSandboxUsersSid {
  [CmdletBinding()]
  param()

  $account = [Security.Principal.NTAccount]::new([Environment]::MachineName, "CodexSandboxUsers")
  try {
    return $account.Translate([Security.Principal.SecurityIdentifier]).Value
  } catch {
    throw "The local group '$([Environment]::MachineName)\CodexSandboxUsers' was not found; no ACL was changed."
  }
}

function Get-ProviderUserDataEntries {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Root)

  $entries = [System.Collections.Generic.List[object]]::new()
  $pending = [System.Collections.Generic.Stack[string]]::new()
  [void]$pending.Push($Root)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      # Following a junction/symlink would make a fixed userData target point outside the
      # provider profile.  Refuse the audit rather than silently skipping the object.
      throw "Refusing ACL audit through a reparse-point descendant: $($item.FullName)"
    }
    [void]$entries.Add($item)
    if ($item.PSIsContainer) {
      foreach ($child in (Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop)) {
        [void]$pending.Push($child.FullName)
      }
    }
  }
  return @($entries)
}

function Get-TargetAllowReadAces {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]$Acl,
    [Parameter(Mandatory)][string]$GroupSid
  )

  return @($Acl.Access | Where-Object {
      (Resolve-IdentitySid -IdentityReference $_.IdentityReference) -eq $GroupSid `
        -and (Test-ReadDisclosureAce -Rule $_)
    })
}

function Assert-ProviderUserDataDescendantAudit {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][object[]]$Entries,
    [Parameter(Mandatory)][string]$GroupSid,
    [Parameter(Mandatory)][hashtable]$BeforeAcls
  )

  foreach ($entry in $Entries) {
    $afterAcl = Get-Acl -LiteralPath $entry.FullName -ErrorAction Stop
    $remaining = @(Get-TargetAllowReadAces -Acl $afterAcl -GroupSid $GroupSid)
    if ($remaining.Count -gt 0) {
      throw "ACL verification failed: CodexSandboxUsers still has read/execute access under provider userData ($($entry.FullName))."
    }
    if ($BeforeAcls.ContainsKey($entry.FullName)) {
      Assert-PreservedSecurityPrincipals -BeforeAcl $BeforeAcls[$entry.FullName] `
        -AfterAcl $afterAcl -RemovedGroupSid $GroupSid
    }
  }
}

function Harden-ProviderUserDataAcl {
  [CmdletBinding()]
  param()

  $paths = Get-ProviderPaths
  $target = Get-Item -LiteralPath $paths.ProviderUserData -Force -ErrorAction Stop
  if (-not $target.PSIsContainer) { throw "Provider userData is not a directory: $($target.FullName)" }
  if (($target.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing ACL hardening on a reparse-point userData directory: $($target.FullName)"
  }

  # This is intentionally a fail-closed process check.  Runtime children include Bun and browser
  # helpers, so checking only the visible Electron process would permit a live writer to continue.
  Assert-NoProviderProcesses -Operation "hardening provider userData ACLs"
  $groupSid = Resolve-LocalCodexSandboxUsersSid
  $entries = @(Get-ProviderUserDataEntries -Root $target.FullName)
  $beforeAcls = @{}
  foreach ($entry in $entries) {
    $beforeAcls[$entry.FullName] = Get-Acl -LiteralPath $entry.FullName -ErrorAction Stop
  }
  $acl = $beforeAcls[$target.FullName]
  $markerPath = Join-Path $paths.ProviderHome "acl-hardening-v1.json"
  $alreadyMarked = Test-Path -LiteralPath $markerPath -PathType Leaf
  $targetRules = @($acl.Access | Where-Object {
      (Resolve-IdentitySid -IdentityReference $_.IdentityReference) -eq $groupSid `
        -and $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow `
        -and (Test-BroadFileSystemAce -Rule $_)
    })
  if ($alreadyMarked) {
    $remainingBroad = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in $entries) {
      $entryAcl = $beforeAcls[$entry.FullName]
      if (@($entryAcl.Access | Where-Object {
          (Resolve-IdentitySid -IdentityReference $_.IdentityReference) -eq $groupSid `
            -and (Test-BroadFileSystemAce -Rule $_)
        }).Count -gt 0) {
        [void]$remainingBroad.Add($entry.FullName)
      }
    }
    if ($remainingBroad.Count -eq 0) {
      return [pscustomobject]@{ Status = "already-hardened"; Target = $target.FullName; RemovedAces = 0; EntriesAudited = $entries.Count }
    }
    throw "ACL hardening marker exists but a target CodexSandboxUsers broad ACE is present again under provider userData; refusing a second mutation."
  }
  $protectInheritance = @($targetRules | Where-Object { $_.IsInherited }).Count -gt 0
  foreach ($entry in $entries) {
    if ([string]::Equals($entry.FullName, $target.FullName, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $childAcl = $beforeAcls[$entry.FullName]
    $childTargetAces = @($childAcl.Access | Where-Object {
        (Resolve-IdentitySid -IdentityReference $_.IdentityReference) -eq $groupSid `
          -and (Test-BroadFileSystemAce -Rule $_)
      })
    if ($childTargetAces | Where-Object { -not $_.IsInherited }) {
      throw "A descendant has an explicit CodexSandboxUsers broad ACE; refusing root-only hardening ($($entry.FullName))."
    }
  }
  if ($targetRules.Count -eq 0) {
    throw "No explicit broad Allow ACE for the local CodexSandboxUsers group was found; no ACL was changed."
  }

  $providerHome = Get-Item -LiteralPath $paths.ProviderHome -Force -ErrorAction SilentlyContinue
  if ($null -eq $providerHome) { New-Item -ItemType Directory -LiteralPath $paths.ProviderHome -Force | Out-Null }
  $providerHome = Get-Item -LiteralPath $paths.ProviderHome -Force -ErrorAction Stop
  if (($providerHome.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to write ACL backup through a reparse-point provider home: $($providerHome.FullName)"
  }
  $backupPath = Join-Path $paths.ProviderHome "acl-backup-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')).sddl"
  [IO.File]::WriteAllText($backupPath, [string]$acl.Sddl, [Text.UTF8Encoding]::new($false))
  $originalAcl = $beforeAcls[$target.FullName]
  try {
    $hardenedAcl = New-AccessOnlyDirectoryAcl -SourceAcl $acl -RemovedGroupSid $groupSid -Harden
    [IO.FileSystemAclExtensions]::SetAccessControl(
      [IO.DirectoryInfo]::new($target.FullName),
      $hardenedAcl
    )
    $afterAcl = Get-Acl -LiteralPath $target.FullName -ErrorAction Stop
    Assert-PreservedSecurityPrincipals -BeforeAcl $originalAcl -AfterAcl $afterAcl -RemovedGroupSid $groupSid
    Assert-ProviderUserDataDescendantAudit -Entries $entries -GroupSid $groupSid -BeforeAcls $beforeAcls
    $marker = [ordered]@{
      schemaVersion = 1
      target = $target.FullName
      groupSid = $groupSid
      removedAces = $targetRules.Count
      entriesAudited = $entries.Count
      inheritanceProtected = $protectInheritance
      backup = $backupPath
      appliedAtUtc = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json -Depth 3
    [IO.File]::WriteAllText($markerPath, $marker, [Text.UTF8Encoding]::new($false))
  } catch {
    $hardeningError = $_.Exception.Message
    try {
      $rollbackAcl = New-AccessOnlyDirectoryAcl -SourceAcl $originalAcl
      [IO.FileSystemAclExtensions]::SetAccessControl(
        [IO.DirectoryInfo]::new($target.FullName),
        $rollbackAcl
      )
    } catch {
      $rollbackError = $_.Exception.Message
      throw "ACL hardening failed and rollback also failed: $hardeningError; rollback: $rollbackError"
    }
    throw
  }
  [pscustomobject]@{ Status = "hardened"; Target = $target.FullName; RemovedAces = $targetRules.Count; Backup = $backupPath }
}

Export-ModuleMember -Function @(
  "Get-ProviderPaths", "Test-PortableExecutable", "Assert-ProviderExecutable",
  "Resolve-ProviderExecutable", "Get-ProviderProcessRecords", "Get-ProviderStartArguments",
  "Start-ProviderLauncher", "Get-ProviderHealth", "Install-ProviderLauncher",
  "Register-ProviderAutostart", "Unregister-ProviderAutostart", "Harden-ProviderUserDataAcl",
  "Test-BroadFileSystemAce"
)
