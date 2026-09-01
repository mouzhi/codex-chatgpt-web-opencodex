// Windows OpenCodex package entrypoint.
//
// The OpenCodex build has its own application identity, but users should not
// have to remember a profile-selection argument when launching it from the
// installed executable, desktop shortcut, Start menu, or NSIS finish page.
// Keep the flag in the packaged entrypoint so every launch path selects the
// same profile while preserving an explicitly supplied flag verbatim.
if (!process.argv.includes("--opencodex-provider")) {
  process.argv.push("--opencodex-provider");
}

require("./main.cjs");
