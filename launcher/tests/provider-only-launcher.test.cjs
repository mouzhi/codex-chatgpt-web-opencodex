const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEVELOPMENT_PROFILE,
  OPENCODEX_PROVIDER_PROFILE,
  PRODUCTION_PROFILE,
  launcherProfileOwnsCodexRoute,
  launcherRuntimeProfile,
} = require("../electron/profile.cjs");
const {
  OPENCODEX_PROVIDER_CONFIG_PURPOSE,
  OPENCODEX_PROVIDER_RUNTIME_HOST,
  OPENCODEX_PROVIDER_RUNTIME_PORT,
  validateConfig,
} = require("../electron/runtime-supervisor.cjs");
const { RuntimeHost } = require("../electron/runtime.cjs");

function providerConfig(overrides = {}) {
  const descriptorPath = process.platform === "win32"
    ? "C:\\runtime\\launcher-browser.json"
    : "/tmp/runtime/launcher-browser.json";
  return {
    version: 3,
    purpose: OPENCODEX_PROVIDER_CONFIG_PURPOSE,
    releaseVersion: "1.2.3",
    mode: "browser-only",
    host: OPENCODEX_PROVIDER_RUNTIME_HOST,
    port: OPENCODEX_PROVIDER_RUNTIME_PORT,
    contextWindow: 256_000,
    appName: "OpenCodex Provider",
    browserHost: "launcher",
    browserHostDescriptorPath: descriptorPath,
    chromeExecutablePath: process.execPath,
    storageStatePath: path.join(os.tmpdir(), "provider-storage-state.json"),
    brokerSocketPath: process.platform === "win32"
      ? "\\\\.\\pipe\\opencodex-provider-test"
      : path.join(os.tmpdir(), "opencodex-provider-test.sock"),
    headed: true,
    solAvailable: true,
    proAvailable: false,
    autoApproveToolCalls: false,
    controlToken: "provider-only-control-token-0123456789abcdef",
    runtimeCommand: [process.execPath],
    ...overrides,
  };
}

