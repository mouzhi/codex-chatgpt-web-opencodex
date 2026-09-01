const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  OPENCODEX_PROVIDER_PROFILE,
  PRODUCTION_BROWSER_PARTITION,
  resolveLauncherProfile,
} = require("../electron/profile.cjs");

test("DEV launcher profile isolates every durable home from production", () => {
  const homeDir = path.resolve("/Users/tester");
  const production = resolveLauncherProfile({
    argv: ["electron", "."],
    env: {},
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  });
  const development = resolveLauncherProfile({
    argv: ["electron", ".", "--dev-profile"],
    env: {},
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  });

  assert.equal(production.kind, "production");
  assert.equal(development.kind, "development");
  assert.notEqual(development.coreHome, production.coreHome);
  assert.notEqual(development.codexHome, production.codexHome);
  assert.notEqual(development.userData, production.userData);
  assert.notEqual(development.browserPartition, production.browserPartition);
  assert.equal(development.userData, path.join(development.coreHome, "launcher"));
  assert.equal(development.codexHome, path.join(development.coreHome, "codex-home"));
});

test("DEV launcher refuses an explicit home collision with production", () => {
  const homeDir = path.resolve("/Users/tester");
  const shared = path.join(homeDir, "shared");
  assert.throws(() => resolveLauncherProfile({
    argv: ["electron", ".", "--dev-profile"],
    env: {
      CODEX_WEB_GPT_DEV_HOME: shared,
      CODEX_CHATGPT_WEB_HOME: shared,
    },
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  }), /must differ from the production/);
});

test("DEV launcher ignores generic production path overrides", () => {
  const homeDir = path.resolve("/Users/tester");
  const development = resolveLauncherProfile({
    argv: ["electron", ".", "--dev-profile"],
    env: {
      CODEX_CHATGPT_WEB_HOME: path.join(homeDir, "production-core"),
      CODEX_HOME: path.join(homeDir, "production-codex"),
      CODEX_WEB_GPT_LAUNCHER_DATA_DIR: path.join(homeDir, "production-launcher"),
      CODEX_WEB_GPT_DEV_HOME: path.join(homeDir, "isolated-dev"),
    },
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  });

  assert.equal(development.coreHome, path.join(homeDir, "isolated-dev"));
  assert.equal(development.codexHome, path.join(homeDir, "isolated-dev", "codex-home"));
  assert.equal(development.userData, path.join(homeDir, "isolated-dev", "launcher"));
});

test("OpenCodex provider launcher uses fixed bridge homes and the production login partition", () => {
  const homeDir = path.resolve("/Users/tester");
  const appData = path.join(homeDir, "Library", "Application Support");
  const localAppData = path.join(homeDir, "Library", "Application Support", "Local");
  const provider = resolveLauncherProfile({
    argv: ["electron", ".", "--opencodex-provider"],
    env: {
      CODEX_CHATGPT_WEB_HOME: path.join(homeDir, "unexpected-core"),
      CODEX_HOME: path.join(homeDir, "unexpected-codex"),
      CODEX_WEB_GPT_LAUNCHER_DATA_DIR: path.join(homeDir, "unexpected-user-data"),
      LOCALAPPDATA: localAppData,
    },
    homeDir,
    appData,
  });

  assert.equal(provider.kind, OPENCODEX_PROVIDER_PROFILE);
  assert.equal(provider.displayName, "Codex Web GPT OpenCodex");
  assert.equal(provider.coreHome, path.join(homeDir, ".codex-chatgpt-web-opencodex"));
  assert.equal(provider.codexHome, path.join(homeDir, ".codex-opencodex-web-bridge"));
  assert.equal(provider.userData, path.join(localAppData, "Codex Web GPT OpenCodex"));
  assert.equal(provider.browserPartition, PRODUCTION_BROWSER_PARTITION);
});

test("OpenCodex provider falls back to appData when LOCALAPPDATA is absent", () => {
  const homeDir = path.resolve("/Users/tester");
  const appData = path.join(homeDir, "Library", "Application Support", "Roaming");
  const provider = resolveLauncherProfile({
    argv: ["electron", ".", "--opencodex-provider"],
    env: {},
    homeDir,
    appData,
  });

  assert.equal(provider.userData, path.join(appData, "Codex Web GPT OpenCodex"));
});

test("OpenCodex provider and DEV launcher flags cannot select two profiles", () => {
  const homeDir = path.resolve("/Users/tester");
  assert.throws(() => resolveLauncherProfile({
    argv: ["electron", ".", "--opencodex-provider", "--dev-profile"],
    env: {},
    homeDir,
    appData: path.join(homeDir, "Library", "Application Support"),
  }), /mutually exclusive/);
});
