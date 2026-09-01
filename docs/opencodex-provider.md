# OpenCodex provider launcher

The Windows OpenCodex provider launcher runs ChatGPT Web as one isolated downstream provider. It
does not own or modify the native Codex route:

```text
Codex / CodexHost
  -> OpenCodex 127.0.0.1:10100
  -> codex-with-chatgpt provider
  -> Codex Web GPT OpenCodex 127.0.0.1:17841
  -> ChatGPT Web
```

## Fixed ownership

The packaged entry point always adds `--opencodex-provider` and uses these paths:

| State | Windows path |
|---|---|
| Provider configuration and managed runtime | `%USERPROFILE%\.codex-chatgpt-web-opencodex` |
| Isolated Codex home used only by setup compatibility | `%USERPROFILE%\.codex-opencodex-web-bridge` |
| Electron login profile | `%LOCALAPPDATA%\Codex Web GPT OpenCodex` |
| Responses endpoint | `http://127.0.0.1:17841/v1` |

Provider configuration is persisted with `purpose: "opencodex-provider"`. The daemon exposes that
purpose in `/healthz`; management scripts must reject a listener that does not report it. Provider
mode never installs, connects, restores, or monitors the native Codex `openai_base_url` route.

This profile is deliberately **Automatic-only**. V5's Zero Risk manual paste/send mode cannot
serve an OpenCodex request, so the provider launcher rejects it instead of silently changing the
turn contract. The provider catalog is also pinned to Compatibility V1 and advertises a 900K
aggregate context/compaction window for every available `chatgpt-web/*` row. Browser-stage payload
limits remain independently enforced by the adapter; the advertised 900K boundary prevents the
outer client from compacting a long task between those stages.

Port 17841 is also the normal launcher's default. The normal launcher and OpenCodex provider
launcher are therefore mutually exclusive on one Windows account unless one of them is assigned a
different port in a future design. A port conflict must fail without stopping the incumbent.

## Build and install

Use Bun 1.4.0. Keep its directory first in the current user's `Path`; back up the previous user
`Path` before changing it. Do not set `CODEX_HOME` globally.

```powershell
bun --version
bun run --cwd launcher package:win:opencodex
```

The artifact is written under `launcher/artifacts/` and has a distinct app ID, product name, NSIS
GUID, executable, shortcuts, and uninstall identity. The installed launcher copies the pinned Bun
runtime into its provider home and supervises the Responses daemon and optional tunnel.

The user login item must invoke:

```text
Codex Web GPT OpenCodex.exe --opencodex-provider --hidden
```

Closing the window can keep the launcher in the system tray. Quitting the tray application stops
the supervised Responses daemon; an unexpected daemon exit is restarted with a bounded retry
budget.

## OpenCodex provider

Register a static `openai-responses` provider pointing to `http://127.0.0.1:17841/v1` with:

- `authMode: "local"` and no API key;
- `allowPrivateNetwork: true` for this exact loopback provider;
- `liveModels: false`;
- only account-available `chatgpt-web/*` models;
- no change to the existing default provider.

Provider-only `/v1/models` contains only owned Web routes. Native model requests, native
compaction, and native search fail closed instead of forwarding a caller's OpenAI bearer token.

## Full MCP configuration

Full mode uses the existing secure config contract:

```json
{
  "mode": "full",
  "tunnel": {
    "tunnelId": "tunnel_<32 lowercase hex characters>",
    "runtimeKeyFile": "C:\\...\\secrets\\tunnel-runtime.key",
    "profileName": "codex-chatgpt-web-opencodex",
    "alias": "codex-chatgpt-web-opencodex"
  }
}
```

The runtime API key is written once to the private key file. Never put its value in `config.json`,
process arguments, environment variables, diagnostic exports, or operator logs. The launcher MCP
setup UI performs this import and reuses the stored file after restart. The ChatGPT connector must
use the exact connector name displayed by the launcher and allow the required actions; the outer
Codex harness still owns sandbox and approval decisions.

## Operations and validation

The helper under `tools/opencodex-provider-launcher/` supports install, start, health, login-item
registration, and opt-in ACL hardening. Local unsigned development installers require an explicit
development override plus a verified SHA-256 supplied by the operator.

Minimum acceptance after install or update:

1. `/healthz` reports `service=codex-chatgpt-web`, `purpose=opencodex-provider`, the expected mode,
   PID, port 17841, and `accepting_turns=true`.
2. Provider doctor reports authenticated launcher browser, private key storage, healthy Responses
   proxy, and healthy/ready tunnel in Full mode.
3. The native Codex route still points to OpenCodex, and the OpenCodex default provider is
   unchanged.
4. A real `codex exec` request routes to the OpenCodex provider; Full mode must execute a harmless
   local tool and return its result.
5. OpenCodex usage identifies the requested routed model, native `chatgpt-web/*` model, provider,
   and HTTP 200.
6. Restart the packaged launcher with `--hidden` and prove the ChatGPT login, tunnel, connector,
   and real tool call survive without another login or credential import.

Removing the OpenCodex provider does not delete the Electron login profile or tunnel key. Browser
state and credentials are removed only through a separate, explicit cleanup operation.
