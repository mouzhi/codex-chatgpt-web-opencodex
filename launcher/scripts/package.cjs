const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateRuntimeBundle } = require("../electron/runtime-install.cjs");
const { requireLibnotifySymbol } = require("./prepare-linux-appimage-tools.cjs");

const root = path.resolve(__dirname, "..");
const launcherManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const executable = "node";
const electronBuilderCli = require.resolve("electron-builder/out/cli/cli.js", { paths: [root] });
const SUPPORTED_TARGETS = ["--mac", "--win", "--linux"];
const OPEN_CODEX_PROVIDER_FLAG = "--opencodex-provider";
const OPEN_CODEX_PROVIDER_PACKAGE = Object.freeze({
  appId: "dev.codexwebgpt.launcher.opencodex",
  productName: "Codex Web GPT OpenCodex",
  artifactName: "codex-web-gpt-opencodex-${version}-${os}-${arch}.${ext}",
  nsisGuid: "7a35d84f-bf5d-4d71-9f59-8e78c35c5a52",
  main: "electron/opencodex-provider-main.cjs",
});
const artifactFilePattern = /\.(?:AppImage|dmg|exe|zip|blockmap)$/i;

function hostTarget(platform = process.platform) {
  return platform === "darwin" ? "--mac"
    : platform === "win32" ? "--win"
      : platform === "linux" ? "--linux"
        : null;
}

function parsePackagingArgs(args = process.argv.slice(2), platform = process.platform) {
  const openCodexProvider = args.includes(OPEN_CODEX_PROVIDER_FLAG);
  const requestedArgs = args.filter(arg => arg !== OPEN_CODEX_PROVIDER_FLAG);
  const requested = requestedArgs[0];
  const target = requested || hostTarget(platform);
  if (!SUPPORTED_TARGETS.includes(target)) {
    throw new Error(`Unsupported packaging target: ${requested || platform}`);
  }
  const nativeTarget = hostTarget(platform);
  if (target !== nativeTarget) {
    throw new Error(
      `Cross-packaging ${target} from ${platform}/${process.arch} is disabled because the launcher embeds a native Bun runtime. `
      + "Build each target on its matching operating system.",
    );
  }
  if (openCodexProvider && target !== "--win") {
    throw new Error(`${OPEN_CODEX_PROVIDER_FLAG} packaging is supported only for the Windows launcher`);
  }
  return { openCodexProvider, requested, target };
}

function builderOverrides(openCodexProvider) {
  if (!openCodexProvider) return [];
  return [
    `--config.appId=${OPEN_CODEX_PROVIDER_PACKAGE.appId}`,
    `--config.productName=${OPEN_CODEX_PROVIDER_PACKAGE.productName}`,
    `--config.artifactName=${OPEN_CODEX_PROVIDER_PACKAGE.artifactName}`,
    `--config.nsis.guid=${OPEN_CODEX_PROVIDER_PACKAGE.nsisGuid}`,
    `--config.extraMetadata.main=${OPEN_CODEX_PROVIDER_PACKAGE.main}`,
  ];
}

function artifactBelongsToPackage(name, openCodexProvider) {
  const generatedArtifactPattern = openCodexProvider
    ? /^codex-web-gpt-opencodex-/
    : /^codex-web-gpt-(?!opencodex-)/;
  return generatedArtifactPattern.test(name) && artifactFilePattern.test(name);
}

function runChecked(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status ?? "unknown"}`);
}

function verifySignedMacArchive(staging, env) {
  const archives = fs.readdirSync(staging).filter(name => /-mac-(?:arm64|x64)\.zip$/.test(name));
  if (archives.length !== 1) {
    throw new Error(`Expected exactly one macOS ZIP for verification; found ${archives.join(", ") || "none"}`);
  }
  const verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-mac-verify-"));
  try {
    runChecked("ditto", ["-x", "-k", path.join(staging, archives[0]), verificationRoot], env);
    const appBundle = path.join(verificationRoot, `${launcherManifest.build.productName}.app`);
    runChecked("codesign", ["--verify", "--deep", "--strict", appBundle], env);
    validateRuntimeBundle(path.join(appBundle, "Contents", "Resources", "runtime"), {
      version: launcherManifest.version,
      platform: "darwin",
      arch: process.arch,
    });
  } finally {
    fs.rmSync(verificationRoot, { recursive: true, force: true });
  }
}

function main() {
  const { openCodexProvider, target } = parsePackagingArgs();
  const env = { ...process.env };
  if (!env.CSC_LINK && !env.CSC_NAME) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  const builderArgs = [
    electronBuilderCli,
    target,
    "--publish",
    "never",
    ...builderOverrides(openCodexProvider),
  ];
  if (target === "--mac" && !env.CSC_LINK && !env.CSC_NAME) builderArgs.push("--config.mac.identity=-");
  if (target === "--linux") {
    if (!["x64", "arm64"].includes(process.arch)) {
      throw new Error(`Unsupported Linux AppImage architecture: ${process.arch}`);
    }
    builderArgs.push(`--${process.arch}`);
    validateRuntimeBundle(path.join(root, "build", "runtime"), {
      version: launcherManifest.version, platform: "linux", arch: process.arch,
    });
    if (process.arch === "arm64") {
      const toolsRoot = env.APPIMAGE_TOOLS_PATH;
      if (!toolsRoot || !path.isAbsolute(toolsRoot)) {
        throw new Error("Linux arm64 packaging requires APPIMAGE_TOOLS_PATH from prepare-linux-appimage-tools.cjs");
      }
      const library = path.join(toolsRoot, "lib", "arm64", "libnotify.so.4");
      requireLibnotifySymbol(library);
      builderArgs.push(
        `--config.linux.extraFiles.from=${library}`,
        "--config.linux.extraFiles.to=usr/lib/libnotify.so.4",
      );
    }
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-package-"));
  const artifactsDirectory = path.join(root, "artifacts");
  try {
    const result = spawnSync(executable, [...builderArgs, `--config.directories.output=${staging}`], {
      cwd: root,
      env,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    if (target === "--mac") verifySignedMacArchive(staging, env);

    fs.mkdirSync(artifactsDirectory, { recursive: true });
    for (const entry of fs.readdirSync(artifactsDirectory, { withFileTypes: true })) {
      if (entry.isFile() && artifactBelongsToPackage(entry.name, openCodexProvider)) {
        fs.rmSync(path.join(artifactsDirectory, entry.name), { force: true });
      }
    }
    const artifacts = fs.readdirSync(staging, { withFileTypes: true })
      .filter((entry) => entry.isFile() && artifactFilePattern.test(entry.name));
    if (!artifacts.some((entry) => /\.(?:AppImage|dmg|exe|zip)$/i.test(entry.name))) {
      throw new Error(`electron-builder produced no distributable artifact in ${staging}`);
    }
    for (const artifact of artifacts) {
      const publicName = artifact.name.replace(/-linux-x86_64(?=\.)/, "-linux-x64")
        .replace(/-linux-aarch64(?=\.)/, "-linux-arm64");
      fs.copyFileSync(path.join(staging, artifact.name), path.join(artifactsDirectory, publicName));
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = {
  OPEN_CODEX_PROVIDER_FLAG,
  OPEN_CODEX_PROVIDER_PACKAGE,
  artifactBelongsToPackage,
  builderOverrides,
  hostTarget,
  parsePackagingArgs,
};
