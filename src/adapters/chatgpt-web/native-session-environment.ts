import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export type NativeCodexSandboxType = "dangerFullAccess" | "readOnly" | "workspaceWrite";

export interface NativeCodexTurnEnvironment {
  cwd: string;
  roots: string[];
  writableRoots: string[];
  sandboxType: NativeCodexSandboxType;
  networkAccess: boolean;
}

const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const sessionPathCache = new Map<string, string>();
const turnEnvironmentCache = new Map<string, NativeCodexTurnEnvironment>();

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function pathIdentity(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function matchesPath(root: string, value: string): boolean {
  const rel = relative(pathIdentity(root), pathIdentity(value));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function uniqueAbsolutePaths(values: unknown): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== "string" || !isAbsolute(value))) {
    return undefined;
  }
  const unique = new Map<string, string>();
  for (const value of values as string[]) {
    const normalized = resolve(value);
    if (!unique.has(pathIdentity(normalized))) unique.set(pathIdentity(normalized), normalized);
  }
  return [...unique.values()];
}

function sessionHomes(): string[] {
  const explicit = process.env.CODEX_NATIVE_HOME?.trim();
  if (explicit) return [resolve(explicit)];
  const candidates = [process.env.CODEX_HOME?.trim(), join(homedir(), ".codex")]
    .filter((value): value is string => Boolean(value))
    .map(value => resolve(value));
  return [...new Map(candidates.map(value => [pathIdentity(value), value])).values()];
}

function uuidTimestamp(threadId: string): number | undefined {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) return undefined;
  const value = Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16);
  return Number.isSafeInteger(value) ? value : undefined;
}

function dateParts(date: Date, utc: boolean): [string, string, string] {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  return [String(year), String(month).padStart(2, "0"), String(day).padStart(2, "0")];
}

function likelySessionDateParts(threadId: string): Array<[string, string, string]> {
  const timestamp = uuidTimestamp(threadId);
  if (timestamp === undefined) return [];
  const result = new Map<string, [string, string, string]>();
  for (const offsetDays of [-1, 0, 1]) {
    const date = new Date(timestamp + offsetDays * 24 * 60 * 60 * 1000);
    for (const utc of [false, true]) {
      const parts = dateParts(date, utc);
      result.set(parts.join("/"), parts);
    }
  }
  return [...result.values()];
}

function findSessionPath(home: string, threadId: string): string | undefined {
  const cacheKey = `${pathIdentity(home)}\n${threadId.toLowerCase()}`;
  const cached = sessionPathCache.get(cacheKey);
  if (cached) return cached;

  const sessionsRoot = resolve(home, "sessions");
  for (const [year, month, day] of likelySessionDateParts(threadId)) {
    const directory = resolve(sessionsRoot, year, month, day);
    if (!matchesPath(sessionsRoot, directory)) continue;
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    const expectedSuffix = `-${threadId.toLowerCase()}.jsonl`;
    const name = names.find(candidate => candidate.toLowerCase().startsWith("rollout-")
      && candidate.toLowerCase().endsWith(expectedSuffix));
    if (!name) continue;
    const path = resolve(directory, name);
    if (!matchesPath(sessionsRoot, path)) continue;
    sessionPathCache.set(cacheKey, path);
    return path;
  }
  return undefined;
}

function sandboxType(value: unknown): NativeCodexSandboxType | undefined {
  switch (value) {
    case "danger-full-access": return "dangerFullAccess";
    case "read-only": return "readOnly";
    case "workspace-write": return "workspaceWrite";
    default: return undefined;
  }
}

function managedWritableRoots(permissionProfile: Record<string, unknown>, roots: string[]): string[] | undefined {
  const fileSystem = record(permissionProfile.file_system);
  const entries = Array.isArray(fileSystem?.entries) ? fileSystem.entries : [];
  const values: string[] = [];
  for (const entryValue of entries) {
    const entry = record(entryValue);
    if (entry?.access !== "write") continue;
    const path = record(entry.path);
    if (path?.type !== "path" || typeof path.path !== "string" || !isAbsolute(path.path)) continue;
    values.push(resolve(path.path));
  }
  const unique = [...new Map(values.map(value => [pathIdentity(value), value])).values()];
  return unique.filter(value => roots.some(root => matchesPath(root, value) || matchesPath(value, root)));
}

