#requires -Version 7.0

<#
.SYNOPSIS
  Safely operate the packaged Codex Web GPT OpenCodex provider launcher on Windows.

.EXAMPLE
  pwsh -File .\OpenCodexProviderLauncher.ps1 -Command install -PackagePath .\codex-web-gpt-opencodex-4.0.5-win-x64.exe

.EXAMPLE
  pwsh -File .\OpenCodexProviderLauncher.ps1 -Command health

.EXAMPLE
  pwsh -File .\OpenCodexProviderLauncher.ps1 -Command harden-acl
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("install", "start", "health", "register", "unregister", "harden-acl", "hardenAcl", "acl")]
  [string]$Command = "health",
  [AllowEmptyString()][string]$PackagePath,
  [AllowEmptyString()][string]$Version,
  [AllowEmptyString()][string]$Repository = "miuuyy/codex-chatgpt-web",
  [AllowEmptyString()][string]$ChecksumsPath,
  [switch]$AllowUnsignedDevelopmentBuild,
  [ValidateRange(1, 30)][int]$TimeoutSeconds = 3,
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$modulePath = Join-Path $PSScriptRoot "OpenCodexProviderLauncher.psm1"
Import-Module -Name $modulePath -Force

function Write-OperationalResult {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Value)

  if ($Json) {
    $Value | ConvertTo-Json -Depth 8 -Compress
  } else {
    $Value | Format-List | Out-String -Width 240 | Write-Output
  }
}

try {
  $result = switch ($Command.ToLowerInvariant()) {
    "install" {
      Install-ProviderLauncher -PackagePath $PackagePath -Version $Version -Repository $Repository `
        -ChecksumsPath $ChecksumsPath -AllowUnsignedDevelopmentBuild:$AllowUnsignedDevelopmentBuild
      break
    }
    "start" {
      Start-ProviderLauncher
      break
    }
    "health" {
      Get-ProviderHealth -TimeoutSeconds $TimeoutSeconds
      break
    }
    "register" {
      Register-ProviderAutostart
      break
    }
    "unregister" {
      Unregister-ProviderAutostart
      break
    }
    "harden-acl" { Harden-ProviderUserDataAcl; break }
    "hardenacl" { Harden-ProviderUserDataAcl; break }
    "acl" { Harden-ProviderUserDataAcl; break }
    default { throw "Unsupported operation: $Command" }
  }
  Write-OperationalResult -Value $result
  if ($Command.ToLowerInvariant() -eq "health" -and $result.Status -notin @("healthy")) { exit 2 }
  exit 0
} catch {
  # Error records are intentionally concise.  Never print process command lines, environment
  # variables, control tokens, or response bodies.
  Write-Error $_.Exception.Message
  exit 1
}
