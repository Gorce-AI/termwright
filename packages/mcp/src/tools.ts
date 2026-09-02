/**
 * The tool surface from CONTRACTS.md §MCP.
 *
 * Every tool is a thin projection: validate with zod, call the public driver
 * API, render the result. There is no locator engine, no wait loop and no
 * matching heuristic in this file — those live in `@termwright/driver`, and a
 * behaviour that differs between the MCP server and the Native Host would be a
 * bug in this layer.
 *
 * Each definition carries both an `inputSchema` and an `outputSchema`; the
 * server returns `structuredContent` matching the latter, and `agent-context`
 * is generated from the same objects.
 */
import { z } from 'zod';
import { CONDITION_KINDS } from '@termwright/protocol';
import { defineTool } from './tool-kit.js';
import { renderScreenshot } from './screenshots.js';
import { describeImage, screenshotSchema } from './screenshot-schema.js';
import type { ToolContext, ToolDefinition, ToolOutcome } from './tool-kit.js';
import { formatCompactSnapshot, refEntries, toRefEntry } from './format.js';
import type { RefEntry } from './format.js';
import { crashSchema, describeCrash, renderCrash } from './crash.js';
import { diffRows, diffSemantic } from './diff.js';
import { LOG_LIMITS, logEntrySchema, renderLogs } from './logs.js';
import { usageError } from './errors.js';
import {
  buttonSchema,
  cellPosition,
  cursorSchema,
  evidenceProvenanceSchema,
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
import type { TerminalEntry } from './sessions.js';
import { buildLocator, hasTarget, textOrRegExp } from './targets.js';
import type { TargetInput } from './targets.js';
import type { ActionReceipt } from '@termwright/protocol';

const mouseModifiersSchema = z
  .array(z.enum(['shift', 'alt', 'control']))
  .max(3)
  .optional();

// ---------------------------------------------------------------------------
// Shared projections

const semanticFields = {
  terminal: z.string(),
  revision: z
    .number()
    .int()
    .describe('screen revision; pass it to terminal.capture_since as cursor'),
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
 * Lets already-observable parser work and semantic frames commit before a read
 * tool reports.
 *
 * A screen revision lands before the semantic revision that belongs to it (the
 * tree arrives on the socket, the render-commit marker in the byte stream).
 * Once either half or an open frame is visible, the driver owns the causal
 * boundary and this wait cannot catch the pair mid-flight. Before either signal
 * arrives, screen-only output is indistinguishable from output that a future
 * semantic frame will describe. Callers that require that future semantic
 * state must wait for its explicit condition (for example `focused`) rather
 * than infer it from a screen-text wait. This does not require global silence,
 * so an unrelated spinner cannot block a snapshot of an already committed
 * frame.
 */
async function settleSemantics(entry: TerminalEntry): Promise<void> {
  const deadline = performance.now() + FIRST_TREE_SETTLE_MS;
  const contract = await entry.harness.settled({ timeout: FIRST_TREE_SETTLE_MS });
  if (contract.capabilities['semantic-tree'].status !== 'supported') return;
  await entry.harness.waitForCommittedObservation({
    timeout: Math.max(0, deadline - performance.now()),
  });
}

/** Budget for a session that has never published a tree. */
const FIRST_TREE_SETTLE_MS = 2_000;

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
  const record = context.terminals.record(entry);
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
  options: {
    readonly maxNodes?: number;
    readonly maxRows?: number;
    readonly includeText?: boolean;
  } = {},
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

function semanticLocatorFor(entry: TerminalEntry, args: TargetInput) {
  const locator = locatorFor(entry, args);
  if (locator.domain !== 'semantic') {
    throw usageError(
      'this action requires a semantic target; a screen locator was provided',
      'use role, selector, testId, label or semantic text',
    );
  }
  return locator;
}

/** The crash the driver recorded for this terminal, if the child died on its own. */
function crashOf(entry: TerminalEntry): ReturnType<typeof describeCrash> | undefined {
  const report = entry.harness.crashReport();
  return report === null ? undefined : describeCrash(report);
}

/** `{ ok: true }` receipt fields shared by the acting tools. */
const receiptFields = {
  ok: z.literal(true),
  terminal: z.string(),
  revision: z.number().int(),
};

const plannedActionSchema = z.object({
  actionId: z.string(),
  kind: z.string(),
  strategy: z.string(),
  contractId: z.string(),
  beforeSequence: z.number().int(),
  afterSequence: z.number().int(),
  operations: z.array(
    z.object({
      device: z.enum(['keyboard', 'mouse']),
      kind: z.string(),
      modifiers: z.array(z.enum(['shift', 'alt', 'control'])).optional(),
    }),
  ),
  requirements: z.array(
    z.object({
      kind: z.enum(CONDITION_KINDS),
      target: z.string().optional(),
      verdict: z.enum(['satisfied', 'unsatisfied', 'inconclusive']),
      observation: z.enum(['known', 'absent', 'unknown', 'unsupported']),
      evidence: evidenceProvenanceSchema.optional(),
    }),
  ),
  physicalEvidence: evidenceProvenanceSchema.optional(),
});

function plannedAction(value: ActionReceipt) {
  return {
    actionId: value.plan.actionId,
    kind: value.intent.kind,
    strategy: value.plan.strategy,
    contractId: value.plan.contractId,
    beforeSequence: value.before.sequence,
    afterSequence: value.after.sequence,
    operations: value.executed.map((operation) => ({
      device: operation.device,
      kind: operation.kind,
      ...(operation.device === 'mouse' && operation.modifiers !== undefined
        ? { modifiers: [...operation.modifiers] }
        : {}),
    })),
    requirements: value.plan.requirements.map((requirement) => ({
      kind: requirement.condition.kind,
      ...('target' in requirement.condition ? { target: requirement.condition.target } : {}),
      verdict: requirement.verdict,
      observation: requirement.observation.status,
      ...('evidence' in requirement.observation
        ? { evidence: requirement.observation.evidence }
        : {}),
    })),
    ...(value.plan.physicalRegion === undefined
      ? {}
      : { physicalEvidence: value.plan.physicalRegion.evidence }),
  };
}

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
    'snapshot. The child gets a minimal environment unless envMode is "inherit"; values passed ' +
    'in env are never echoed back.',
  inputSchema: {
    command: z
      .array(z.string())
      .min(1)
      .describe('argv, e.g. ["node", "app.js"] — no shell is involved'),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional().describe('extra environment for the child'),
    envMode: z
      .enum(['replace', 'inherit'])
      .optional()
      .describe(
        'default "replace": the child gets PATH, HOME, LANG, LC_ALL, SHELL, TMPDIR, USER, TERM ' +
          'plus env. "inherit" hands it the whole server environment',
      ),
    columns: z.number().int().min(1).max(1000).optional().describe('default 100'),
    rows: z.number().int().min(1).max(1000).optional().describe('default 30'),
    scrollbackLines: z.number().int().min(0).max(100_000).optional(),
    semanticNegotiationMs: z.number().int().min(0).max(60_000).optional(),
    logs: z
      .array(
        z.object({
          path: z.string().min(1).describe('log file to follow for the life of the session'),
          label: z.string().optional().describe('short name shown on each entry'),
        }),
      )
      .max(8)
      .optional()
      .describe(
        'application log files to follow. An existing file is followed from its end, so a session ' +
          'never replays a previous run; a missing one is waited for',
      ),
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
    const entry = await context.terminals.launch(args);
    await settleSemantics(entry);
    const contract = await entry.harness.settled();
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
        semanticTree: treeState(contract.capabilities['semantic-tree'].status === 'supported'),
        columns: screen.columns,
        rows: screen.rows,
        ...(contract.framework === null
          ? {}
          : {
              adapter: {
                name: contract.framework.name,
                version: contract.framework.adapterVersion,
              },
            }),
        capabilities: Object.entries(contract.capabilities)
          .filter(([, value]) => value.status === 'supported')
          .map(([key]) => key),
        platform: contract.terminal.platform,
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
    crash: crashSchema.optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    await settleSemantics(entry);
    const contract = await entry.harness.settled();
    const semanticTree = contract.capabilities['semantic-tree'].status === 'supported';
    const supported = Object.entries(contract.capabilities)
      .filter(([, value]) => value.status === 'supported')
      .map(([key]) => key);
    const crash = crashOf(entry);
    const screen = entry.harness.screen();
    const semantic = entry.harness.semanticTree();
    return {
      text:
        `Terminal ${entry.id} ${screen.columns}x${screen.rows} revision ${screen.revision}\n` +
        `semanticTree: ${semanticTree ? 'available' : 'unavailable'}\n` +
        `adapter: ${contract.framework === null ? 'none' : `${contract.framework.name} ${contract.framework.adapterVersion}`}\n` +
        `capabilities: ${supported.join(', ') || 'none'}\n` +
        `platform: ${contract.terminal.platform}` +
        (crash === undefined ? '' : `\n${renderCrash(crash)}`),
      data: {
        terminal: entry.id,
        revision: screen.revision,
        semanticRevision: semantic?.revision ?? null,
        semanticTree: treeState(semanticTree),
        columns: screen.columns,
        rows: screen.rows,
        ...(contract.framework === null
          ? {}
          : {
              adapter: {
                name: contract.framework.name,
                version: contract.framework.adapterVersion,
              },
            }),
        capabilities: supported,
        platform: contract.terminal.platform,
        ...(crash === undefined ? {} : { crash }),
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
    screenshot: z
      .boolean()
      .optional()
      .describe('also attach a PNG of the screen, rendered without a browser'),
    screenshotScale: z
      .number()
      .min(0.1)
      .max(3)
      .optional()
      .describe('pixel density of the PNG; default 1, 2 is retina-sharp'),
    screenshotTheme: z.enum(['dark', 'light']).optional().describe('PNG background; default dark'),
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
    screenshot: screenshotSchema.optional(),
    crash: crashSchema.optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
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
      dumpPath = await context.terminals.writeDump(
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
    const crash = crashOf(entry);
    const image =
      args.screenshot === true
        ? renderScreenshot(screen, {
            scale: args.screenshotScale,
            theme: args.screenshotTheme,
            semantic,
          })
        : undefined;
    const trailer = [
      ...(dumpPath === undefined ? [] : [`full dump: ${dumpPath}`]),
      ...(crash === undefined ? [] : [renderCrash(crash)]),
    ];
    return {
      text: trailer.length === 0 ? compact : `${compact}\n${trailer.join('\n')}`,
      ...(image === undefined ? {} : { images: [image] }),
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
        ...(image === undefined ? {} : { screenshot: describeImage(image) }),
        ...(crash === undefined ? {} : { crash }),
      },
    };
  },
});

const captureSince = defineTool({
  name: 'terminal.capture_since',
  title: 'What changed since a revision',
  description:
    'Incremental view: the screen rows that differ and the semantic subtrees that were added, ' +
    'removed or updated in the latest committed semantic tree since the given cursor. A screen ' +
    'change alone does not imply a future semantic commit; wait for an explicit semantic state ' +
    'when the caller requires one. The cursor must be a revision this server ' +
    'handed out earlier (snapshot or capture_since); older cursors fail with history-truncated.',
  inputSchema: {
    terminal: terminalId,
    cursor: z.number().int().min(0).describe('revision returned by an earlier snapshot'),
    maxRows: z.number().int().min(1).max(10_000).optional(),
    maxSubtrees: z.number().int().min(1).max(1_000).optional(),
    maxLogs: z
      .number()
      .int()
      .min(0)
      .max(500)
      .optional()
      .describe(
        `application log entries to return; default ${LOG_LIMITS.maxPerResponse}, 0 to skip`,
      ),
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
    logs: z.array(logEntrySchema),
    logsOmitted: z
      .number()
      .int()
      .describe('entries dropped between the cursor and the oldest one still buffered'),
    logCursor: z.number().int().describe('newest log sequence seen; advances with every capture'),
    compact: z.string(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    await settleSemantics(entry);
    const before = context.terminals.baseline(entry, args.cursor);
    const after = context.terminals.record(entry);
    const rowLimit = args.maxRows ?? 200;
    const subtreeLimit = args.maxSubtrees ?? 100;
    const changedRows = diffRows(before.rows, after.rows).slice(0, rowLimit);
    const changedSubtrees = diffSemantic(before.semantic, after.semantic).slice(0, subtreeLimit);
    // Logs resume from the sequence the baseline capture recorded, so the two
    // views of "since the cursor" — screen and log — line up.
    const logs = entry.logs.since(before.logSeq, args.maxLogs ?? LOG_LIMITS.maxPerResponse);

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
    lines.push(renderLogs(logs));
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
        logs: logs.entries.map((log) => ({ ...log })),
        logsOmitted: logs.omitted,
        logCursor: logs.cursor,
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
    const entry = context.terminals.get(args.terminal);
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

function pointerTool(
  name: 'terminal.click' | 'terminal.double_click' | 'terminal.hover',
): ToolDefinition {
  const double = name === 'terminal.double_click';
  const hover = name === 'terminal.hover';
  return defineTool({
    name,
    title: hover ? 'Hover a target' : double ? 'Double-click a target' : 'Click a target',
    description:
      `Sends a real ${hover ? 'motion' : double ? 'double-click' : 'click'} mouse report through the pseudo-terminal. ` +
      'Fails closed with input-mode-disabled when the required tracking mode or encoding is disabled or unobservable.',
    inputSchema: {
      terminal: terminalId,
      ...targetShape,
      button: buttonSchema.optional(),
      modifiers: mouseModifiersSchema,
      position: z
        .object({ rowOffset: z.number().int(), columnOffset: z.number().int() })
        .optional()
        .describe('offset inside the target rectangle'),
      timeout: timeoutMs.optional(),
    },
    outputSchema: { ...receiptFields, ref: z.string(), action: plannedActionSchema },
    handler: async (context, args) => {
      const entry = context.terminals.get(args.terminal);
      const locator = semanticLocatorFor(entry, args);
      const target = await locator.resolve(optionalTimeout(args.timeout));
      const options = {
        ...optionalTimeout(args.timeout),
        ...(args.button === undefined ? {} : { button: args.button }),
        ...(args.modifiers === undefined ? {} : { modifiers: args.modifiers }),
        ...(args.position === undefined ? {} : { position: args.position }),
      };
      const action = hover
        ? await locator.hover(options)
        : double
          ? await locator.doubleClick(options)
          : await locator.click(options);
      return {
        text: `${hover ? 'hovered' : double ? 'double-clicked' : 'clicked'} ref=${target.ref}`,
        data: { ...receipt(entry), ref: target.ref, action: plannedAction(action) },
      };
    },
  });
}

const press = defineTool({
  name: 'terminal.press',
  title: 'Press keys',
  description:
    'Sends key chords as real bytes, honouring the modes the program enabled (application cursor ' +
    'keys, keypad). Examples: "Enter", "Escape", "Control+K Control+U". With a target, the node must already be focused.',
  inputSchema: {
    terminal: terminalId,
    keys: z.string().min(1).describe('space-separated chords, e.g. "Control+A Home"'),
    ...targetShape,
    timeout: timeoutMs.optional(),
  },
  outputSchema: { ...receiptFields, ref: z.string().optional() },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    if (hasTarget(args)) {
      const locator = semanticLocatorFor(entry, args);
      const target = await locator.resolve(optionalTimeout(args.timeout));
      await locator.press(args.keys, optionalTimeout(args.timeout));
      return {
        text: `pressed ${args.keys} on ref=${target.ref}`,
        data: { ...receipt(entry), ref: target.ref },
      };
    }
    await entry.harness.press(args.keys);
    return { text: `pressed ${args.keys}`, data: receipt(entry) };
  },
});

const type = defineTool({
  name: 'terminal.type',
  title: 'Type text',
  description:
    'Types text as individual keystrokes (not a paste). With a target, the node must already be focused; use terminal.fill for focus + replacement.',
  inputSchema: {
    terminal: terminalId,
    text: z.string(),
    ...targetShapeWithoutText,
    timeout: timeoutMs.optional(),
  },
  outputSchema: { ...receiptFields, ref: z.string().optional() },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    if (hasTarget(args)) {
      const locator = semanticLocatorFor(entry, args);
      const target = await locator.resolve(optionalTimeout(args.timeout));
      await locator.type(args.text, optionalTimeout(args.timeout));
      return { text: `typed into ref=${target.ref}`, data: { ...receipt(entry), ref: target.ref } };
    }
    await entry.harness.type(args.text);
    return { text: `typed ${args.text.length} characters`, data: receipt(entry) };
  },
});

const fill = defineTool({
  name: 'terminal.fill',
  title: 'Fill a semantic control',
  description:
    'Ensures the semantic control receives focus through the real input path, selects its current value, and types the replacement.',
  inputSchema: {
    terminal: terminalId,
    text: z.string(),
    ...targetShapeWithoutText,
    timeout: timeoutMs.optional(),
  },
  outputSchema: { ...receiptFields, ref: z.string(), action: plannedActionSchema },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    const locator = semanticLocatorFor(entry, args);
    const target = await locator.resolve(optionalTimeout(args.timeout));
    const action = await locator.fill(args.text, optionalTimeout(args.timeout));
    return {
      text: `filled ref=${target.ref}`,
      data: { ...receipt(entry), ref: target.ref, action: plannedAction(action) },
    };
  },
});

function checkedTool(kind: 'check' | 'uncheck'): ToolDefinition {
  return defineTool({
    name: `terminal.${kind}`,
    title: kind === 'check' ? 'Check a semantic control' : 'Uncheck a semantic control',
    description: `Uses the central action planner and real terminal input to ${kind} a checkbox or radio, then verifies semantic state.`,
    inputSchema: { terminal: terminalId, ...targetShapeWithoutText, timeout: timeoutMs.optional() },
    outputSchema: { ...receiptFields, ref: z.string(), action: plannedActionSchema },
    handler: async (context, args) => {
      const entry = context.terminals.get(args.terminal);
      const locator = semanticLocatorFor(entry, args);
      const target = await locator.resolve(optionalTimeout(args.timeout));
      const action =
        kind === 'check'
          ? await locator.check(optionalTimeout(args.timeout))
          : await locator.uncheck(optionalTimeout(args.timeout));
      return {
        text: `${kind === 'check' ? 'checked' : 'unchecked'} ref=${target.ref}`,
        data: { ...receipt(entry), ref: target.ref, action: plannedAction(action) },
      };
    },
  });
}

const actionability = defineTool({
  name: 'terminal.actionability',
  title: 'Explain a semantic action',
  description:
    'Runs the same ActionPlanner used by execution, but sends no input. Reports every authoritative requirement and the chosen strategy or typed rejection.',
  inputSchema: {
    terminal: terminalId,
    ...targetShapeWithoutText,
    action: z.enum([
      'click',
      'double-click',
      'hover',
      'focus',
      'activate',
      'press',
      'type',
      'fill',
      'check',
      'uncheck',
    ]),
    value: z.string().optional(),
    timeout: timeoutMs.optional(),
  },
  outputSchema: {
    terminal: z.string(),
    ref: z.string(),
    actionable: z.boolean(),
    strategy: z.string().optional(),
    reason: z
      .object({ code: z.string(), message: z.string(), targetRef: z.string().optional() })
      .optional(),
    requirements: z.array(
      z.object({
        kind: z.enum(CONDITION_KINDS),
        target: z.string().optional(),
        verdict: z.enum(['satisfied', 'unsatisfied', 'inconclusive']),
        observation: z.enum(['known', 'absent', 'unknown', 'unsupported']),
        evidence: evidenceProvenanceSchema.optional(),
      }),
    ),
    contractId: z.string(),
    sequence: z.number().int(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    const locator = locatorFor(entry, args);
    const target = await locator.resolve(optionalTimeout(args.timeout));
    const pointerAction =
      args.action === 'click' || args.action === 'double-click' || args.action === 'hover';
    if (locator.domain === 'screen' && !pointerAction) {
      throw usageError(
        `${args.action} requires a semantic locator; screen locators only support physical pointer actions`,
      );
    }
    const explanation =
      locator.domain === 'screen'
        ? await locator.actionability(
            args.action as 'click' | 'double-click' | 'hover',
            optionalTimeout(args.timeout),
          )
        : await locator.actionability(args.action, {
            ...optionalTimeout(args.timeout),
            ...(args.value === undefined ? {} : { value: args.value }),
          });
    const requirements = explanation.requirements.map((requirement) => ({
      kind: requirement.condition.kind,
      ...('target' in requirement.condition ? { target: requirement.condition.target } : {}),
      verdict: requirement.verdict,
      observation: requirement.observation.status,
      ...('evidence' in requirement.observation
        ? { evidence: requirement.observation.evidence }
        : {}),
    }));
    return {
      text: explanation.actionable
        ? `${args.action} is actionable via ${explanation.strategy ?? 'planned input'}`
        : `${args.action} is not actionable: ${explanation.reason?.message ?? 'inconclusive requirements'}`,
      data: {
        terminal: entry.id,
        ref: target.ref,
        actionable: explanation.actionable,
        ...(explanation.strategy === undefined ? {} : { strategy: explanation.strategy }),
        ...(explanation.reason === undefined ? {} : { reason: explanation.reason }),
        requirements,
        contractId: explanation.checkpoint.contractId,
        sequence: explanation.checkpoint.sequence,
      },
    };
  },
});

const checkpoint = defineTool({
  name: 'terminal.checkpoint',
  title: 'Capture an observation checkpoint',
  description:
    'Returns the atomic session/contract/screen/semantic identity used by revision-safe actions and waits.',
  inputSchema: { terminal: terminalId },
  outputSchema: {
    terminal: z.string(),
    sessionId: z.string(),
    contractId: z.string(),
    epoch: z.number().int(),
    sequence: z.number().int(),
    screenRevision: z.number().int(),
    semanticRevision: z.number().int().nullable(),
    pairedScreenRevision: z.number().int().nullable(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    const value = entry.harness.checkpoint();
    return { text: `checkpoint ${value.sequence}`, data: { terminal: entry.id, ...value } };
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
    const entry = context.terminals.get(args.terminal);
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
    const entry = context.terminals.get(args.terminal);
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
    modifiers: mouseModifiersSchema,
  },
  outputSchema: receiptFields,
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    const source = locatorFor(entry, args);
    if (args.toTarget !== undefined) {
      const destination = locatorFor(entry, args.toTarget);
      if (source.domain !== destination.domain) {
        throw usageError('drag source and destination belong to different locator domains');
      }
      if (source.domain === 'semantic' && destination.domain === 'semantic')
        await source.dragTo(destination, {
          ...optionalTimeout(args.timeout),
          ...(args.modifiers === undefined ? {} : { modifiers: args.modifiers }),
        });
      else if (source.domain === 'screen' && destination.domain === 'screen')
        await source.dragTo(destination, {
          ...optionalTimeout(args.timeout),
          ...(args.modifiers === undefined ? {} : { modifiers: args.modifiers }),
        });
      return { text: 'dragged to target', data: receipt(entry) };
    }
    if (args.from === undefined || args.to === undefined) {
      throw usageError('drag needs either toTarget, or both from and to');
    }
    await entry.harness.mouse.drag({
      from: args.from,
      to: args.to,
      ...(args.modifiers === undefined ? {} : { modifiers: args.modifiers }),
    });
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
    modifiers: mouseModifiersSchema,
  },
  outputSchema: receiptFields,
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    await locatorFor(entry, args).wheel({
      deltaY: args.deltaY,
      ...(args.deltaX === undefined ? {} : { deltaX: args.deltaX }),
      ...(args.modifiers === undefined ? {} : { modifiers: args.modifiers }),
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
    const entry = context.terminals.get(args.terminal);
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
    const entry = context.terminals.get(args.terminal);
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
    const entry = context.terminals.get(args.terminal);
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
    const entry = context.terminals.get(args.terminal);
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
    const entry = context.terminals.get(args.terminal);
    const text = entry.harness.selection.copy();
    if (args.clear === true) entry.harness.selection.clear();
    return { text, data: { terminal: entry.id, text } };
  },
});

const waitFor = defineTool({
  name: 'terminal.wait_for',
  title: 'Wait for a condition',
  description:
    'Revision-driven waits — never a sleep. "text"/"title" wait for content, locator states use ' +
    'the driver\'s canonical Conditions, "quiet" explicitly waits for heuristic silence, ' +
    '"render" for a render after a given revision, "exit" for the child to exit.',
  inputSchema: {
    terminal: terminalId,
    wait: z.enum([
      'text',
      'title',
      'visible',
      'hidden',
      'attached',
      'detached',
      'displayed',
      'offscreen',
      'focused',
      'enabled',
      'disabled',
      'checked',
      'selected',
      'expanded',
      'collapsed',
      'quiet',
      'shell-prompt',
      'render',
      'exit',
    ]),
    text: z
      .string()
      .optional()
      .describe('for wait="text"; "/pattern/flags" is a regular expression'),
    title: z.string().optional().describe('for wait="title"'),
    ...targetShapeWithoutText,
    quietMs: z.number().int().min(0).optional().describe('for wait="quiet"'),
    after: z.number().int().min(0).optional().describe('for wait="render": the revision to beat'),
    timeout: timeoutMs.optional(),
  },
  outputSchema: {
    ...receiptFields,
    wait: z.string(),
    exit: exitSchema.optional(),
  },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
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
      case 'attached':
      case 'detached':
      case 'displayed':
      case 'offscreen': {
        await locatorFor(entry, args).waitFor({ state: args.wait, ...timeout });
        break;
      }
      case 'focused':
      case 'enabled':
      case 'disabled':
      case 'checked':
      case 'selected':
      case 'expanded':
      case 'collapsed': {
        await semanticLocatorFor(entry, args).waitFor({ state: args.wait, ...timeout });
        break;
      }
      case 'quiet': {
        await entry.harness.waitForQuiet({
          ...(args.quietMs === undefined ? {} : { quietMs: args.quietMs }),
          ...timeout,
        });
        break;
      }
      case 'shell-prompt': {
        await entry.harness.waitForShellPrompt(timeout);
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
    const entry = await context.terminals.close(args.terminal);
    return {
      text: `closed ${entry.id}`,
      data: { ok: true as const, terminal: entry.id, exit: entry.exit },
    };
  },
});

/** The live-terminal tools, in the order CONTRACTS.md §MCP lists them. */
export const TERMINAL_TOOLS: readonly ToolDefinition[] = Object.freeze([
  launch,
  capabilities,
  snapshot,
  captureSince,
  query,
  checkpoint,
  actionability,
  pointerTool('terminal.click'),
  pointerTool('terminal.double_click'),
  pointerTool('terminal.hover'),
  press,
  type,
  fill,
  checkedTool('check'),
  checkedTool('uncheck'),
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

export { stateFilter, targetShape, toRefEntry };
export type { ToolContext, ToolDefinition, ToolOutcome };
