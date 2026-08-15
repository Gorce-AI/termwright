/**
 * The tool surface from CONTRACTS.md §MCP.
 *
 * Every tool is a thin projection: validate with zod, call the public driver
 * API, render the result. There is no locator engine, no wait loop and no
 * matching heuristic in this file — those live in `@termwright/driver`, and a
 * behaviour that differs between the MCP server and the test preset would be a
 * bug in this layer.
 *
 * Each definition carries both an `inputSchema` and an `outputSchema`; the
 * server returns `structuredContent` matching the latter, and `agent-context`
 * is generated from the same objects.
 */
import { z } from 'zod';
import { formatCompactSnapshot, refEntries, toRefEntry } from './format.js';
import type { RefEntry } from './format.js';
import { diffRows, diffSemantic } from './diff.js';
import { usageError } from './errors.js';
import type { ToolAnnotations } from './sdk-facade.js';
import {
  buttonSchema,
  cellPosition,
  cursorSchema,
  exitSchema,
  modesSchema,
  refEntrySchema,
  semanticTreeState,
  signalSchema,
  stateFilter,
  targetObject,
  targetShape,
  targetShapeWithoutText,
  terminalId,
  timeoutMs,
} from './schemas.js';
import type { TerminalEntry, TerminalStore } from './sessions.js';
import { buildLocator, hasTarget, textOrRegExp } from './targets.js';
import type { TargetInput } from './targets.js';

/** What a tool handler is given besides its arguments. */
export interface ToolContext {
  readonly store: TerminalStore;
}

/** A handler's result: the text block an agent reads, plus the structured data. */
export interface ToolOutcome<T> {
  readonly text: string;
  readonly data: T;
}

/** A registered tool, in the form both the server and `agent-context` consume. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodType>;
  readonly outputSchema: Record<string, z.ZodType>;
  readonly annotations: ToolAnnotations;
  /**
   * Args are typed `never` in the erased form so that any concrete handler is
   * assignable; the server passes the values zod already validated.
   */
  readonly handler: (context: ToolContext, args: never) => Promise<ToolOutcome<Record<string, unknown>>>;
}

function defineTool<I extends Record<string, z.ZodType>, O extends Record<string, z.ZodType>>(definition: {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: I;
  readonly outputSchema: O;
  readonly annotations?: ToolAnnotations;
  readonly handler: (
    context: ToolContext,
    args: z.output<z.ZodObject<I>>,
  ) => Promise<ToolOutcome<z.output<z.ZodObject<O>>>>;
}): ToolDefinition {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: definition.annotations ?? {},
    handler: definition.handler as ToolDefinition['handler'],
  };
}

// ---------------------------------------------------------------------------
// Shared projections

const semanticFields = {
  terminal: z.string(),
  revision: z.number().int().describe('screen revision; pass it to terminal.capture_since as cursor'),
  semanticRevision: z.number().int().nullable(),
  semanticTree: semanticTreeState,
};

/** Narrow projection of the semantic capability, as the schemas type it. */
function treeState(available: boolean): 'available' | 'unavailable' {
  return available ? 'available' : 'unavailable';
}

function optionalTimeout(timeout: number | undefined): { timeout?: number } {
  return timeout === undefined ? {} : { timeout };
}

/**
 * Waits out the gap between a session announcing a semantic tree and the first
 * tree becoming observable (tree frame plus its render-commit marker).
 *
 * Without it, a snapshot taken right after `wait_for text` would report
 * `semanticTree: unavailable` for a program that does publish one — the driver's
 * own locators wait for exactly this. A timeout is not an error: whatever is on
 * screen is reported honestly.
 */
async function settleSemantics(entry: TerminalEntry): Promise<void> {
  if (!entry.harness.capabilities().semanticTree) return;
  if (entry.harness.semanticTree() !== null) return;
  try {
    await entry.harness.waitForStable({ timeout: SEMANTIC_SETTLE_MS });
  } catch {
    // Report the session as it is; the compact snapshot says "unavailable".
  }
}

