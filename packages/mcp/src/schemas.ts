/**
 * The zod v4 vocabulary shared by the tool schemas.
 *
 * These shapes are the single source for three things at once: runtime
 * validation before anything reaches the driver, the JSON Schema the MCP host
 * shows to a model, and the `agent-context` document. Descriptions are written
 * for an agent reading them cold.
 */
import { z } from 'zod';
import { FILTERABLE_STATES, SEMANTIC_ROLES, SIGNALS } from './model.js';
import type { SemanticState } from './model.js';
import type { Loose } from './objects.js';

/** Handle of a terminal owned by the current MCP session. */
export const terminalId = z
  .string()
  .min(1)
  .describe('terminal handle returned by terminal.launch, e.g. "t1"');

/** Millisecond budget for a single call; the driver applies its class default otherwise. */
export const timeoutMs = z
  .number()
  .int()
  .positive()
  .max(600_000)
  .describe('timeout in milliseconds; defaults to the driver timeout class for the action');

/** State flags a locator may filter on. */
export const stateFilter = z
  .object({
    disabled: z.boolean().optional(),
    focused: z.boolean().optional(),
    selected: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    expanded: z.boolean().optional(),
    modal: z.boolean().optional(),
    busy: z.boolean().optional(),
    hidden: z.boolean().optional(),
    readonly: z.boolean().optional(),
  })
  .describe('only nodes asserting these state flags match');

/** Compile-time lock: the filter never drifts from the protocol's state set. */
export const STATE_FILTER_MATCHES_PROTOCOL: z.infer<typeof stateFilter> extends Loose<SemanticState>
  ? true
  : never = true;

/** Zero-based viewport cell coordinate. */
export const cellPosition = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0),
});

/** The target fields every acting tool accepts; exactly one selector wins. */
export const targetShape = {
  ref: z
    .string()
    .optional()
    .describe(
      'ref from a previous snapshot: "n8@42" (semantic node) or "grid:1,2,9,1@7" (grid match); ' +
        'valid only at the revision it was minted at',
    ),
  selector: z
    .string()
    .optional()
    .describe('CSS dialect: "dialog button#approve:focused" (role, #testId, .class, :state)'),
  role: z.enum(SEMANTIC_ROLES).optional().describe('semantic role; requires a semantic tree'),
  name: z
    .string()
    .optional()
    .describe('accessible name; "/pattern/flags" is read as a regular expression'),
  testId: z.string().optional().describe('author-supplied test id'),
  label: z.string().optional().describe('label text (labelledBy, else name)'),
  text: z
    .string()
    .optional()
    .describe('visible text; matches the grid when there is no semantic tree'),
  exact: z.boolean().optional().describe('exact rather than substring text matching'),
  state: stateFilter.optional(),
  nth: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('zero-based pick among matches; omit for strict mode (>1 match fails)'),
} as const;

/**
 * The same fields minus `text`, for tools whose own `text` argument means
 * something else (`terminal.type` types it, `terminal.wait_for` awaits it).
 * Those tools target by ref, selector, testId, role or label.
 */
export const targetShapeWithoutText = (({ text: _text, ...rest }) => rest)(targetShape);

/** Same fields, as a nested object (drag destinations). */
export const targetObject = z.object(targetShape);

/** A node as the compact format prints it, in structured form. */
export const refEntrySchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  depth: z.number().int().min(0),
  bounds: z
    .object({
      row: z.number().int(),
      column: z.number().int(),
      width: z.number().int(),
      height: z.number().int(),
    })
    .optional(),
  flags: z.array(z.string()),
  testId: z.string().optional(),
  value: z.string().optional(),
});

/** Whether the session publishes a semantic tree. */
export const semanticTreeState = z.enum(['available', 'unavailable']);

/** Cursor and modes, so one snapshot answers "what is on screen right now". */
export const cursorSchema = z.object({
  row: z.number().int(),
  column: z.number().int(),
  visible: z.boolean(),
  shape: z.enum(['block', 'underline', 'bar']).optional(),
});

export const modesSchema = z.object({
  mouseTracking: z.enum(['none', 'x10', 'vt200', 'drag', 'any']),
  mouseEncoding: z.enum(['default', 'sgr', 'urxvt', 'utf8']),
  bracketedPaste: z.boolean(),
  applicationCursorKeys: z.boolean(),
  applicationKeypad: z.boolean(),
  focusReporting: z.boolean(),
  synchronizedOutput: z.boolean(),
});

export const exitSchema = z.object({
  code: z.number().int().nullable(),
  signal: z.string().nullable(),
});

/** Signals `terminal.signal` accepts. */
export const signalSchema = z.enum(SIGNALS);

/** Mouse buttons a pointer action accepts. */
export const buttonSchema = z.enum(['left', 'middle', 'right']);

/** Roles offered to agents, for `agent-context`. */
export const roleEnum = z.enum(SEMANTIC_ROLES);

/** State names offered to agents, for `agent-context`. */
export const STATE_NAMES: readonly string[] = FILTERABLE_STATES;
