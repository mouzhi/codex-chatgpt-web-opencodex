# Maintaining the OpenCodex provider fork

Repository: `mouzhi/codex-chatgpt-web-opencodex`.
Upstream: `miuuyy/codex-chatgpt-web`.
Special branch: `opencodex`. Retain upstream ancestry and merge commits.

## Merge an upstream release

1. Start from a clean `opencodex` checkout. Read the release diff/changelog, then fetch the exact tag.
2. Create a merge branch from the special head, not from the upstream head.
3. Merge the upstream tag. Preserve both upstream fixes and the provider-specific contracts when resolving conflicts. Keep the fork's main README; update `README.upstream.md` with the new upstream README so its version/download checks stay current.
4. Run checks and build for the platforms affected. Only then publish the special head.

Example for a future version (replace `X.Y.Z` with the verified release):

```sh
git remote add upstream https://github.com/miuuyy/codex-chatgpt-web.git
git fetch upstream --tags
git switch opencodex
git status --short
git switch -c merge/upstream-vX.Y.Z
git merge --no-ff --no-commit vX.Y.Z
```

Skip `remote add` if `upstream` already exists. Stop before merging when the checkout is dirty.

## Checks

Use Bun 1.4.0 and locked dependencies:

```sh
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run check-version
bun run typecheck
bun run test
bun run --cwd launcher typecheck
bun run --cwd launcher test
bun run launcher:opencodex --prepare-only
git diff --check
```

Audit new commits for credentials and machine state before pushing. Never add browser profiles,
auth/config backups, account catalogs, local logs, output retention, descriptors or build dependencies.
Native Codex/OpenCodex configuration belongs to each operator, not this source repository.

Verify these retained boundaries after each merge:

- Isolated `opencodex-provider` identity, user homes and loopback port 17841; no native route replacement.
- 900K Automatic/V1 metadata; upstream manual limits and separate manual credentials.
- Saved chats, terminal-page/Markdown/JSON retention, continuation and exact native environment recovery.
- Authenticated browser/Tunnel and a harmless real tool turn plus follow-up after the operator's safe restart.

For releases that affect launcher/platform code, package and smoke-test on the corresponding OS.
Do not interrupt active tasks merely to update a checkout or test installation.

## Publish

After committing a validated merge:

```sh
git push origin HEAD:opencodex
git tag -a opencodex-vX.Y.Z-1 -m "OpenCodex provider snapshot based on upstream vX.Y.Z"
git push origin opencodex-vX.Y.Z-1
```

Use a new snapshot number for additional special hotfixes. Do not force-update shared branches
or tags. Keep original upstream `vX.Y.Z` tags bound to their upstream commits. Special snapshot
tags do not trigger the upstream `v*` release workflow; installers require a separately reviewed
provider build and checksums.

GitHub's overwrite/sync operation must not replace the special branch. Merge into it. Reusable
colleague instructions stay in README; machine rollout receipts and private backups stay local.