/** Budget for {@link settleSemantics}. */
const SEMANTIC_SETTLE_MS = 2_000;

/** Current screen + semantic state of one terminal, recorded for later diffs. */
function capture(
  context: ToolContext,
  entry: TerminalEntry,
): {
  readonly rows: readonly string[];
  readonly refs: readonly RefEntry[];
  readonly revision: number;
  readonly semanticRevision: number | null;
} {
  const record = context.store.record(entry);
  return {
    rows: record.rows,
    refs: record.semantic === null ? [] : refEntries(record.semantic),
    revision: record.revision,
    semanticRevision: record.semanticRevision,
  };
}

/** Renders the compact snapshot for a terminal in its current state. */
function compactFor(
  entry: TerminalEntry,
  rows: readonly string[],
  options: { readonly maxNodes?: number; readonly maxRows?: number; readonly includeText?: boolean } = {},
): string {
  const screen = entry.harness.screen();
  return formatCompactSnapshot({
    terminal: entry.id,
    columns: screen.columns,
    rows: screen.rows,
    revision: screen.revision,
    semantic: entry.harness.semanticTree(),
    text: rows,
    ...options,
  });
}

function locatorFor(entry: TerminalEntry, args: TargetInput) {
  return buildLocator(entry.harness, args);
}

/** `{ ok: true }` receipt fields shared by the acting tools. */
const receiptFields = {
  ok: z.literal(true),
  terminal: z.string(),
  revision: z.number().int(),
};

function receipt(entry: TerminalEntry): { ok: true; terminal: string; revision: number } {
  return { ok: true, terminal: entry.id, revision: entry.harness.screen().revision };
}

// ---------------------------------------------------------------------------
// Tools

const launch = defineTool({
  name: 'terminal.launch',
  title: 'Launch a terminal',
  description:
    'Starts a program in a real pseudo-terminal and returns a terminal handle plus the first ' +
    'snapshot. The child inherits only a safe environment subset unless inheritEnv is set; ' +
    'values passed in env are never echoed back.',
  inputSchema: {
    command: z
      .array(z.string())
      .min(1)
      .describe('argv, e.g. ["node", "app.js"] — no shell is involved'),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional().describe('extra environment for the child'),
    inheritEnv: z
      .boolean()
      .optional()
      .describe('pass the whole server environment to the child (default false)'),
    columns: z.number().int().min(1).max(1000).optional().describe('default 100'),
    rows: z.number().int().min(1).max(1000).optional().describe('default 30'),
    scrollbackLines: z.number().int().min(0).max(100_000).optional(),
    semanticNegotiationMs: z.number().int().min(0).max(60_000).optional(),
    timeouts: z
      .object({
        action: z.number().int().positive().optional(),
        text: z.number().int().positive().optional(),
        idle: z.number().int().positive().optional(),
        ready: z.number().int().positive().optional(),
        exit: z.number().int().positive().optional(),
      })
      .optional(),
  },
  outputSchema: {
    ...semanticFields,
    sessionId: z.string(),
    columns: z.number().int(),
    rows: z.number().int(),
    adapter: z.object({ name: z.string(), version: z.string() }).optional(),
    capabilities: z.array(z.string()),
    platform: z.string(),
    compact: z.string(),
  },
  annotations: { openWorldHint: true },
  handler: async (context, args) => {
    const entry = await context.store.launch(args);
    await settleSemantics(entry);
    const capabilities = entry.harness.capabilities();
    const screen = entry.harness.screen();
    const state = capture(context, entry);
    const compact = compactFor(entry, state.rows);
    return {
      text: compact,
      data: {
        terminal: entry.id,
        sessionId: entry.harness.sessionId,
        revision: state.revision,
        semanticRevision: state.semanticRevision,
        semanticTree: treeState(capabilities.semanticTree),
        columns: screen.columns,
        rows: screen.rows,
        ...(capabilities.adapter === undefined ? {} : { adapter: capabilities.adapter }),
        capabilities: [...capabilities.capabilities],
        platform: capabilities.platform,
        compact,
      },
    };
  },
});

