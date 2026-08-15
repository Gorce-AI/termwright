/**
 * The tool registry: everything the server exposes, in one ordered list.
 *
 * Live-terminal tools come first (CONTRACTS.md §MCP), replay tools after. The
 * server, `agent-context` and the `skill` package all read this list, so a tool
 * is registered, documented and distributed by being added here once.
 */
import type { ToolDefinition } from './tool-kit.js';
import { TERMINAL_TOOLS } from './tools.js';
import { TRACE_TOOLS } from './trace-tools.js';

/** Every tool this server exposes. */
export const TOOLS: readonly ToolDefinition[] = Object.freeze([...TERMINAL_TOOLS, ...TRACE_TOOLS]);

/** Convenience lookup used by the server and by tests. */
export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
