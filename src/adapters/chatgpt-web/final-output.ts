import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { atomicWriteFile } from "../../config";

export type ChatGptFinalOutputStatus = "completed" | "failed-recovered";

export interface ChatGptFinalOutputRecord {
  version: 1;
  capturedAt: string;
  traceId: string;
  modelId: string;
  reasoning?: string;
  status: ChatGptFinalOutputStatus;
  markdownChars: number;
  markdownSha256: string;
  markdown: string;
  error?: string;
}

export function persistChatGptFinalOutput(input: {
  directory: string;
  traceId: string;
  modelId: string;
  reasoning?: string;
  status: ChatGptFinalOutputStatus;
  markdown: string;
  error?: string;
}): { markdownPath: string; jsonPath: string } {
  if (!isAbsolute(input.directory)) throw new Error("ChatGPT final-output directory must be absolute");
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(input.traceId)) throw new Error("ChatGPT final-output trace id is invalid");
  const markdown = input.markdown.trim();
  if (!markdown) throw new Error("ChatGPT final output is empty");
  const directory = resolve(input.directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { chmodSync(directory, 0o700); } catch {}
  const markdownPath = join(directory, `${input.traceId}.md`);
  const jsonPath = join(directory, `${input.traceId}.json`);
  const record: ChatGptFinalOutputRecord = {
    version: 1,
    capturedAt: new Date().toISOString(),
    traceId: input.traceId,
    modelId: input.modelId,
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    status: input.status,
    markdownChars: markdown.length,
    markdownSha256: createHash("sha256").update(markdown).digest("hex"),
    markdown,
    ...(input.error ? { error: input.error.slice(0, 1_000) } : {}),
  };
  atomicWriteFile(markdownPath, `${markdown}\n`);
  atomicWriteFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  try { chmodSync(markdownPath, 0o600); } catch {}
  try { chmodSync(jsonPath, 0o600); } catch {}
  return { markdownPath, jsonPath };
}
