/**
 * `agent-context`: one versioned JSON document describing everything an agent
 * needs to drive this server without guessing — every tool, its parameters,
 * enums and defaults, the error kinds, and the CLI exit-code taxonomy.
 *
 * It is *generated* from the zod schemas in `tools.ts`, never hand-maintained,
 * so a tool that changes its arguments changes this document in the same commit.
 * The umbrella CLI (`termwright agent-context`) imports {@link buildAgentContext}
 * rather than shelling out.
 */
import { z } from 'zod';
import { EXIT_CODES, MCP_ERROR_KINDS } from './errors.js';
import type { ErrorKind } from './errors.js';
import type { TermwrightErrorCode } from '@termwright/driver';
import { SEMANTIC_ROLES, SIGNALS } from './model.js';
import { STATE_NAMES } from './schemas.js';
import { MCP_LIMITS } from './sessions.js';
import { TOOLS } from './registry.js';
import { AGENT_CONTEXT_VERSION, SERVER_NAME, SERVER_VERSION } from './version.js';

/** JSON Schema for one tool's input or output. */
export type JsonSchema = Record<string, unknown>;

/** One tool, as `agent-context` describes it. */
export interface AgentContextTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly annotations: Readonly<Record<string, unknown>>;
}

/** The whole document. */
export interface AgentContext {
  readonly v: number;
  readonly server: { readonly name: string; readonly version: string };
  readonly tools: readonly AgentContextTool[];
  readonly enums: {
    readonly roles: readonly string[];
    readonly states: readonly string[];
    readonly signals: readonly string[];
    readonly errorKinds: readonly ErrorKind[];
  };
  readonly exitCodes: Readonly<Record<string, number>>;
  readonly limits: Readonly<Record<string, number>>;
  readonly conventions: readonly string[];
}

/**
 * The kinds published to agents.
 *
 * The driver's codes are listed rather than derived, because a runtime array
 * cannot be generated from a type — but {@link ERROR_KINDS_ARE_COMPLETE} fails
 * to compile if the driver adds one that is missing here, which is how
 * `not-found` will announce itself rather than quietly going undocumented.
 */
const DRIVER_ERROR_KINDS = [
  'timeout',
  'stale-snapshot',
  'ambiguous-locator',
  'semantic-capability-unavailable',
  'probe-attach-failed',
  'capability-unavailable',
  'not-actionable',
  'input-mode-disabled',
  'capability-provider-lost',
  'capability-provider-violation',
  'evidence-conflict',
  'adapter-guarantee-violation',
  'duplicate-semantic-key',
  'history-truncated',
  'protocol-violation',
  'capacity',
  'process-exited',
  'pty-backend-failed',
  'session-closed',
  'not-found',
] as const satisfies readonly TermwrightErrorCode[];

type MissingKind = Exclude<TermwrightErrorCode, (typeof DRIVER_ERROR_KINDS)[number]>;

/** Compile-time lock over the driver's closed code set. */
export const ERROR_KINDS_ARE_COMPLETE: [MissingKind] extends [never]
  ? true
  : ['undocumented error kinds', MissingKind] = true as [MissingKind] extends [never]
  ? true
  : ['undocumented error kinds', MissingKind];

const ERROR_KINDS: readonly ErrorKind[] = [...DRIVER_ERROR_KINDS, ...MCP_ERROR_KINDS];

/** Shared targeting guidance for every agent-facing surface. */
export const TARGETING_GUIDANCE = {
  precedence:
    'Targeting precedence is `ref`, `selector`, `testId`, `role` (+`name`), `label`, `text`, `screenText`.',
  semanticUnavailable:
    '`semanticTree: unavailable` means the program ships no integration — target physical output with `screenText`, never semantic `text` or `role`.',
} as const;

