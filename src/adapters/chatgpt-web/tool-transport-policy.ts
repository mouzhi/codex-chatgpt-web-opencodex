export const CHATGPT_WEB_AGENT_WAIT_POLL_MS = 30_000;

export const CHATGPT_WEB_AGENT_WAIT_TOOL_NAMES = new Set([
  "multi_agent_v1__wait_agent",
  "multi_agent_v2__wait_agent",
  "collaboration__wait_agent",
]);

/** Bound every agent wait at the last broker hop, regardless of the MCP surface used to invoke it. */
export function transportBoundToolArguments(
  wireName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return CHATGPT_WEB_AGENT_WAIT_TOOL_NAMES.has(wireName)
    ? { ...args, timeout_ms: CHATGPT_WEB_AGENT_WAIT_POLL_MS }
    : args;
}
