const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OPENCODEX_PROVIDER_PROFILE,
  PRODUCTION_PROFILE,
} = require("../electron/profile.cjs");
const {
  autostartArguments,
  getAutostart,
  linuxDesktopEntry,
  setAutostart,
} = require("../electron/autostart.cjs");

test("default launcher autostart remains hidden-only", () => {
  assert.deepEqual(autostartArguments(PRODUCTION_PROFILE), ["--hidden"]);
  const entry = linuxDesktopEntry(
    { getPath: () => "/tmp/transient-electron" },
    "/home/example/Applications/Codex Web GPT.AppImage",
    PRODUCTION_PROFILE,
  );
  assert.match(entry, /^Exec="\/home\/example\/Applications\/Codex Web GPT\.AppImage" --hidden$/m);
});

test("OpenCodex provider autostart keeps its profile flag with hidden startup", () => {
  assert.deepEqual(
    autostartArguments(OPENCODEX_PROVIDER_PROFILE),
    ["--opencodex-provider", "--hidden"],
  );
  const entry = linuxDesktopEntry(
    { getPath: () => "/tmp/transient-electron" },
    "/home/example/Applications/Codex Web GPT.AppImage",
    { kind: OPENCODEX_PROVIDER_PROFILE },
  );
  assert.match(
    entry,
    /^Exec="\/home\/example\/Applications\/Codex Web GPT\.AppImage" --opencodex-provider --hidden$/m,
  );
});

test("Windows OpenCodex provider autostart passes both profile and hidden flags to login items", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  try {
    const calls = [];
    const app = {
      isPackaged: true,
      setLoginItemSettings(settings) { calls.push(["set", settings]); },
      getLoginItemSettings(options) {
        calls.push(["get", options]);
        return { openAtLogin: true };
      },
    };

    assert.deepEqual(
      setAutostart(app, true, OPENCODEX_PROVIDER_PROFILE),
      { supported: true, enabled: true },
    );
    assert.deepEqual(getAutostart(app, { kind: OPENCODEX_PROVIDER_PROFILE }), {
      supported: true,
      enabled: true,
    });
    assert.deepEqual(calls, [
      ["set", {
        openAtLogin: true,
        openAsHidden: true,
        args: ["--opencodex-provider", "--hidden"],
      }],
      ["get", { args: ["--opencodex-provider", "--hidden"] }],
      ["get", { args: ["--opencodex-provider", "--hidden"] }],
    ]);
  } finally {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});