const capabilities = defineTool({
  name: 'terminal.capabilities',
  title: 'Session capabilities',
  description:
    'What this session supports: whether a semantic tree is published, which adapter publishes ' +
    'it, and the terminal geometry. Call it before relying on role-based targeting.',
  inputSchema: { terminal: terminalId },
  outputSchema: {
    ...semanticFields,
    columns: z.number().int(),
    rows: z.number().int(),
    adapter: z.object({ name: z.string(), version: z.string() }).optional(),
    capabilities: z.array(z.string()),
    platform: z.string(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await settleSemantics(entry);
    const caps = entry.harness.capabilities();
    const screen = entry.harness.screen();
    const semantic = entry.harness.semanticTree();
    return {
      text:
        `Terminal ${entry.id} ${screen.columns}x${screen.rows} revision ${screen.revision}\n` +
        `semanticTree: ${caps.semanticTree ? 'available' : 'unavailable'}\n` +
        `adapter: ${caps.adapter === undefined ? 'none' : `${caps.adapter.name} ${caps.adapter.version}`}\n` +
        `capabilities: ${caps.capabilities.join(', ') || 'none'}\n` +
        `platform: ${caps.platform}`,
      data: {
        terminal: entry.id,
        revision: screen.revision,
        semanticRevision: semantic?.revision ?? null,
        semanticTree: treeState(caps.semanticTree),
        columns: screen.columns,
        rows: screen.rows,
        ...(caps.adapter === undefined ? {} : { adapter: caps.adapter }),
        capabilities: [...caps.capabilities],
        platform: caps.platform,
      },
    };
  },
});

const snapshot = defineTool({
  name: 'terminal.snapshot',
  title: 'Snapshot the terminal',
  description:
    'One typed view of the terminal: compact semantic refs, visible text, cursor, terminal modes ' +
    'and scroll position. variant "full" writes the complete dump (text, ANSI, HTML, semantic ' +
    'tree) to disk and returns only refs plus the file path. The returned revision is the cursor ' +
    'for terminal.capture_since.',
  inputSchema: {
    terminal: terminalId,
    variant: z.enum(['compact', 'full']).optional().describe('default "compact"'),
    maxNodes: z.number().int().min(1).max(5_000).optional(),
    maxRows: z.number().int().min(1).max(10_000).optional(),
    includeText: z.boolean().optional().describe('include the visible grid text (default true)'),
  },
  outputSchema: {
    ...semanticFields,
    cursorValue: z.number().int().describe('alias of revision, to pass to terminal.capture_since'),
    columns: z.number().int(),
    rows: z.number().int(),
    buffer: z.enum(['normal', 'alternate']),
    cursor: cursorSchema,
    modes: modesSchema,
    scroll: z.object({
      offset: z.number().int(),
      length: z.number().int(),
      retainedFloor: z.number().int(),
    }),
    refs: z.array(refEntrySchema),
    compact: z.string(),
    dumpPath: z.string().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await settleSemantics(entry);
    const state = capture(context, entry);
    const screen = entry.harness.screen();
    const semantic = entry.harness.semanticTree();
    const full = args.variant === 'full';
    const compact = compactFor(entry, state.rows, {
      ...(args.maxNodes === undefined ? {} : { maxNodes: args.maxNodes }),
      ...(args.maxRows === undefined ? {} : { maxRows: args.maxRows }),
      includeText: full ? false : args.includeText !== false,
    });
    let dumpPath: string | undefined;
    if (full) {
      dumpPath = await context.store.writeDump(
        entry,
        `snapshot-${screen.revision}.json`,
        `${JSON.stringify(
          {
            terminal: entry.id,
            revision: screen.revision,
            columns: screen.columns,
            rows: screen.rows,
            text: screen.text(),
            ansi: screen.ansi(),
            html: screen.html(),
            semantic,
          },
          null,
          2,
        )}\n`,
      );
    }
    return {
      text: dumpPath === undefined ? compact : `${compact}\nfull dump: ${dumpPath}`,
      data: {
        terminal: entry.id,
        revision: screen.revision,
        cursorValue: screen.revision,
        semanticRevision: state.semanticRevision,
        semanticTree: treeState(semantic !== null),
        columns: screen.columns,
        rows: screen.rows,
        buffer: screen.buffer,
        cursor: screen.cursor,
        modes: screen.modes,
        scroll: {
          offset: entry.harness.scrollback.position(),
          length: entry.harness.scrollback.length,
          retainedFloor: entry.harness.scrollback.retainedFloor,
        },
        refs: state.refs.map((entry) => ({ ...entry, flags: [...entry.flags] })),
        compact,
        ...(dumpPath === undefined ? {} : { dumpPath }),
      },
    };
  },
});

const captureSince = defineTool({
  name: 'terminal.capture_since',
  title: 'What changed since a revision',
  description:
    'Incremental view: the screen rows that differ and the semantic subtrees that were added, ' +
    'removed or updated since the given cursor. The cursor must be a revision this server ' +
    'handed out earlier (snapshot or capture_since); older cursors fail with history-truncated.',
  inputSchema: {
    terminal: terminalId,
    cursor: z.number().int().min(0).describe('revision returned by an earlier snapshot'),
    maxRows: z.number().int().min(1).max(10_000).optional(),
    maxSubtrees: z.number().int().min(1).max(1_000).optional(),
  },
  outputSchema: {
    ...semanticFields,
    since: z.number().int(),
    changedRows: z.array(z.object({ row: z.number().int(), text: z.string() })),
    changedSubtrees: z.array(
      z.object({
        change: z.enum(['added', 'removed', 'updated']),
        ref: z.string(),
        role: z.string(),
        name: z.string(),
        compact: z.string(),
      }),
    ),
    compact: z.string(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await settleSemantics(entry);
    const before = context.store.baseline(entry, args.cursor);
    const after = context.store.record(entry);
    const rowLimit = args.maxRows ?? 200;
    const subtreeLimit = args.maxSubtrees ?? 100;
    const changedRows = diffRows(before.rows, after.rows).slice(0, rowLimit);
    const changedSubtrees = diffSemantic(before.semantic, after.semantic).slice(0, subtreeLimit);

    const lines = [
      `Terminal ${entry.id} revision ${after.revision} (since ${args.cursor})`,
      `semanticTree: ${after.semantic === null ? 'unavailable' : 'available'}`,
    ];
    lines.push(`changed rows: ${changedRows.length}`);
    for (const row of changedRows) lines.push(`  ${row.row}: ${row.text}`);
    lines.push(`changed nodes: ${changedSubtrees.length}`);
    for (const subtree of changedSubtrees) {
      const marker = subtree.change === 'added' ? '+' : subtree.change === 'removed' ? '-' : '~';
      for (const line of subtree.compact.split('\n')) lines.push(`  ${marker} ${line}`);
    }
    return {
      text: lines.join('\n'),
      data: {
        terminal: entry.id,
        revision: after.revision,
        semanticRevision: after.semanticRevision,
        semanticTree: treeState(after.semantic !== null),
        since: args.cursor,
        changedRows: changedRows.map((row) => ({ ...row })),
        changedSubtrees: changedSubtrees.map((subtree) => ({ ...subtree })),
        compact: lines.join('\n'),
      },
    };
  },
});

const query = defineTool({
  name: 'terminal.query',
  title: 'Find matching nodes',
  description:
    'Resolves a target to refs without acting on it. Use it to check how many nodes a locator ' +
    'matches before clicking, or to turn a role/name into a ref.',
  inputSchema: {
    terminal: terminalId,
    ...targetShape,
    timeout: timeoutMs.optional(),
    limit: z.number().int().min(1).max(100).optional().describe('default 20'),
  },
  outputSchema: {
    terminal: z.string(),
    revision: z.number().int(),
    count: z.number().int(),
    matches: z.array(
      z.object({
        ref: z.string(),
        revision: z.number().int(),
        semantic: z.boolean(),
        role: z.string().optional(),
        name: z.string().optional(),
        bounds: refEntrySchema.shape.bounds,
      }),
    ),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await settleSemantics(entry);
    const locator = locatorFor(entry, args);
    const limit = args.limit ?? 20;
    const count = await locator.count();
    const matches: {
      ref: string;
      revision: number;
      semantic: boolean;
      role?: string;
      name?: string;
      bounds?: { row: number; column: number; width: number; height: number };
    }[] = [];
    for (let index = 0; index < Math.min(count, limit); index += 1) {
      const target = await locator.nth(index).resolve(optionalTimeout(args.timeout));
      matches.push({
        ref: target.ref,
        revision: target.revision,
        semantic: target.semantic,
        ...(target.role === undefined ? {} : { role: target.role }),
        ...(target.name === undefined ? {} : { name: target.name }),
        ...(target.rect === null ? {} : { bounds: target.rect }),
      });
    }
    const text =
      matches.length === 0
        ? `no matches (count ${count})`
        : matches
            .map(
              (match) =>
                `${match.role ?? 'generic'} ${JSON.stringify(match.name ?? '')} ref=${match.ref}`,
            )
            .join('\n');
    return {
      text,
      data: { terminal: entry.id, revision: entry.harness.screen().revision, count, matches },
    };
  },
});

function pointerTool(name: 'terminal.click' | 'terminal.double_click'): ToolDefinition {
  const double = name === 'terminal.double_click';
  return defineTool({
    name,
    title: double ? 'Double-click a target' : 'Click a target',
    description:
      `Sends a real ${double ? 'double ' : ''}mouse report through the pseudo-terminal. Fails with ` +
      'unsupported-action when the program never enabled mouse tracking.',
    inputSchema: {
      terminal: terminalId,
      ...targetShape,
      button: buttonSchema.optional(),
      position: z
        .object({ rowOffset: z.number().int(), columnOffset: z.number().int() })
        .optional()
        .describe('offset inside the target rectangle'),
      timeout: timeoutMs.optional(),
    },
    outputSchema: { ...receiptFields, ref: z.string() },
    handler: async (context, args) => {
      const entry = context.store.get(args.terminal);
      const locator = locatorFor(entry, args);
      const target = await locator.resolve(optionalTimeout(args.timeout));
      const options = {
        ...optionalTimeout(args.timeout),
        ...(args.button === undefined ? {} : { button: args.button }),
        ...(args.position === undefined ? {} : { position: args.position }),
      };
      if (double) await locator.doubleClick(options);
      else await locator.click(options);
      return {
        text: `${double ? 'double-clicked' : 'clicked'} ref=${target.ref}`,
        data: { ...receipt(entry), ref: target.ref },
      };
    },
  });
}

const press = defineTool({
  name: 'terminal.press',
  title: 'Press keys',
  description:
    'Sends key chords as real bytes, honouring the modes the program enabled (application cursor ' +
    'keys, keypad). Examples: "Enter", "Escape", "Control+K Control+U". With a target, the node is ' +
    'focused first.',
  inputSchema: {
    terminal: terminalId,
    keys: z.string().min(1).describe('space-separated chords, e.g. "Control+A Home"'),
    ...targetShape,
    timeout: timeoutMs.optional(),
  },
  outputSchema: { ...receiptFields, ref: z.string().optional() },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    if (hasTarget(args)) {
      const locator = locatorFor(entry, args);
      const target = await locator.resolve(optionalTimeout(args.timeout));
      await locator.press(args.keys, optionalTimeout(args.timeout));
      return { text: `pressed ${args.keys} on ref=${target.ref}`, data: { ...receipt(entry), ref: target.ref } };
    }
    await entry.harness.press(args.keys);
    return { text: `pressed ${args.keys}`, data: receipt(entry) };
  },
});

const type = defineTool({
  name: 'terminal.type',
  title: 'Type text',
  description:
    'Types text as individual keystrokes (not a paste). With a target, the node is focused first.',
  inputSchema: {
    terminal: terminalId,
    text: z.string(),
    ...targetShapeWithoutText,
    timeout: timeoutMs.optional(),
  },
  outputSchema: { ...receiptFields, ref: z.string().optional() },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    if (hasTarget(args)) {
      const locator = locatorFor(entry, args);
      const target = await locator.resolve(optionalTimeout(args.timeout));
      await locator.type(args.text, optionalTimeout(args.timeout));
      return { text: `typed into ref=${target.ref}`, data: { ...receipt(entry), ref: target.ref } };
    }
    await entry.harness.type(args.text);
    return { text: `typed ${args.text.length} characters`, data: receipt(entry) };
  },
});