function parseTurnEnvironment(payload: Record<string, unknown>): NativeCodexTurnEnvironment | undefined {
  if (typeof payload.cwd !== "string" || !isAbsolute(payload.cwd)) return undefined;
  const cwd = resolve(payload.cwd);
  const roots = uniqueAbsolutePaths(payload.workspace_roots);
  if (!roots || !roots.some(root => matchesPath(root, cwd))) return undefined;

  const policy = record(payload.sandbox_policy);
  const type = sandboxType(policy?.type);
  const permissionProfile = record(payload.permission_profile);
  if (!type || !permissionProfile) return undefined;

  if (type === "dangerFullAccess") {
    if (permissionProfile.type !== "disabled") return undefined;
    return { cwd, roots, writableRoots: roots, sandboxType: type, networkAccess: true };
  }
  if (permissionProfile.type !== "managed") return undefined;
  const networkAccess = policy?.network_access === true;
  if (type === "readOnly") {
    return { cwd, roots, writableRoots: [], sandboxType: type, networkAccess };
  }
  const writableRoots = managedWritableRoots(permissionProfile, roots);
  if (!writableRoots || !writableRoots.some(root => matchesPath(root, cwd))) return undefined;
  return { cwd, roots, writableRoots, sandboxType: type, networkAccess };
}

function messageText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.content === "string") return payload.content;
  if (!Array.isArray(payload.content)) return undefined;
  const text = payload.content
    .map(value => record(value)?.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return text || undefined;
}

function readExactTurn(
  path: string,
  threadId: string,
  turnId: string,
  expectedUserText: string,
): NativeCodexTurnEnvironment | undefined {
  let source: string;
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_SESSION_BYTES) return undefined;
    source = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  let sessionMatches = false;
  let userRevisionMatches = false;
  const matches: NativeCodexTurnEnvironment[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line) continue;
    let item: Record<string, unknown> | undefined;
    try { item = record(JSON.parse(line)); }
    catch { continue; }
    const payload = record(item?.payload);
    if (!payload) continue;
    if (item?.type === "session_meta" && payload.id === threadId) sessionMatches = true;
    if (item?.type === "response_item" && payload.type === "message" && payload.role === "user") {
      const itemMetadata = record(payload.internal_chat_message_metadata_passthrough);
      if (itemMetadata?.turn_id === turnId && messageText(payload) === expectedUserText) {
        userRevisionMatches = true;
      }
    }
    if (item?.type !== "turn_context" || payload.turn_id !== turnId) continue;
    const environment = parseTurnEnvironment(payload);
    if (environment) matches.push(environment);
  }
  if (!sessionMatches || !userRevisionMatches || matches.length === 0) return undefined;
  const canonical = JSON.stringify(matches[0]);
  return matches.every(value => JSON.stringify(value) === canonical) ? matches[0] : undefined;
}

/**
 * Resolve the exact turn context that Codex persisted locally before dispatching ResponsesAPI.
 * This is intentionally keyed by both core-owned thread_id and turn_id; it never searches prompt
 * text, guesses from the current process directory, or falls back to another turn.
 */
export function resolveNativeCodexTurnEnvironment(
  threadId: string,
  turnId: string,
  expectedUserText: string,
): NativeCodexTurnEnvironment | undefined {
  if (!expectedUserText) return undefined;
  for (const home of sessionHomes()) {
    const path = findSessionPath(home, threadId);
    if (!path) continue;
    const revisionHash = createHash("sha256").update(expectedUserText).digest("hex");
    const cacheKey = `${pathIdentity(path)}\n${turnId}\n${revisionHash}`;
    const cached = turnEnvironmentCache.get(cacheKey);
    if (cached) return cached;
    const environment = readExactTurn(path, threadId, turnId, expectedUserText);
    if (!environment) continue;
    turnEnvironmentCache.set(cacheKey, environment);
    return environment;
  }
  return undefined;
}
