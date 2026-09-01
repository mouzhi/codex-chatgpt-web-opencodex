#requires -Version 7.0

Describe "OpenCodexProviderLauncher contract" {
  BeforeAll {
    Import-Module (Join-Path $PSScriptRoot "OpenCodexProviderLauncher.psm1") -Force
  }

  It "exposes the fixed provider homes and endpoint" {
    $paths = Get-ProviderPaths
    $paths.ProviderHome | Should Be (Join-Path $paths.UserHome ".codex-chatgpt-web-opencodex")
    $paths.ProviderCodexHome | Should Be (Join-Path $paths.UserHome ".codex-opencodex-web-bridge")
    $paths.ProviderUserData | Should Be (Join-Path $paths.LocalAppData "Codex Web GPT OpenCodex")
    $paths.ProviderHost | Should Be "127.0.0.1"
    $paths.ProviderPort | Should Be 17841
  }

  It "uses profile-only startup arguments and no credential-shaped arguments" {
    @(Get-ProviderStartArguments) | Should Be @("--opencodex-provider")
    @(Get-ProviderStartArguments -Hidden) | Should Be @("--opencodex-provider", "--hidden")
    $joined = @(Get-ProviderStartArguments -Hidden) -join " "
    $joined | Should Not Match "(?i)(token|api[-_]?key|cookie|secret|CODEX_HOME)"
  }

  It "recognizes only broad Allow ACEs for ACL hardening" {
    $allowModify = [Security.AccessControl.FileSystemAccessRule]::new(
      "Everyone", [Security.AccessControl.FileSystemRights]::Modify,
      [Security.AccessControl.InheritanceFlags]::ContainerInherit,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow)
    $allowRead = [Security.AccessControl.FileSystemAccessRule]::new(
      "Everyone", [Security.AccessControl.FileSystemRights]::Read,
      [Security.AccessControl.InheritanceFlags]::None,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow)
    $denyModify = [Security.AccessControl.FileSystemAccessRule]::new(
      "Everyone", [Security.AccessControl.FileSystemRights]::Modify,
      [Security.AccessControl.InheritanceFlags]::None,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Deny)
    Test-BroadFileSystemAce -Rule $allowModify | Should Be $true
    Test-BroadFileSystemAce -Rule $allowRead | Should Be $true
    Test-BroadFileSystemAce -Rule $denyModify | Should Be $false
  }
}