const paste = defineTool({
  name: 'terminal.paste',
  title: 'Paste text',
  description:
    'Pastes text, wrapped in bracketed-paste markers when the program enabled that mode. Use it ' +
    'for multi-line input instead of terminal.type.',
  inputSchema: { terminal: terminalId, text: z.string() },
  outputSchema: receiptFields,
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await entry.harness.paste(args.text);
    return { text: `pasted ${args.text.length} characters`, data: receipt(entry) };
  },
});

const writeRaw = defineTool({
  name: 'terminal.write_raw',
  title: 'Write raw bytes',
  description:
    'Writes bytes to the pseudo-terminal verbatim — no newline, no key encoding. The escape hatch ' +
    'for sequences the key encoder does not model.',
  inputSchema: {
    terminal: terminalId,
    data: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional().describe('default "utf8"'),
  },
  outputSchema: { ...receiptFields, bytes: z.number().int() },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    const bytes =
      args.encoding === 'base64' ? new Uint8Array(Buffer.from(args.data, 'base64')) : args.data;
    await entry.harness.write(bytes);
    const length = typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength;
    return { text: `wrote ${length} bytes`, data: { ...receipt(entry), bytes: length } };
  },
});

const drag = defineTool({
  name: 'terminal.drag',
  title: 'Drag',
  description:
    'Drags with real mouse reports: either from one target to another (toTarget), or between two ' +
    'cell positions inside the source target (from/to).',
  inputSchema: {
    terminal: terminalId,
    ...targetShape,
    toTarget: targetObject.optional().describe('drop target; omit when using from/to'),
    from: cellPosition.optional(),
    to: cellPosition.optional(),
    timeout: timeoutMs.optional(),
  },
  outputSchema: receiptFields,
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    const source = locatorFor(entry, args);
    if (args.toTarget !== undefined) {
      await source.dragTo(locatorFor(entry, args.toTarget), optionalTimeout(args.timeout));
      return { text: 'dragged to target', data: receipt(entry) };
    }
    if (args.from === undefined || args.to === undefined) {
      throw usageError('drag needs either toTarget, or both from and to');
    }
    await source.drag({ from: args.from, to: args.to });
    return {
      text: `dragged (${args.from.row},${args.from.column}) -> (${args.to.row},${args.to.column})`,
      data: receipt(entry),
    };
  },
});

