/**
 * Crash reports, projected for agents.
 *
 * When a program dies on its own — a signal, or a non-zero exit nobody asked
 * for — the driver keeps what the session knew at that moment: the exit status,
 * the tail of the screen (where a stack trace lands), the last semantic
 * revision, the inputs just before the end, and the diagnostics log. This module
 * bounds that for a tool result and renders it the way an agent reads it.
 *
 * **The screen tail is unredacted.** It is whatever the terminal displayed,
 * secrets included, so it is treated like a screenshot: bounded, never logged,
 * and flagged as sensitive wherever an agent is told about it.
 */
import { z } from 'zod';
import type { CrashReport } from '@termwright/driver';

/** How much of a crash report crosses the wire. */
export const CRASH_LIMITS = Object.freeze({
  /** Screen-tail lines kept, newest end of the buffer. */
  maxScreenTailLines: 40,
  /** Characters kept per screen-tail line. */
  maxLineChars: 500,
  /** Recent inputs kept, newest last. */
  maxInputs: 10,
  /** Diagnostics entries kept, newest last. */
  maxDiagnostics: 10,
});

/** The crash projection carried in `structuredContent`. */
export const crashSchema = z.object({
  exit: z.object({ code: z.number().int().nullable(), signal: z.string().nullable() }),
  timeMs: z.number(),
  screenTail: z
    .array(z.string())
    .describe('what the terminal showed at the end, verbatim and unredacted — treat as sensitive'),
  screenTailTruncated: z.boolean(),
  lastSemanticRevision: z.number().int().nullable(),
  recentInputs: z.array(
    z.object({
      timeMs: z.number(),
      kind: z.enum(['key', 'mouse', 'paste', 'raw']),
      bytes: z.number().int(),
      preview: z.string().optional().describe('omitted for pastes, which routinely carry secrets'),
    }),
  ),
  diagnostics: z.array(
    z.object({
      // A free string on purpose — do not "fix" this into an enum. Tolerant
      // reader, strict producer: the driver owns the closed code set and pins
      // it with its own tests, while this consumer must survive a code it has
      // never heard of. A closed enum here would let one unrecognised code
      // fail the whole crash report, at the moment it is needed most.
      code: z.string(),
      detail: z.string(),
      timeMs: z.number(),
      revision: z.number().int().optional(),
      mode: z
        .enum(['mouse', 'focus'])
        .optional()
        .describe('for "mode-unverifiable": which mode the platform hides'),
    }),
  ),
});

/** The structured shape of {@link crashSchema}. */
export type CrashProjection = z.output<typeof crashSchema>;

function boundLines(lines: readonly string[]): { lines: string[]; truncated: boolean } {
  const kept = lines.slice(-CRASH_LIMITS.maxScreenTailLines);
  return {
    lines: kept.map((line) =>
      line.length > CRASH_LIMITS.maxLineChars
        ? `${line.slice(0, CRASH_LIMITS.maxLineChars)}…`
        : line,
    ),
    truncated: kept.length < lines.length,
  };
}

/** Projects a driver {@link CrashReport} into the bounded agent-facing shape. */
export function describeCrash(report: CrashReport): CrashProjection {
  const tail = boundLines(report.screenTail);
  return {
    exit: { code: report.exit.code, signal: report.exit.signal },
    timeMs: report.timeMs,
    screenTail: tail.lines,
    screenTailTruncated: tail.truncated,
    lastSemanticRevision: report.lastSemanticTree?.revision ?? null,
    recentInputs: report.recentInputs.slice(-CRASH_LIMITS.maxInputs).map((input) => ({
      timeMs: input.timeMs,
      kind: input.kind,
      bytes: input.bytes,
      ...(input.preview === undefined ? {} : { preview: input.preview }),
    })),
    diagnostics: report.diagnosticsTail.slice(-CRASH_LIMITS.maxDiagnostics).map((entry) => ({
      code: entry.code,
      detail: entry.detail,
      timeMs: entry.timeMs,
      ...(entry.revision === undefined ? {} : { revision: entry.revision }),
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
    })),
  };
}

/**
 * Renders a crash the way it appears in a tool result's text: the exit first,
 * because that is the headline, then what was on screen when it happened.
 */
export function renderCrash(crash: CrashProjection): string {
  const lines = [
    `crash: the program exited on its own — code=${String(crash.exit.code)} signal=${String(crash.exit.signal)} at ${crash.timeMs}ms`,
  ];
  if (crash.recentInputs.length > 0) {
    const inputs = crash.recentInputs.map((input) =>
      input.preview === undefined
        ? `${input.kind}(${input.bytes}B)`
        : `${input.kind} ${JSON.stringify(input.preview)}`,
    );
    lines.push(`last input: ${inputs.join(' ')}`);
  }
  for (const entry of crash.diagnostics) {
    const mode = entry.mode === undefined ? '' : ` (${entry.mode})`;
    lines.push(`diagnostic ${entry.code}${mode}: ${entry.detail}`);
  }
  if (crash.screenTail.length > 0) {
    lines.push(crash.screenTailTruncated ? 'screen tail (truncated):' : 'screen tail:');
    lines.push(...crash.screenTail);
  }
  return lines.join('\n');
}

/**
 * An error that happened while a session was dying, carrying the crash the
 * driver recorded.
 *
 * The original failure keeps its kind and message — a `process-exited` stays a
 * `process-exited` — and the crash rides alongside, so an agent gets both "what
 * you asked for failed" and "here is why the program is gone".
 */
export class CrashContextError extends Error {
  override readonly cause: unknown;
  readonly crash: CrashProjection;

  constructor(cause: unknown, crash: CrashProjection) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'CrashContextError';
    this.cause = cause;
    this.crash = crash;
  }
}
