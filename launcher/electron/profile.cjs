const os = require("node:os");
const path = require("node:path");

const PRODUCTION_PROFILE = "production";
const DEVELOPMENT_PROFILE = "development";
const OPENCODEX_PROVIDER_PROFILE = "opencodex-provider";
const OPENCODEX_PROVIDER_CONFIG_PURPOSE = "opencodex-provider";
const OPENCODEX_PROVIDER_RUNTIME_HOST = "127.0.0.1";
const OPENCODEX_PROVIDER_RUNTIME_PORT = 17_841;

const PRODUCTION_BROWSER_PARTITION = "persist:codex-web-gpt-chatgpt";
const DEV_BROWSER_PARTITION = "persist:codex-web-gpt-dev-chatgpt";
const OPENCODEX_PROVIDER_ARGUMENT = "--opencodex-provider";

function resolveUserPath(value, homeDir = os.homedir()) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(homeDir, value.slice(2));
  }
  return path.resolve(value);
}

function resolveLauncherProfile({
  argv = process.argv,
  env = process.env,
  homeDir = os.homedir(),
  appData,
} = {}) {
  if (typeof appData !== "string" || !path.isAbsolute(appData)) {
    throw new Error("Launcher profile resolution requires an absolute appData path");
  }
  const openCodexProvider = argv.includes(OPENCODEX_PROVIDER_ARGUMENT);
  const development = argv.includes("--dev-profile");
  if (openCodexProvider && development) {
    throw new Error("Launcher profiles --opencodex-provider and --dev-profile are mutually exclusive");
  }
  if (openCodexProvider) {
    const localAppData = env.LOCALAPPDATA?.trim();
    const providerUserDataRoot = localAppData && path.isAbsolute(localAppData)
      ? path.resolve(localAppData)
      : appData;
    return {
      kind: OPENCODEX_PROVIDER_PROFILE,
      displayName: "Codex Web GPT OpenCodex",
      coreHome: path.join(homeDir, ".codex-chatgpt-web-opencodex"),
      codexHome: path.join(homeDir, ".codex-opencodex-web-bridge"),
      userData: path.join(providerUserDataRoot, "Codex Web GPT OpenCodex"),
      browserPartition: PRODUCTION_BROWSER_PARTITION,
    };
  }
  if (!development) {
    const coreHome = env.CODEX_CHATGPT_WEB_HOME?.trim()
      ? resolveUserPath(env.CODEX_CHATGPT_WEB_HOME.trim(), homeDir)
      : path.join(homeDir, ".codex-chatgpt-web");
    const userData = env.CODEX_WEB_GPT_LAUNCHER_DATA_DIR?.trim()
      ? resolveUserPath(env.CODEX_WEB_GPT_LAUNCHER_DATA_DIR.trim(), homeDir)
      : path.join(appData, "Codex Web GPT");
    return {
      kind: PRODUCTION_PROFILE,
      displayName: "Codex Web GPT",
      coreHome,
      codexHome: env.CODEX_HOME?.trim()
        ? resolveUserPath(env.CODEX_HOME.trim(), homeDir)
        : path.join(homeDir, ".codex"),
      userData,
      browserPartition: PRODUCTION_BROWSER_PARTITION,
    };
  }

  const coreHome = env.CODEX_WEB_GPT_DEV_HOME?.trim()
    ? resolveUserPath(env.CODEX_WEB_GPT_DEV_HOME.trim(), homeDir)
    : path.join(homeDir, ".codex-chatgpt-web-dev");
  const productionHome = env.CODEX_CHATGPT_WEB_HOME?.trim()
    ? resolveUserPath(env.CODEX_CHATGPT_WEB_HOME.trim(), homeDir)
    : path.join(homeDir, ".codex-chatgpt-web");
  if (path.resolve(coreHome) === path.resolve(productionHome)) {
    throw new Error("DEV profile home must differ from the production codex-chatgpt-web home");
  }
  return {
    kind: DEVELOPMENT_PROFILE,
    displayName: "Codex Web GPT DEV",
    coreHome,
    codexHome: path.join(coreHome, "codex-home"),
    userData: path.join(coreHome, "launcher"),
    browserPartition: DEV_BROWSER_PARTITION,
  };
}

function launcherProfileOwnsCodexRoute(profileKind) {
  return profileKind === PRODUCTION_PROFILE;
}

function launcherRuntimeProfile(profileKind) {
  return profileKind === DEVELOPMENT_PROFILE ? DEVELOPMENT_PROFILE : PRODUCTION_PROFILE;
}

module.exports = {
  DEVELOPMENT_PROFILE,
  DEV_BROWSER_PARTITION,
  OPENCODEX_PROVIDER_ARGUMENT,
  OPENCODEX_PROVIDER_CONFIG_PURPOSE,
  OPENCODEX_PROVIDER_PROFILE,
  OPENCODEX_PROVIDER_RUNTIME_HOST,
  OPENCODEX_PROVIDER_RUNTIME_PORT,
  PRODUCTION_BROWSER_PARTITION,
  PRODUCTION_PROFILE,
  launcherProfileOwnsCodexRoute,
  launcherRuntimeProfile,
  resolveLauncherProfile,
};