const wheel = defineTool({
  name: 'terminal.wheel',
  title: 'Scroll with the wheel',
  description: 'Sends wheel reports over a target. Positive deltaY scrolls down.',
  inputSchema: {
    terminal: terminalId,
    ...targetShape,
    deltaY: z.number().int(),
    deltaX: z.number().int().optional(),
  },
  outputSchema: receiptFields,
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await locatorFor(entry, args).wheel({
      deltaY: args.deltaY,
      ...(args.deltaX === undefined ? {} : { deltaX: args.deltaX }),
    });
    return { text: `wheel deltaY=${args.deltaY}`, data: receipt(entry) };
  },
});

const resize = defineTool({
  name: 'terminal.resize',
  title: 'Resize the terminal',
  description: 'Resizes the pseudo-terminal; the child sees a real SIGWINCH.',
  inputSchema: {
    terminal: terminalId,
    columns: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  },
  outputSchema: { ...receiptFields, columns: z.number().int(), rows: z.number().int() },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await entry.harness.resize({ columns: args.columns, rows: args.rows });
    return {
      text: `resized to ${args.columns}x${args.rows}`,
      data: { ...receipt(entry), columns: args.columns, rows: args.rows },
    };
  },
});

const signal = defineTool({
  name: 'terminal.signal',
  title: 'Send a signal',
  description:
    'Sends INT, TERM, KILL or HUP to the child. Destructive by design: terminal.close cleans up ' +
    'without signalling.',
  inputSchema: { terminal: terminalId, signal: signalSchema },
  outputSchema: receiptFields,
  annotations: { destructiveHint: true },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    await entry.harness.signal(args.signal);
    return { text: `sent SIG${args.signal}`, data: receipt(entry) };
  },
});

