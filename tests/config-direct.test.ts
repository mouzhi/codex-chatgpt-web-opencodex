import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultConfig,
  loadConfig,
  OPENCODEX_PROVIDER_CONFIG_PURPOSE,
  providerConfig,
  saveConfig,
} from "../src/config";

const roots: string[] = [];

afterEach(() => {
  delete process.env.CODEX_CHATGPT_WEB_HOME;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directFullConfig(root: string) {
  const config = defaultConfig("full");
  config.tunnel = {
    binaryPath: process.execPath,
    tunnelId: `tunnel_${"a".repeat(32)}`,
    runtimeKeyFile: join(root, "secrets", "runtime.key"),
    profileDir: join(root, "tunnel", "profiles"),
    profileName: "open-codex",
    alias: "open-codex",
  };
  return config;
}

test("full direct config round-trips tunnel identity and only the private key path", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-config-direct-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const config = directFullConfig(root);
  const keyMaterial = "runtime-key-fixture-not-for-config";
  mkdirSync(join(root, "secrets"), { recursive: true });
  writeFileSync(config.tunnel!.runtimeKeyFile, keyMaterial, { mode: 0o600 });
  saveConfig(config);

  const serialized = readFileSync(join(root, "config.json"), "utf8");
  expect(serialized).toContain(`"tunnelId": "${config.tunnel!.tunnelId}"`);
  expect(serialized).toContain(`"alias": "${config.tunnel!.alias}"`);
  expect(serialized).toContain(`"runtimeKeyFile": ${JSON.stringify(config.tunnel!.runtimeKeyFile)}`);
  expect(serialized).not.toContain(keyMaterial);
  expect(serialized).not.toContain("runtimeApiKey");

  const loaded = loadConfig();
  expect(loaded.mode).toBe("full");
  expect(loaded.tunnel).toEqual(config.tunnel);

  const provider = providerConfig(loaded);
  expect(provider.chatgptWeb).toMatchObject({ localToolsEnabled: true });
  expect(JSON.stringify(provider)).not.toContain(keyMaterial);
});

test("full direct config keeps normal tunnel validation fail-closed", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-config-direct-invalid-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const config = directFullConfig(root);
  config.tunnel!.tunnelId = "tunnel_invalid";
  mkdirSync(root, { recursive: true });
  saveConfig(config);

  expect(() => loadConfig()).toThrow("Invalid tunnel.tunnelId");
});

test("OpenCodex provider purpose persists the secure full config at its fixed loopback endpoint", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-config-opencodex-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const config = directFullConfig(root);
  config.purpose = OPENCODEX_PROVIDER_CONFIG_PURPOSE;
  config.browserHost = "launcher";
  config.browserHostDescriptorPath = join(root, "runtime", "launcher-browser.json");
  const keyMaterial = "provider-runtime-key-fixture-not-for-config";
  mkdirSync(join(root, "secrets"), { recursive: true });
  writeFileSync(config.tunnel!.runtimeKeyFile, keyMaterial, { mode: 0o600 });
  saveConfig(config);

  const loaded = loadConfig();
  expect(loaded.purpose).toBe(OPENCODEX_PROVIDER_CONFIG_PURPOSE);
  expect(loaded.host).toBe("127.0.0.1");
  expect(loaded.port).toBe(17_841);
  expect(loaded.tunnel).toEqual(config.tunnel);
  expect(readFileSync(join(root, "config.json"), "utf8")).not.toContain(keyMaterial);
  expect(providerConfig(loaded).chatgptWeb).toMatchObject({
    browserHost: "launcher",
    localToolsEnabled: true,
    preserveTerminalPage: true,
    finalOutputDirectory: join(root, "logs", "final-outputs"),
  });
});

test("OpenCodex provider purpose rejects a non-default port", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-config-opencodex-port-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const config = directFullConfig(root);
  config.purpose = OPENCODEX_PROVIDER_CONFIG_PURPOSE;
  config.browserHost = "launcher";
  config.browserHostDescriptorPath = join(root, "runtime", "launcher-browser.json");
  config.port = 17_842;
  saveConfig(config);

  expect(() => loadConfig()).toThrow("requires 127.0.0.1:17841");
});

test("OpenCodex provider purpose requires the launcher browser host", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-config-opencodex-browser-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const config = directFullConfig(root);
  config.purpose = OPENCODEX_PROVIDER_CONFIG_PURPOSE;
  saveConfig(config);

  expect(() => loadConfig()).toThrow("requires launcher browser host");
});

test("browser-only direct config does not enable local tools or require a tunnel", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-config-browser-only-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const config = defaultConfig("browser-only");
  saveConfig(config);

  const loaded = loadConfig();
  expect(loaded.mode).toBe("browser-only");
  expect(loaded.tunnel).toBeUndefined();
  expect(providerConfig(loaded).chatgptWeb).toMatchObject({ localToolsEnabled: false });
});

test("OpenCodex provider purpose permits browser-only mode while retaining launcher ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-config-opencodex-browser-only-"));
  roots.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;

  const config = defaultConfig("browser-only");
  config.purpose = OPENCODEX_PROVIDER_CONFIG_PURPOSE;
  config.browserHost = "launcher";
  config.browserHostDescriptorPath = join(root, "runtime", "launcher-browser.json");
  saveConfig(config);

  const loaded = loadConfig();
  expect(loaded.mode).toBe("browser-only");
  expect(loaded.tunnel).toBeUndefined();
  expect(providerConfig(loaded).chatgptWeb).toMatchObject({
    browserHost: "launcher",
    localToolsEnabled: false,
  });
});
