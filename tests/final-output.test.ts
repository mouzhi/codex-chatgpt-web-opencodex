import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistChatGptFinalOutput } from "../src/adapters/chatgpt-web/final-output";

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("persists completed and recovered ChatGPT output as matching Markdown and JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-final-output-"));
  temporaryRoots.push(root);
  const markdown = "# Result\n\nComplete answer.";
  const result = persistChatGptFinalOutput({
    directory: root,
    traceId: "trace_output_123",
    modelId: "chatgpt-web/pro",
    reasoning: "max",
    status: "failed-recovered",
    markdown,
    error: "outer tool result arrived after the browser completed",
  });

  expect(existsSync(result.markdownPath)).toBeTrue();
  expect(existsSync(result.jsonPath)).toBeTrue();
  expect(readFileSync(result.markdownPath, "utf8")).toBe(`${markdown}\n`);
  expect(JSON.parse(readFileSync(result.jsonPath, "utf8"))).toMatchObject({
    traceId: "trace_output_123",
    modelId: "chatgpt-web/pro",
    reasoning: "max",
    status: "failed-recovered",
    markdownChars: markdown.length,
    markdown,
    error: "outer tool result arrived after the browser completed",
  });
});
