/**
 * `@termwright/mcp` — a thin MCP server over the public driver API.
 *
 * The tools in CONTRACTS.md §MCP are projections of `@termwright/driver`: this
 * package validates arguments, calls the driver, and renders the compact ref
 * format. It owns sessions and formatting; it owns no locator engine, no wait
 * loop and no matching heuristic.
 *
 * @example
 * ```ts
 * import { serveStdio } from '@termwright/mcp';
 *
 * // What an MCP host spawns; blocks until the host disconnects.
 * const running = await serveStdio();
 * process.on('SIGINT', () => void running.close());
 * ```
 */
export { buildAgentContext, buildUsage } from './agent-context.js';
export type { AgentContext, AgentContextTool, JsonSchema } from './agent-context.js';

export { buildAgentSkill, writeAgentSkill } from './agent-skill.js';
export type { SkillFile } from './agent-skill.js';

export { runCli, main } from './cli.js';
export type { CliIo } from './cli.js';

export { diffRows, diffSemantic } from './diff.js';
export type { RowChange, SubtreeChange } from './diff.js';

export {
  EXIT_CODES,
  McpError,
  exitCodeFor,
  noSessionError,
  renderErrorPayload,
  toErrorPayload,
  usageError,
} from './errors.js';
export type { ErrorKind, ErrorPayload } from './errors.js';

export {
  formatBounds,
  formatCompactSnapshot,
  formatNodeLine,
  formatRef,
  parseRef,
  refEntries,
  stateFlags,
  toRefEntry,
  walkSnapshot,
} from './format.js';
export type { CompactSnapshotOptions, RefEntry } from './format.js';

export { FILTERABLE_STATES, SEMANTIC_ROLES, SIGNALS } from './model.js';
export type {
  Rect,
  ScreenSnapshot,
  SemanticNode,
  SemanticRole,
  SemanticSnapshot,
  SemanticState,
  SessionCapabilities,
} from './model.js';

export {
  createTermwrightMcpServer,
  serveHttp,
  serveInMemory,
  serveStdio,
} from './server.js';
export type { HttpServeOptions, HttpServerHandle, RunningServer, ServeOptions } from './server.js';

export {
  MCP_LIMITS,
  SessionRegistry,
  TerminalStore,
  closeSessionStores,
  createSessionStores,
} from './sessions.js';
export type { SessionStores } from './sessions.js';
export type {
  LaunchRequest,
  RegisteredSession,
  RevisionRecord,
  TerminalEntry,
  TerminalStoreOptions,
} from './sessions.js';

export { TOOLS, toolByName } from './registry.js';
export { TERMINAL_TOOLS } from './tools.js';
export { TRACE_TOOLS } from './trace-tools.js';
export { defineTool } from './tool-kit.js';
export type { ToolContext, ToolDefinition, ToolOutcome } from './tool-kit.js';

export { SCREENSHOT_LIMITS, renderScreenshot } from './screenshots.js';
export type { ScreenshotImage, ScreenshotRequest } from './screenshots.js';

export { TRACE_LIMITS, TraceStore } from './traces.js';
export type { OpenTrace, TraceStoreOptions } from './traces.js';

export { buildLocator, textOrRegExp } from './targets.js';
export type { TargetInput } from './targets.js';

export { AGENT_CONTEXT_VERSION, SERVER_NAME, SERVER_VERSION } from './version.js';
