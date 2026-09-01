const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const {
  OPENCODEX_PROVIDER_ARGUMENT,
  OPENCODEX_PROVIDER_PROFILE,
} = require("./profile.cjs");

const LINUX_DESKTOP_NAME = "dev.codexwebgpt.launcher.desktop";
const HIDDEN_ARGUMENT = "--hidden";

function linuxDesktopPath() {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  return path.join(configHome, "autostart", LINUX_DESKTOP_NAME);
}

function desktopExecArgument(value) {
  return `"${String(value)
    .replaceAll("%", "%%")
    .replace(/["`$\\]/g, "\\$&")}"`;
}

function linuxExecutable(app) {
  const stableLauncher = process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE?.trim();
  if (stableLauncher && path.isAbsolute(stableLauncher)) return stableLauncher;
  const appImage = process.env.CODEX_WEB_GPT_APPIMAGE?.trim() || process.env.APPIMAGE?.trim();
  if (appImage && path.isAbsolute(appImage)) return appImage;
  return app.getPath("exe");
}

function launcherProfileKind(profile) {
  if (typeof profile === "string") return profile;
  if (profile && typeof profile === "object") {
    if (typeof profile.kind === "string") return profile.kind;
    if (typeof profile.profile === "string") return profile.profile;
    if (typeof profile.launcherProfile === "string") return profile.launcherProfile;
  }
  return process.argv.includes(OPENCODEX_PROVIDER_ARGUMENT)
    ? OPENCODEX_PROVIDER_PROFILE
    : null;
}

function autostartArguments(profile) {
  return launcherProfileKind(profile) === OPENCODEX_PROVIDER_PROFILE
    ? [OPENCODEX_PROVIDER_ARGUMENT, HIDDEN_ARGUMENT]
    : [HIDDEN_ARGUMENT];
}

function linuxDesktopEntry(app, executableOrProfile = linuxExecutable(app), profile) {
  let executable = executableOrProfile;
  let selectedProfile = profile;
  if (executableOrProfile === OPENCODEX_PROVIDER_PROFILE && profile === undefined) {
    executable = linuxExecutable(app);
    selectedProfile = executableOrProfile;
  }
  if (executableOrProfile && typeof executableOrProfile === "object" && profile === undefined) {
    executable = linuxExecutable(app);
    selectedProfile = executableOrProfile;
  }
  const args = autostartArguments(selectedProfile).join(" ");
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Codex Web GPT
Comment=Start the Codex Web GPT launcher in the background
Exec=${desktopExecArgument(executable)} ${args}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}

function linuxAutostartMatches(app, profile) {
  const target = linuxDesktopPath();
  try {
    return fs.readFileSync(target, "utf8") === linuxDesktopEntry(app, undefined, profile);
  } catch {
    return false;
  }
}

function requireAutostartState(result, desired) {
  if (result.supported && result.enabled !== Boolean(desired)) {
    throw new Error(`The operating system did not ${desired ? "enable" : "disable"} launcher autostart`);
  }
  return result;
}

function setAutostart(app, enabled, profile) {
  if (!app.isPackaged) return { supported: false, enabled: Boolean(enabled) };
  if (process.platform === "linux") {
    const target = linuxDesktopPath();
    if (enabled) {
      writePrivateFileAtomic(target, linuxDesktopEntry(app, undefined, profile));
    } else {
      fs.rmSync(target, { force: true });
    }
    return requireAutostartState({
      supported: true,
      enabled: enabled ? linuxAutostartMatches(app, profile) : false,
    }, enabled);
  }
  if (process.platform === "darwin" || process.platform === "win32") {
    const args = autostartArguments(profile);
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: Boolean(enabled),
      args,
    });
    return requireAutostartState({
      supported: true,
      enabled: app.getLoginItemSettings({ args }).openAtLogin === true,
    }, enabled);
  }
  return { supported: false, enabled: false };
}

function getAutostart(app, profile) {
  if (!app.isPackaged) return { supported: false, enabled: false };
  if (process.platform === "linux") {
    return { supported: true, enabled: linuxAutostartMatches(app, profile) };
  }
  if (process.platform === "darwin" || process.platform === "win32") {
    const args = autostartArguments(profile);
    return {
      supported: true,
      enabled: app.getLoginItemSettings({ args }).openAtLogin === true,
    };
  }
  return { supported: false, enabled: false };
}

module.exports = {
  LINUX_DESKTOP_NAME,
  HIDDEN_ARGUMENT,
  autostartArguments,
  autostartArgs: autostartArguments,
  getAutostart,
  launcherProfileKind,
  linuxAutostartMatches,
  linuxDesktopEntry,
  linuxDesktopPath,
  requireAutostartState,
  setAutostart,
};
