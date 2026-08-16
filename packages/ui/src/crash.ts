/**
 * The crash section of a `.twtrace`, validated for display.
 *
 * `meta.crash` is written by whoever recorded the archive — a CI job, an older
 * version of the writer, a file someone edited. The viewer treats it as
 * external data: {@link parseCrash} returns `null` for anything it cannot make
 * sense of, and the UI then shows no crash panel. A malformed section must cost
 * a panel, never the whole app, because the archive around it is still the thing
 * the user came to look at.
 *
 * Everything that survives validation is also bounded. A `screenTail` of a
 * million rows is a rendering problem, not a report.
 *
 * @packageDocumentation
 */

/** Maximum rows of screen tail kept for display. */
const MAX_TAIL_ROWS = 500;
/** Maximum characters kept per row. */
const MAX_ROW_LENGTH = 4_096;
/** Maximum remembered inputs kept for the table. */
const MAX_INPUTS = 100;
/** Maximum diagnostics kept for the list. */
const MAX_DIAGNOSTICS = 200;

/**
 * The warning that sits above the screen tail.
 *
 * Byte-identical to the one `@termwright/trace` puts in the HTML report: the
 * same artefact should read the same way wherever it is shown, and this is the
 * sentence that tells a reader what they are about to paste into a ticket.
 */
export const CRASH_TAIL_WARNING =
  'Not redacted — this is what the terminal showed, verbatim, secrets included. ' +
  'Treat this report like a screenshot when storing or forwarding it.';

/** How the process ended. */
export interface CrashExitView {
  readonly code: number | null;
  readonly signal: string | null;
}

/** One remembered input. */
export interface CrashInputView {
  readonly timeMs: number;
  readonly kind: string;
  readonly bytes: number;
  /** Absent for pastes, which are never previewed. */
  readonly preview?: string;
}

/** One diagnostics entry. */
export interface CrashDiagnosticView {
  readonly code: string;
  readonly detail: string;
  readonly timeMs: number;
  readonly revision?: number;
}

/** A validated, bounded crash section, ready to render. */
export interface CrashView {
  /** Wall-clock offset from the start of recording, in milliseconds. */
  readonly t: number;
  /** Position on the cast timeline — where the marker goes, and what to seek. */
  readonly castOffset: number;
  readonly exit: CrashExitView;
  /** `signal SIGSEGV`, `exit code 1`. */
  readonly cause: string;
  readonly screenTail: readonly string[];
  /** True when rows were dropped to stay within the display bound. */
  readonly screenTailTruncated: boolean;
  readonly lastSemanticRevision: number | null;
  readonly recentInputs: readonly CrashInputView[];
  readonly diagnosticsTail: readonly CrashDiagnosticView[];
}

/**
 * Validates and bounds `meta.crash`.
 *
 * @returns the view, or `null` when the section is absent or unusable. The two
 * required fields are `castOffset` (there is nowhere to put the marker without
 * it) and `exit` (a crash with no cause is not a crash report); everything else
 * degrades to an empty list.
 *
 * @example
 * ```ts
 * const crash = parseCrash(reader.meta.crash);
 * if (crash !== null) console.error(crash.cause, crash.screenTail.join('\n'));
 * ```
 */
export function parseCrash(value: unknown): CrashView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const exit = parseExit(raw['exit']);
  if (exit === null) return null;
  const castOffset = finite(raw['castOffset']);
  if (castOffset === null) return null;

  const tail = strings(raw['screenTail']);
  return {
    t: finite(raw['t']) ?? castOffset,
    castOffset,
    exit,
    cause: describeCrashCause(exit),
    screenTail: tail.slice(-MAX_TAIL_ROWS).map((row) => row.slice(0, MAX_ROW_LENGTH)),
    screenTailTruncated: tail.length > MAX_TAIL_ROWS,
    lastSemanticRevision: finite(raw['lastSemanticRevision']),
    recentInputs: parseInputs(raw['recentInputs']),
    diagnosticsTail: parseDiagnostics(raw['diagnosticsTail']),
  };
}

/** `signal SIGSEGV`, `exit code 1`, `exit code unknown`. */
export function describeCrashCause(exit: CrashExitView): string {
  if (exit.signal !== null) return `signal ${exit.signal}`;
  return `exit code ${exit.code === null ? 'unknown' : String(exit.code)}`;
}

function parseExit(value: unknown): CrashExitView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const code = raw['code'];
  const signal = raw['signal'];
  const validCode = typeof code === 'number' && Number.isFinite(code);
  const validSignal = typeof signal === 'string' && signal !== '';
  if (!validCode && !validSignal) return null;
  return { code: validCode ? code : null, signal: validSignal ? signal : null };
}

function parseInputs(value: unknown): CrashInputView[] {
  if (!Array.isArray(value)) return [];
  const out: CrashInputView[] = [];
  for (const entry of value.slice(-MAX_INPUTS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const kind = raw['kind'];
    const preview = raw['preview'];
    out.push({
      timeMs: finite(raw['timeMs']) ?? 0,
      kind: typeof kind === 'string' ? kind : 'unknown',
      bytes: finite(raw['bytes']) ?? 0,
      ...(typeof preview === 'string' ? { preview: preview.slice(0, MAX_ROW_LENGTH) } : {}),
    });
  }
  return out;
}

function parseDiagnostics(value: unknown): CrashDiagnosticView[] {
  if (!Array.isArray(value)) return [];
  const out: CrashDiagnosticView[] = [];
  for (const entry of value.slice(-MAX_DIAGNOSTICS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const code = raw['code'];
    const detail = raw['detail'];
    if (typeof code !== 'string') continue;
    const revision = finite(raw['revision']);
    out.push({
      code,
      detail: typeof detail === 'string' ? detail.slice(0, MAX_ROW_LENGTH) : '',
      timeMs: finite(raw['timeMs']) ?? 0,
      ...(revision === null ? {} : { revision }),
    });
  }
  return out;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
