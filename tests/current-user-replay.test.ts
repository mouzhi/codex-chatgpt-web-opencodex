import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractChatGptTurnUserRevision } from "../src/adapters/chatgpt-web/environment";
import { chatGptInstructionLineage, chatGptTurnExecutionKey } from "../src/adapters/chatgpt-web/turn-execution";
import type { CodexParsedRequest } from "../src/types";

test("completed task resumes with idless input only when the latest native task authenticates its instruction", () => {
  const home = mkdtempSync(join(tmpdir(), "current-user-replay-"));
  const previous = process.env.CODEX_NATIVE_HOME;
  process.env.CODEX_NATIVE_HOME = home;
  const thread = "01a07ecf-a5f7-7d22-aa1f-167d7417302b";
  const turn = "01a08113-fd97-7de0-8d9b-581b88910336";
  const oldTurn = "01a07ed2-739a-7fc2-b870-b9dc640a6117";
  const content = [{ type: "input_text", text: "Continue the completed review" }];
  const directory = join(home, "sessions", "2026", "09", "08");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `rollout-2026-09-08T10-18-52-${thread}.jsonl`);
  const context = (id: string) => ({ type: "turn_context", payload: {
    turn_id: id, cwd: home, workspace_roots: [home], permission_profile: { type: "disabled" },
    sandbox_policy: { type: "danger-full-access" },
  } });
  const start = (id: string) => ({ type: "event_msg", payload: { type: "task_started", turn_id: id } });
  const user = (value: unknown) => ({ type: "response_item", payload: { type: "message", role: "user", id: "native-message", content: value } });
  const history = [
    { type: "session_meta", payload: { id: thread, source: "cli" } },
    start(oldTurn), context(oldTurn), user([{ type: "input_text", text: "Old instruction" }]),
    { type: "event_msg", payload: { type: "task_complete", turn_id: oldTurn } },
  ];
  const save = (tail: unknown[]) => writeFileSync(path, [...history, ...tail].map(v => JSON.stringify(v)).join("\n") + "\n");
  const metadata = { installation_id: "installation", session_id: "session", thread_id: thread,
    turn_id: turn, window_id: "window", context_window_id: "context", request_kind: "turn",
    sandbox: "none", sandbox_mode: "danger-full-access", workspaces: { [home]: {} } };
  const request = { modelId: "chatgpt-web-zero-risk-pro", stream: true, options: {},
    context: { messages: [], tools: [] }, _rawBody: {
      client_metadata: { "x-codex-turn-metadata": JSON.stringify(metadata) },
      input: [ { type: "message", role: "user", content: [{ type: "input_text", text: "Old instruction" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] },
        { type: "message", role: "user", content },
        { type: "function_call_output", call_id: "tool", output: "result" } ],
    } } as CodexParsedRequest;
  try {
    save([start(turn), context(turn), user(content)]);
    expect(extractChatGptTurnUserRevision(request)).toEqual(content);
    const key = chatGptTurnExecutionKey(request);
    expect(chatGptTurnExecutionKey(structuredClone(request))).toBe(key);
    expect(chatGptInstructionLineage(request).predecessors.size).toBe(0);
    save([start(turn), context(turn), user(content), user([{ type: "input_text", text: "New steering" }])]);
    expect(() => extractChatGptTurnUserRevision(request)).toThrow();
    save([start(turn), context(turn), user(content)]);
    appendFileSync(path, '{"type":"event_msg"');
    expect(() => extractChatGptTurnUserRevision(request)).toThrow();
    save([start(turn), context(turn), user([{ type: "input_text", text: "Different instruction" }])]);
    expect(() => extractChatGptTurnUserRevision(request)).toThrow();
    save([start(turn), context(turn)]); // An ancestor's message must not authorize this turn.
    expect(() => extractChatGptTurnUserRevision(request)).toThrow();
    save([start(oldTurn), context(turn), user(content)]); // turn_context alone is insufficient.
    expect(() => extractChatGptTurnUserRevision(request)).toThrow();
    save([start(turn), context(turn), user(content), start(oldTurn)]);
    expect(() => extractChatGptTurnUserRevision(request)).toThrow();
    save([start(turn), context(oldTurn), user(content)]);
    expect(() => extractChatGptTurnUserRevision(request)).toThrow();
    save([start(turn), context(turn), user(content)]);
    const forged = structuredClone(request) as any;
    forged._rawBody.input[2].internal_chat_message_metadata_passthrough = { turn_id: oldTurn };
    expect(() => extractChatGptTurnUserRevision(forged)).toThrow();
    const missing = structuredClone(request) as any;
    missing._rawBody.client_metadata["x-codex-turn-metadata"] = JSON.stringify({ ...metadata, installation_id: undefined });
    expect(() => extractChatGptTurnUserRevision(missing)).toThrow();
  } finally {
    if (previous === undefined) delete process.env.CODEX_NATIVE_HOME;
    else process.env.CODEX_NATIVE_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
