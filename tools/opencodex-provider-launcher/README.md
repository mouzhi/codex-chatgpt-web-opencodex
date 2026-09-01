# OpenCodex provider launcher operations (Windows)

`OpenCodexProviderLauncher.ps1` is a PowerShell 7 helper for the packaged **Codex Web GPT OpenCodex** Windows application. It is deliberately separate from the application and does not configure the native Codex installation.

The helper has one fixed provider contract; there are no switches for changing these locations or the port:

| Item | Fixed value |
| --- | --- |
| Provider core home | `%USERPROFILE%\.codex-chatgpt-web-opencodex` |
| Provider bridge home | `%USERPROFILE%\.codex-opencodex-web-bridge` |
| Electron `userData` | `%LOCALAPPDATA%\Codex Web GPT OpenCodex` |
| Runtime endpoint | `127.0.0.1:17841` |
| Health endpoint | `http://127.0.0.1:17841/healthz` |
| Profile argument | `--opencodex-provider` |

Run from PowerShell 7 (`pwsh`) on Windows. The script does not set a global `CODEX_HOME` variable. When starting the child process it removes inherited launcher override variables, then pins ordinary `USERPROFILE`/`LOCALAPPDATA` resolution to the current Windows user. No control token, API key, cookie, or credential is accepted as an argument or written to output.

## Commands

Install a release installer (the asset is SHA-256 checked against the release `checksums.txt`):

```powershell
pwsh -File .\OpenCodexProviderLauncher.ps1 -Command install -Version 4.0.5
```

Or install a local release asset. A local package must either have a matching `-ChecksumsPath` entry or a trusted Authenticode signature. An unsigned local development build is accepted only with the explicit `-AllowUnsignedDevelopmentBuild` switch:

```powershell
pwsh -File .\OpenCodexProviderLauncher.ps1 `
  -Command install `
  -PackagePath .\codex-web-gpt-opencodex-4.0.5-win-x64.exe `
  -ChecksumsPath .\checksums.txt
```

```powershell
pwsh -File .\OpenCodexProviderLauncher.ps1 -Command install `
  -PackagePath .\codex-web-gpt-opencodex-4.0.5-win-x64.exe `
  -AllowUnsignedDevelopmentBuild
```

The installer is validated as a PE `.exe`, its provider-specific artifact name is checked, and `/S /currentuser` are the only installer arguments. The installed executable must be named `Codex Web GPT OpenCodex.exe`. Installation refuses to replace a running provider.

Start the installed provider (the packaged entrypoint also enforces the profile flag):

```powershell
pwsh -File .\OpenCodexProviderLauncher.ps1 -Command start
```

Probe only the fixed loopback health endpoint. `health` returns a non-zero exit code when the endpoint is unreachable or does not identify itself as `purpose: opencodex-provider`; it also cross-checks the reported PID against the fixed provider executable/core-home paths. `-Json` emits only bounded health fields:

```powershell
pwsh -File .\OpenCodexProviderLauncher.ps1 -Command health -Json
```

Register or unregister per-user autostart. The helper uses only the HKCU `Run` value named `Codex Web GPT OpenCodex` and writes the fixed executable plus `--opencodex-provider --hidden`. Unregister refuses to remove a value that does not exactly point at this provider.

```powershell
pwsh -File .\OpenCodexProviderLauncher.ps1 -Command register
pwsh -File .\OpenCodexProviderLauncher.ps1 -Command unregister
```

## Optional one-time ACL hardening

`harden-acl` is opt-in and should be run only after reviewing the current user-data ACL. It targets exactly `%LOCALAPPDATA%\Codex Web GPT OpenCodex` and does the following:

1. Refuses if the provider Electron process, Bun runtime, browser helper, or another provider child is running. Process inspection is fail-closed.
2. Refuses reparse-point user-data directories. When the target ACE comes from the parent, it protects the profile root and copies all inherited ACEs to explicit equivalents before removing only the target group; this prevents the parent from reintroducing it.
3. Resolves the **local** `COMPUTERNAME\CodexSandboxUsers` SID and removes only its `Allow` ACE when that ACE can disclose profile data (`Read`, `ReadAndExecute`, `Modify`, `Write`, or `FullControl`). It does not replace the DACL, remove files, or recursively delete anything.
4. Audits every non-reparse descendant before changing the DACL. An explicit descendant `CodexSandboxUsers` read/execute ACE is a preflight refusal; descendants are never rewritten.
5. Writes an SDDL backup under the fixed provider home before changing the root DACL.
6. Verifies that every other root and descendant ACE is preserved, including the current user, `SYSTEM`, built-in `Administrators`, and AppContainer capability SIDs (`S-1-15-3-*`). It then re-audits every descendant for any remaining target Allow read/execute ACE. A failed verification attempts to restore the original root ACL and does not write the marker.
7. Writes `acl-hardening-v1.json` only after verification. A subsequent run is a no-op when the target ACE is absent; if the ACE reappears, the marker causes a fail-closed refusal rather than a second unreviewed mutation.

```powershell
pwsh -File .\OpenCodexProviderLauncher.ps1 -Command harden-acl -Json
```

The operation never removes the user-data directory or its contents. Stop the provider normally and capture a backup before running it.