const scrollback = defineTool({
  name: 'terminal.scrollback',
  title: 'Read or move the scrollback',
  description:
    'Emulator-side history: read a line range, search it, or move the viewport. The child sees ' +
    'nothing — no input is sent.',
  inputSchema: {
    terminal: terminalId,
    move: z.number().int().optional().describe('lines to move the viewport; negative scrolls up'),
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
    search: z.string().optional().describe('literal text, or "/pattern/flags"'),
    limit: z.number().int().min(1).max(1000).optional().describe('max search hits (default 50)'),
  },
  outputSchema: {
    terminal: z.string(),
    length: z.number().int(),
    retainedFloor: z.number().int(),
    position: z.number().int(),
    text: z.string().optional(),
    matches: z.array(z.object({ line: z.number().int(), match: z.string() })).optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    const api = entry.harness.scrollback;
    if (args.move !== undefined) api.move({ lines: args.move });
    const wantsText = args.from !== undefined || args.to !== undefined || args.search === undefined;
    const text = wantsText
      ? api.text({
          ...(args.from === undefined ? {} : { from: args.from }),
          ...(args.to === undefined ? {} : { to: args.to }),
        })
      : undefined;
    const matches =
      args.search === undefined
        ? undefined
        : api.search(textOrRegExp(args.search)).slice(0, args.limit ?? 50);
    const lines = [
      `scrollback length ${api.length} floor ${api.retainedFloor} position ${api.position()}`,
    ];
    if (matches !== undefined) {
      lines.push(...matches.map((match) => `  ${match.line}: ${match.match}`));
    }
    if (text !== undefined) lines.push(text);
    return {
      text: lines.join('\n'),
      data: {
        terminal: entry.id,
        length: api.length,
        retainedFloor: api.retainedFloor,
        position: api.position(),
        ...(text === undefined ? {} : { text }),
        ...(matches === undefined ? {} : { matches: matches.map((match) => ({ ...match })) }),
      },
    };
  },
});

