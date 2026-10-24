const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("the patched Electron dependency is explicitly provisioned for source launchers", () => {
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.scripts.postinstall, "node node_modules/electron/install.js");
  const [major, minor, patch] = manifest.devDependencies.electron.split(".").map(Number);
  assert.ok(major > 42 || (major === 42 && (minor > 11 || (minor === 11 && patch >= 16))));
  const electronRoot = path.dirname(require.resolve("electron/package.json"));
  const installed = fs.readFileSync(path.join(electronRoot, "dist", "version"), "utf8").trim().replace(/^v/, "");
  assert.equal(installed, manifest.devDependencies.electron);
  assert.ok(fs.existsSync(require("electron")));
});
