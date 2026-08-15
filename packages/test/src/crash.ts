/**
 * Crash reporting for failing tests.
 *
 * When a program dies unexpectedly, the assertion that failed is rarely the
 * interesting part: `toBeVisible` timing out is a symptom, and the panic the
 * program printed on its way out is the cause. The driver keeps that context in
 * {@link CrashReport}; this module renders it into the failure message and
 * bounds it for the HTML report.
 */

import type { CrashReport, TerminalHarness } from '@termwright/driver';

/** Lines of terminal output shown inline in a failure message. */
export const MESSAGE_TAIL_LINES = 15;

/** Lines carried to the HTML report, where there is room to scroll. */
export const REPORT_TAIL_LINES = 200;

/** Inputs shown inline; the full list rides along to the report. */
const MESSAGE_INPUTS = 3;

/**
 * A crash as it travels to the reporter: plain JSON, bounded, and free of the
 * semantic tree (the trace already stores every revision).
 */
export interface ReportCrash {
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly screenTail: readonly string[];
  readonly recentInputs?: readonly {
    readonly timeMs: number;
    readonly kind: 'key' | 'mouse' | 'paste' | 'raw';
    readonly bytes: number;
    readonly preview?: string;
  }[];
  readonly diagnostics?: readonly {
    readonly code: string;
    readonly detail: string;
    readonly timeMs: number;
  }[];
  readonly timeMs: number;
}

/** A crashed session, with wherever its trace was written. */
export interface CrashedSession {
  readonly report: CrashReport;
  /** Index among the sessions this test launched; only shown when several. */
  readonly index: number;
  readonly sessionId?: string;
  /** `.twtrace` directory, when the test was being traced. */
  readonly tracePath?: string;
}

/** The slice of a harness this module reads. */
export interface CrashSource {
  readonly sessionId: string;
  crashReport(): CrashReport | null;
}

/**
 * Collects the crash reports of the sessions that died.
 *
 * A session the test closed, or one that exited cleanly, reports nothing —
 * that filtering lives in the driver, so this stays a mapping.
 */
export function collectCrashes(
  sessions: readonly { readonly harness: CrashSource | TerminalHarness; readonly dir?: string | undefined }[],
): readonly CrashedSession[] {
  const crashed: CrashedSession[] = [];
  sessions.forEach((session, index) => {
    const report = session.harness.crashReport();
    if (report === null) return;
    crashed.push({
      report,
      index,
      sessionId: session.harness.sessionId,
      ...(session.dir === undefined ? {} : { tracePath: session.dir }),
    });
  });
  return crashed;
}

/**
 * Renders the `Process crashed` section appended to a failure message.
 *
 * @returns the section, or `''` when nothing crashed.
 */
export function formatCrashSection(crashes: readonly CrashedSession[]): string {
  if (crashes.length === 0) return '';
  const blocks = crashes.map((crash) => formatOne(crash, crashes.length > 1));
  return `\n\nProcess crashed\n${blocks.join('\n')}`;
}

function formatOne(crash: CrashedSession, numbered: boolean): string {
  const { report } = crash;
  const lines: string[] = [];
  const heading = numbered ? `session ${crash.index + 1} (${crash.sessionId ?? 'unknown'})` : undefined;
  if (heading !== undefined) lines.push(heading);

  lines.push(`  ${describeExit(report.exit)} after ${Math.round(report.timeMs)}ms`);

  const tail = report.screenTail;
  const shown = tail.slice(-MESSAGE_TAIL_LINES);
  if (shown.length > 0) {
    const label =
      tail.length > shown.length
        ? `  screen tail (last ${shown.length} of ${tail.length} lines):`
        : '  screen tail:';
    lines.push(label, ...shown.map((line) => `    ${line}`));
  }

  const inputs = report.recentInputs.slice(-MESSAGE_INPUTS);
  if (inputs.length > 0) {
    lines.push(`  last input: ${inputs.map(describeInput).join(', ')}`);
  }

  const diagnostic = report.diagnosticsTail.at(-1);
  if (diagnostic !== undefined) {
    lines.push(`  last diagnostic: ${diagnostic.code} — ${diagnostic.detail}`);
  }

  lines.push(
    crash.tracePath === undefined
      ? '  no trace was recorded for this session (trace mode is off)'
      : `  full trace: ${crash.tracePath}`,
  );
  return lines.join('\n');
}

/** `exited with code 1` / `killed by SIGSEGV`. */
export function describeExit(exit: { readonly code: number | null; readonly signal: string | null }): string {
  if (exit.signal !== null) return `killed by ${exit.signal}`;
  if (exit.code !== null) return `exited with code ${exit.code}`;
  return 'exited for an unknown reason';
}

function describeInput(input: { kind: string; bytes: number; preview?: string; timeMs: number }): string {
  const what = input.preview === undefined ? `${input.bytes} bytes` : JSON.stringify(input.preview);
  return `${input.kind} ${what} at ${Math.round(input.timeMs)}ms`;
}

/** An error object as the runner records it; only the message is touched. */
export interface FailureError {
  message?: string | undefined;
}

/**
 * Appends the crash section to every error the failing test recorded.
 *
 * The errors are mutated in place because the runner already owns them and
 * prints them itself; there is no supported way to hand it a different error
 * after the fact.
 *
 * @returns the number of errors that were annotated. Zero means the crash is
 * only visible through the reporter, which is why the crash also travels in
 * `task.meta` rather than living in the message alone.
 */
export function appendCrashSection(
  errors: readonly FailureError[] | undefined,
  crashes: readonly CrashedSession[],
): number {
  const section = formatCrashSection(crashes);
  if (section === '' || errors === undefined) return 0;
  let annotated = 0;
  for (const error of errors) {
    if (error.message?.includes('\nProcess crashed\n') === true) continue;
    error.message = `${error.message ?? ''}${section}`;
    annotated += 1;
  }
  return annotated;
}

/**
 * Bounds a crash report for the trip to the reporter.
 *
 * `lastSemanticTree` is dropped on purpose: every revision is already in the
 * trace's `semantics.jsonl`, and `task.meta` is serialized between processes
 * for every test.
 */
export function toReportCrash(report: CrashReport): ReportCrash {
  return {
    exit: { code: report.exit.code, signal: report.exit.signal },
    screenTail: report.screenTail.slice(-REPORT_TAIL_LINES),
    ...(report.recentInputs.length === 0
      ? {}
      : {
          recentInputs: report.recentInputs.map((input) => ({
            timeMs: input.timeMs,
            kind: input.kind,
            bytes: input.bytes,
            ...(input.preview === undefined ? {} : { preview: input.preview }),
          })),
        }),
    ...(report.diagnosticsTail.length === 0
      ? {}
      : {
          diagnostics: report.diagnosticsTail.map((entry) => ({
            code: entry.code,
            detail: entry.detail,
            timeMs: entry.timeMs,
          })),
        }),
    timeMs: report.timeMs,
  };
}