const CONVENTIONS = [
  'A semantic ref looks like semantic:n8@42: node id minted at semantic revision 42. A stable semantic identity may ' +
    'be re-resolved in later revisions; frame-local identities and grid refs must be refreshed.',
  'terminal.snapshot returns a screen revision; pass it to terminal.capture_since as cursor to get ' +
    'only the rows and semantic subtrees that changed.',
  'A wait for PTY text proves visual output, not that a future semantic frame has committed. When ' +
    'semantic state matters, wait for its explicit locator condition before capture_since.',
  'A semantic postcondition proves a new commit only when the baseline did not already satisfy it; ' +
    "choose a condition that represents the action's actual state change.",
  'Any name or text argument may be written as "/pattern/flags" to match as a regular expression.',
  TARGETING_GUIDANCE.precedence,
  'Locators are strict: more than one match fails with kind "ambiguous-locator" unless nth is given.',
  TARGETING_GUIDANCE.semanticUnavailable,
  'Errors are returned as tool results with isError set; _meta["io.termwright/error"].kind is the value to ' +
    "branch on, and that payload's suggestion says what to try next. Error results intentionally omit structuredContent because it is success-schema validated.",
] as const;

function toJsonSchema(shape: Record<string, z.ZodType>): JsonSchema {
  return z.toJSONSchema(z.object(shape), { io: 'input' }) as JsonSchema;
}

/** Builds the versioned document from the live tool definitions. */
export function buildAgentContext(): AgentContext {
  return {
    v: AGENT_CONTEXT_VERSION,
    server: { name: SERVER_NAME, version: SERVER_VERSION },
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: toJsonSchema(tool.inputSchema),
      outputSchema: toJsonSchema(tool.outputSchema),
      annotations: { ...tool.annotations },
    })),
    enums: {
      roles: [...SEMANTIC_ROLES],
      states: [...STATE_NAMES],
      signals: [...SIGNALS],
      errorKinds: ERROR_KINDS,
    },
    exitCodes: { ...EXIT_CODES },
    limits: { ...MCP_LIMITS },
    conventions: [...CONVENTIONS],
  };
}

/** The one-screen cheat sheet printed by `termwright-mcp usage`. */
export function buildUsage(): string {
  return [
    `${SERVER_NAME} MCP server ${SERVER_VERSION} — drive terminal programs over MCP`,
    '',
    'serve',
    '  termwright-mcp                     serve over stdio (what an MCP host spawns)',
    '  termwright-mcp --http --port 7333 --show-auth-token  authenticated Streamable HTTP on loopback',
    '  remote bind additionally requires: --host HOST --allow-non-loopback',
    '  termwright-mcp agent-context       versioned JSON: tools, params, enums, exit codes',
    '  termwright-mcp usage               this page',
    '  termwright-mcp skill --out DIR     emit an agent-skill package (SKILL.md + reference)',
    '  global: --json (machine-readable errors with a kind), --version, --help',
    '',
    'typical loop',
    '  terminal.launch {command:["node","app.js"]}   -> terminal "t1" + first snapshot',
    '  terminal.snapshot {terminal:"t1"}             -> refs semantic:n8@42 + visible text + revision',
    '  terminal.click {terminal:"t1", ref:"semantic:n9@42"} -> real mouse report through the PTY',
    '  terminal.wait_for {terminal:"t1", wait:"text", text:"Rejected"}',
    '  terminal.wait_for {terminal:"t1", wait:"focused", testId:"reject"} -> changed semantic state',
    '  terminal.capture_since {terminal:"t1", cursor:42} -> only what changed',
    '  terminal.close {terminal:"t1"}',
    '',
    'targeting  ref | selector | testId | role(+name) | label | text | screenText   (+ exact, state, nth)',
    `roles      ${SEMANTIC_ROLES.join(' ')}`,
    `states     ${STATE_NAMES.join(' ')}`,
    '',
    'exit codes 0 ok / 1 assertion / 2 usage / 3 no-session / 4 ipc / 5 internal',
    'error kinds ' + ERROR_KINDS.join(' '),
  ].join('\n');
}