function providerHost(existingConfig = null, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-provider-host-"));
  const app = {
    isPackaged: false,
    getPath: () => root,
    getVersion: () => "1.2.3",
  };
  const supervisor = {
    configPath: path.join(root, "config.json"),
    coreHome: root,
    readConfig: () => existingConfig,
    readSetupConfig: () => existingConfig,
    stopForSetup: async () => ({ status: "stopped" }),
    startIfConfigured: async () => ({ status: "ready" }),
  };
  const host = new RuntimeHost({
    app,
    logger: { info() {}, warn() {}, error() {} },
    sourceRoot: root,
    browserDescriptorPath: path.join(root, "launcher-browser.json"),
    coreHome: root,
    codexHome: path.join(root, "codex-home"),
    launcherProfile: "production",
    providerOnly: true,
    supervisor,
    ...options,
  });
  let invocation;
  host.runSetup = async (name, args) => {
    invocation = { name, args };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { host, invocation: () => invocation, root };
}

test("optional provider Zero Risk uses manual setup without native route ownership", async () => {
  const fixture = providerHost(providerConfig({ mode: "full", browserInteractionMode: "manual" }),
    { getBrowserInteractionMode: () => "manual" });
  try {
    assert.equal(fixture.host.browserInteractionMode(), "manual");
    assert.deepEqual(fixture.host.browserInteractionArgs({refreshCapabilities: true}), ["--zero-risk-browser-interaction"]);
    assert.equal(fixture.host.mcpCredentialsConfigured("manual"), false);
    await fixture.host.setZeroRiskPro(true);
    const args = fixture.invocation().args;
    assert.ok(args.includes("--provider-only"));
    assert.ok(args.includes("--zero-risk-pro"));
    assert.ok(!args.includes("--replace-codex-route"));
    assert.ok(!args.includes("--refresh-account-capabilities"));
    assert.throws(() => fixture.host.setupMcp({interactionMode: "manual"}), /Tunnel ID/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("provider-only runtime validation accepts only its explicit purpose and fixed endpoint", () => {
  const config = providerConfig();
  const descriptorPath = config.browserHostDescriptorPath;
  assert.equal(
    validateConfig(config, descriptorPath, process.platform, "production", true).purpose,
    OPENCODEX_PROVIDER_CONFIG_PURPOSE,
  );
  assert.throws(
    () => validateConfig(config, descriptorPath, process.platform, "production"),
    /Production launcher refuses/,
  );
  assert.throws(
    () => validateConfig({ ...config, port: OPENCODEX_PROVIDER_RUNTIME_PORT + 1 }, descriptorPath, process.platform, "production", true),
    /must listen on 127\.0\.0\.1:17841/,
  );
});

test("provider-only setup accepts a fixed-endpoint legacy config only for one-time migration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-provider-migration-"));
  const descriptorPath = path.join(root, "launcher-browser.json");
  const configPath = path.join(root, "config.json");
  const legacy = providerConfig({ purpose: undefined, browserHostDescriptorPath: descriptorPath });
  fs.writeFileSync(configPath, `${JSON.stringify(legacy)}\n`);
  const supervisor = new (require("../electron/runtime-supervisor.cjs").RuntimeSupervisor)({
    app: { getVersion: () => "1.2.3", isPackaged: false },
    logger: { info() {}, warn() {}, error() {} },
    sourceRoot: root,
    coreHome: root,
    browserDescriptorPath: descriptorPath,
    launcherProfile: "production",
    providerOnly: true,
  });
  try {
    assert.equal(supervisor.readSetupConfig().purpose, undefined);
    assert.throws(() => supervisor.readConfig(), /without the provider purpose/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("provider-only launcher startup skips Codex route mutation and catalog monitoring", () => {
  assert.equal(launcherProfileOwnsCodexRoute(OPENCODEX_PROVIDER_PROFILE), false);
  assert.equal(launcherProfileOwnsCodexRoute(DEVELOPMENT_PROFILE), false);
  assert.equal(launcherProfileOwnsCodexRoute(PRODUCTION_PROFILE), true);
  assert.equal(launcherRuntimeProfile(OPENCODEX_PROVIDER_PROFILE), PRODUCTION_PROFILE);
  assert.equal(launcherRuntimeProfile(DEVELOPMENT_PROFILE), DEVELOPMENT_PROFILE);
});

test("provider-only setup transactions use the fixed provider endpoint without --replace-codex-route", async () => {
  const fixture = providerHost(null);
  const core = await fixture.host.setupCore();
  assert.equal(core.mode, "browser-only");
  assert.equal(fixture.invocation().args.includes("--provider-only"), true);
  assert.deepEqual(
    fixture.invocation().args.slice(fixture.invocation().args.indexOf("--provider-only"), fixture.invocation().args.indexOf("--provider-only") + 3),
    ["--provider-only", "--port", "17841"],
  );
  assert.equal(fixture.invocation().args.includes("--replace-codex-route"), false);

  const full = providerConfig({
    mode: "full",
    appName: "OpenCodex Provider",
    tunnel: {
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      runtimeKeyFile: path.join(fixture.root, "existing-runtime.key"),
      binaryPath: process.execPath,
      profileDir: fixture.root,
      profileName: "provider",
      alias: "provider",
    },
  });
  fs.writeFileSync(full.tunnel.runtimeKeyFile, "existing-provider-key\n", { mode: 0o600 });
  const mcpFixture = providerHost(full);
  await mcpFixture.host.setupMcp({ replace: false });
  assert.equal(mcpFixture.invocation().args.includes("--provider-only"), true);
  assert.equal(mcpFixture.invocation().args.includes("--replace-codex-route"), false);
  assert.equal(mcpFixture.invocation().args.includes("--port"), true);
  assert.equal(mcpFixture.invocation().args.includes("17841"), true);
});

test("provider-only packaged upgrades preserve the fixed endpoint without a Codex route", async () => {
  const config = providerConfig({
    browserHost: "launcher",
    releaseVersion: "1.2.2",
    runtimeCommand: ["C:\\source\\bun.exe", "C:\\source\\src\\cli.ts"],
  });
  const fixture = providerHost(config);
  fixture.host.app.isPackaged = true;
  fixture.host.command = () => ({
    executable: "C:\\runtime\\bun.exe",
    args: ["C:\\runtime\\app\\cli.js"],
  });
  const result = await fixture.host.upgradeManagedRuntime();
  assert.equal(result.updated, true);
  assert.equal(fixture.invocation().args.includes("--provider-only"), true);
  assert.equal(fixture.invocation().args.includes("--port"), true);
  assert.equal(fixture.invocation().args.includes("--replace-codex-route"), false);
});

test("provider-only doctor requests the provider-safe CLI report", async () => {
  const fixture = providerHost(providerConfig());
  let invocation;
  fixture.host.run = async (name, args) => {
    invocation = { name, args };
    return {
      code: 0,
      stdout: JSON.stringify({ ok: true, mode: "browser-only", checks: [] }),
      stderr: "",
    };
  };
  const report = await fixture.host.doctor();
  assert.equal(report.ok, true);
  assert.deepEqual(invocation, {
    name: "doctor",
    args: ["doctor", "--json", "--provider-only"],
  });
});
