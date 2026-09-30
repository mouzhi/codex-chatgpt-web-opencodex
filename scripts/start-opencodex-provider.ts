import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dir, "..");
const launcher = join(root, "launcher");
const flags = process.argv.slice(2);
if (flags.some(flag => !["--prepare-only", "--hidden"].includes(flag))) {
  throw new Error("Supported flags: --prepare-only, --hidden");
}
if (Bun.version !== "1.4.0") throw new Error(`This build requires Bun 1.4.0; current version is ${Bun.version}`);
const bun = process.execPath;
const buildEnvironment = { ...process.env, CODEX_WEB_GPT_BUN: bun, CODEX_CHATGPT_WEB_BUN: bun };
function run(args: string[], cwd: string): void {
  const result = Bun.spawnSync([bun, ...args], {
    cwd, env: buildEnvironment, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
run(["install", "--frozen-lockfile"], root);
run(["install", "--frozen-lockfile"], launcher);
run(["run", "build"], launcher);
run(["run", "scripts/build-browser-helper.ts"], root);
if (flags.includes("--prepare-only")) {
  process.stdout.write("OPENCODEX_PROVIDER_PREPARED\n");
} else {
  const require = createRequire(join(launcher, "package.json"));
  const electron = require("electron") as string;
  const launchEnvironment: Record<string, string | undefined> = {
    ...buildEnvironment,
    CODEX_CHATGPT_WEB_HOME: join(homedir(), ".codex-chatgpt-web-opencodex"),
    CODEX_HOME: join(homedir(), ".codex-opencodex-web-bridge"),
  };
  for (const key of ["VITE_DEV_SERVER_URL", "CODEX_WEB_GPT_DEV_HOME", "CODEX_WEB_GPT_LAUNCHER_DATA_DIR"]) {
    delete launchEnvironment[key];
  }
  const child = spawn(electron, [launcher, "--opencodex-provider", ...(flags.includes("--hidden") ? ["--hidden"] : [])], {
    cwd: root, stdio: "inherit", env: launchEnvironment,
  });
  child.once("error", error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  child.once("exit", code => { process.exitCode = code ?? 1; });
}
