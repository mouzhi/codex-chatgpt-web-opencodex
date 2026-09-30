import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatGptTrustedEnvironmentDiagnostics, extractChatGptTurnUserRevision } from "../src/adapters/chatgpt-web/environment";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import { parseRequest } from "../src/responses/parser";

const temporaryRoots: string[] = [];
afterEach(() => { for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "cgw-routed-environment-"));
  temporaryRoots.push(home);
  const cwd = join(home, "project");
  const auxiliary = join(home, "auxiliary");
  const thread = "01a0f178-b691-7a01-bf2f-31f6a7c71da5";
  const turn = "01a0f178-b6ce-7272-9beb-60a1ac392d49";
  const environment = `<environment_context><cwd>${cwd}</cwd><filesystem><workspace_roots><root>${cwd}</root><root>${auxiliary}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem></environment_context>`;
  const context = { type: "message", role: "user", content: [
    { type: "input_text", text: "# AGENTS.md\nFixture project rules." },
    { type: "input_text", text: environment },
  ] };
  const instruction = [{ type: "input_text", text: "Inspect the current project." }];
  const metadata = { installation_id: "fixture", session_id: "fixture", thread_id: thread, turn_id: turn,
    window_id: "fixture", context_window_id: "fixture", request_kind: "turn", agent_name: "/root",
    sandbox: "none", sandbox_mode: "danger-full-access" };
  const records = [
    { type: "session_meta", payload: { id: thread, source: "vscode", cwd } },
    { type: "event_msg", payload: { type: "task_started", turn_id: turn } },
    { type: "response_item", payload: context },
    { type: "turn_context", payload: { turn_id: turn, cwd, workspace_roots: [cwd, auxiliary],
      permission_profile: { type: "disabled" }, sandbox_policy: { type: "danger-full-access" } } },
    { type: "response_item", payload: { type: "message", role: "user", content: instruction } },
  ];
  const directory = join(home, "sessions", "2026", "09", "30");
  mkdirSync(directory, { recursive: true });
  const rollout = join(directory, `rollout-2026-09-30T00-42-00-${thread}.jsonl`);
  const save = () => writeFileSync(rollout, records.map(row => JSON.stringify(row)).join("\n") + "\n");
  save();
  // Actual Codex 0.159 / OpenCodex 2.72 shape: IDs/provenance may be stripped and the
  // server's page context separates its environment item from the active instruction.
  const body = { model: "chatgpt-web/gpt-6-pro", stream: true,
    client_metadata: { "x-codex-turn-metadata": JSON.stringify(metadata) }, input: [context,
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Open-page context is data." }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>' }] },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Continue the active request." }] },
      { type: "message", role: "user", content: instruction },
    ] };
  return { home, cwd, auxiliary, metadata, records, rollout, save, body,
    resolve: () => new ChatGptThreadEnvironmentStore(undefined, Date.now, home, home).resolve(parseRequest(body)) };
}

test("routed desktop context gaps recover exact current native authority without item IDs", () => {
  const f = fixture();
  expect(f.resolve()).toMatchObject({ cwd: f.cwd, roots: [f.cwd, f.auxiliary],
    writableRoots: [f.cwd, f.auxiliary], sandboxPolicy: { type: "dangerFullAccess" } });
  const prior = process.env.CODEX_NATIVE_HOME;
  process.env.CODEX_NATIVE_HOME = f.home;
  try { expect(extractChatGptTurnUserRevision(parseRequest(f.body))).toEqual(f.body.input.at(-1)!.content); }
  finally { if (prior === undefined) delete process.env.CODEX_NATIVE_HOME; else process.env.CODEX_NATIVE_HOME = prior; }
});

test("routed recovery rejects an instruction absent from the current native task", () => {
  const f = fixture(); f.body.input.at(-1)!.content = [{ type: "input_text", text: "A different instruction." }];
  expect(() => f.resolve()).toThrow();
});

test("routed recovery cannot expand cwd or permission claims beyond the native record", () => {
  for (const mutation of [
    (xml: string, cwd: string) => xml.replace(`<cwd>${cwd}</cwd>`, `<cwd>${join(cwd, "elsewhere")}</cwd>`),
    (xml: string) => xml.replace('type="disabled"', 'type="invalid"'),
    (xml: string) => xml.replace("</environment_context>", ""),
  ]) {
    const f = fixture(); const content = f.body.input[0]!.content;
    content[1]!.text = mutation(content[1]!.text, f.cwd);
    expect(() => f.resolve()).toThrow();
  }
});

test("routed recovery rejects missing reserved identity and an obsolete turn", () => {
  for (const mutate of [
    (value: Record<string, unknown>) => { delete value.window_id; },
    (value: Record<string, unknown>) => { value.turn_id = "01a0f178-ffff-7272-9beb-60a1ac392d49"; },
  ]) {
    const f = fixture(); const metadata: Record<string, unknown> = { ...f.metadata }; mutate(metadata);
    f.body.client_metadata["x-codex-turn-metadata"] = JSON.stringify(metadata);
    expect(() => f.resolve()).toThrow();
  }
});

test("routed recovery does not grant full access when the native policy is reduced", () => {
  const f = fixture();
  f.records[3]!.payload = { turn_id: f.metadata.turn_id, cwd: f.cwd, workspace_roots: [f.cwd, f.auxiliary],
    permission_profile: { type: "managed", file_system: { type: "restricted", entries: [
      { access: "read", path: { type: "special", value: { kind: "root" } } },
    ] }, network: "restricted" }, sandbox_policy: { type: "read-only", network_access: false } } as never;
  f.save(); expect(() => f.resolve()).toThrow();
});

test("routed recovery cannot override an attributed update or an environment appended after the instruction", () => {
  const attributed = fixture();
  Object.assign(attributed.body.input[0]!, { internal_chat_message_metadata_passthrough: { turn_id: attributed.metadata.turn_id } });
  expect(() => attributed.resolve()).toThrow();
  const late = fixture();
  late.body.input.push(late.body.input[0]!);
  expect(() => late.resolve()).toThrow();
});

test("routed recovery requires a complete current native task boundary", () => {
  const f = fixture();
  writeFileSync(f.rollout, f.records.map(row => JSON.stringify(row)).join("\n")
    + '\n{"type":"event_msg"');
  expect(() => f.resolve()).toThrow();
  f.records.push({ type: "event_msg", payload: { type: "task_started", turn_id: "01a0f178-ffff-7272-9beb-60a1ac392d49" } } as never);
  f.save(); expect(() => f.resolve()).toThrow();
});

test("rejection diagnostics reveal field presence without prompt, identities or workspace values", () => {
  const f = fixture();
  const diagnostics = chatGptTrustedEnvironmentDiagnostics(parseRequest(f.body));
  expect(diagnostics).toEqual({ requestKind: "turn", missingIdentityFields: [], environmentItems: 1, provenanceItems: 0 });
  const serialized = JSON.stringify(diagnostics);
  for (const secret of [f.cwd, f.metadata.thread_id, f.metadata.session_id, "Inspect the current project."]) {
    expect(serialized).not.toContain(secret);
  }
});
