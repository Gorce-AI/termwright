import { z } from 'zod';
import { defineTool } from './tool-kit.js';
import { waitForCondition, waitInputSchema, type WaitRequest } from './tools.js';
import type { TerminalEntry } from './sessions.js';

const { timeout: _timeout, ...watchConditionSchema } = waitInputSchema;
const watchId = z.string().regex(/^w[1-9]\d*$/u);

async function waitDurably(
  entry: TerminalEntry,
  request: Omit<WaitRequest, 'timeout'>,
  signal: AbortSignal,
): Promise<{ readonly exit?: { readonly code: number | null; readonly signal: string | null } }> {
  for (;;) {
    if (signal.aborted) throw signal.reason;
    try {
      return await waitForCondition(entry, { ...request, timeout: 600_000 }, signal);
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'timeout') throw error;
    }
  }
}

const start = defineTool({
  name: 'watch.start',
  title: 'Start a durable terminal watcher',
  description:
    'Starts a revision-driven wait owned by the MCP session. It keeps running when the initiating request ends; use watch.wait to receive its buffered result.',
  inputSchema: watchConditionSchema,
  outputSchema: {
    watchId,
    terminal: z.string(),
    startRevision: z.number().int(),
  },
  handler: async (context, args) => {
    const entry = context.terminals.get(args.terminal);
    const startRevision = entry.harness.screen().revision;
    const id = context.watchers.start(
      entry.id,
      startRevision,
      () => entry.harness.screen().revision,
      (signal) => waitDurably(entry, args, signal),
    );
    return {
      text: `watcher ${id} started at revision ${startRevision}`,
      data: { watchId: id, terminal: entry.id, startRevision },
    };
  },
});

const wait = defineTool({
  name: 'watch.wait',
  title: 'Wait for a durable watcher result',
  description:
    'Waits for the next buffered result. Cancelling or timing out this MCP request leaves the watcher alive; call watch.wait again with the same id.',
  inputSchema: { watchId },
  outputSchema: {
    watchId,
    status: z.enum(['matched', 'failed']),
    terminal: z.string(),
    startRevision: z.number().int(),
    revision: z.number().int(),
    exit: z.object({ code: z.number().int().nullable(), signal: z.string().nullable() }).optional(),
    error: z.string().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async (context, args, signal) => {
    const outcome = await context.watchers.wait(args.watchId, signal);
    return {
      text:
        outcome.status === 'matched'
          ? `watcher ${args.watchId} matched at revision ${outcome.revision}`
          : `watcher ${args.watchId} failed: ${outcome.error}`,
      data: { watchId: args.watchId, ...outcome },
    };
  },
});

const cancel = defineTool({
  name: 'watch.cancel',
  title: 'Cancel a durable watcher',
  description: 'Cancels and forgets a session-owned watcher.',
  inputSchema: { watchId },
  outputSchema: { watchId, cancelled: z.literal(true) },
  annotations: { destructiveHint: true },
  handler: async (context, args) => {
    context.watchers.cancel(args.watchId);
    return {
      text: `watcher ${args.watchId} cancelled`,
      data: { watchId: args.watchId, cancelled: true as const },
    };
  },
});

export const WATCH_TOOLS = Object.freeze([start, wait, cancel]);