const selectCells = defineTool({
  name: 'terminal.select_cells',
  title: 'Select a cell range',
  description: 'Selects a rectangle in the emulator (like a mouse selection). No input is sent.',
  inputSchema: { terminal: terminalId, start: cellPosition, end: cellPosition },
  outputSchema: receiptFields,
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    entry.harness.selection.selectCells({ start: args.start, end: args.end });
    return {
      text: `selected (${args.start.row},${args.start.column})-(${args.end.row},${args.end.column})`,
      data: receipt(entry),
    };
  },
});

const copySelection = defineTool({
  name: 'terminal.copy_selection',
  title: 'Copy the selection',
  description: 'Returns the text of the current selection and optionally clears it.',
  inputSchema: { terminal: terminalId, clear: z.boolean().optional() },
  outputSchema: { terminal: z.string(), text: z.string() },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    const text = entry.harness.selection.copy();
    if (args.clear === true) entry.harness.selection.clear();
    return { text, data: { terminal: entry.id, text } };
  },
});

const waitFor = defineTool({
  name: 'terminal.wait_for',
  title: 'Wait for a condition',
  description:
    'Revision-driven waits — never a sleep. "text"/"title" wait for content, "visible"/"hidden"/' +
    '"attached" wait on a target, "stable" waits for renders to settle, "idle" for output to stop, ' +
    '"render" for a render after a given revision, "exit" for the child to exit.',
  inputSchema: {
    terminal: terminalId,
    wait: z.enum(['text', 'title', 'visible', 'hidden', 'attached', 'stable', 'idle', 'render', 'exit']),
    text: z.string().optional().describe('for wait="text"; "/pattern/flags" is a regular expression'),
    title: z.string().optional().describe('for wait="title"'),
    ...targetShapeWithoutText,
    frames: z.number().int().min(1).optional().describe('for wait="stable"'),
    after: z.number().int().min(0).optional().describe('for wait="render": the revision to beat'),
    timeout: timeoutMs.optional(),
  },
  outputSchema: {
    ...receiptFields,
    wait: z.string(),
    exit: exitSchema.optional(),
  },
  handler: async (context, args) => {
    const entry = context.store.get(args.terminal);
    const timeout = optionalTimeout(args.timeout);
    switch (args.wait) {
      case 'text': {
        if (args.text === undefined) throw usageError('wait="text" needs text');
        await entry.harness.waitForText(textOrRegExp(args.text), timeout);
        break;
      }
      case 'title': {
        if (args.title === undefined) throw usageError('wait="title" needs title');
        await entry.harness.waitForTitle(textOrRegExp(args.title), timeout);
        break;
      }
      case 'visible':
      case 'hidden':
      case 'attached': {
        await locatorFor(entry, args).waitFor({ state: args.wait, ...timeout });
        break;
      }
      case 'stable': {
        await entry.harness.waitForStable({
          ...(args.frames === undefined ? {} : { frames: args.frames }),
          ...timeout,
        });
        break;
      }
      case 'idle': {
        await entry.harness.waitForIdle(timeout);
        break;
      }
      case 'render': {
        if (args.after === undefined) throw usageError('wait="render" needs after');
        await entry.harness.waitForRender({ after: args.after, ...timeout });
        break;
      }
      case 'exit': {
        const status = await entry.harness.waitForExit(timeout);
        return {
          text: `exited code=${String(status.code)} signal=${String(status.signal)}`,
          data: { ...receipt(entry), wait: args.wait, exit: status },
        };
      }
    }
    return { text: `wait ${args.wait} satisfied`, data: { ...receipt(entry), wait: args.wait } };
  },
});

const close = defineTool({
  name: 'terminal.close',
  title: 'Close a terminal',
  description:
    'Bounded physical cleanup: hangs up the pseudo-terminal and forgets the handle. Send signals ' +
    'explicitly with terminal.signal if the child must be killed first.',
  inputSchema: { terminal: terminalId },
  outputSchema: { ok: z.literal(true), terminal: z.string(), exit: exitSchema.nullable() },
  annotations: { idempotentHint: true },
  handler: async (context, args) => {
    const entry = await context.store.close(args.terminal);
    return {
      text: `closed ${entry.id}`,
      data: { ok: true as const, terminal: entry.id, exit: entry.exit },
    };
  },
});

/** Every tool this server exposes, in the order CONTRACTS.md §MCP lists them. */
export const TOOLS: readonly ToolDefinition[] = Object.freeze([
  launch,
  capabilities,
  snapshot,
  captureSince,
  query,
  pointerTool('terminal.click'),
  pointerTool('terminal.double_click'),
  press,
  type,
  paste,
  writeRaw,
  drag,
  wheel,
  resize,
  signal,
  scrollback,
  selectCells,
  copySelection,
  waitFor,
  close,
]);

/** Convenience lookup used by the server and by tests. */
export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export { stateFilter, targetShape, toRefEntry };
