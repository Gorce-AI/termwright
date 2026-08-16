/**
 * The command log: what the test did, in order.
 *
 * `events.jsonl` already holds it — steps, driver actions with their selector
 * and outcome, assertions — so a replay can show the same list Cypress shows,
 * built from the archive rather than from anything the UI had to record itself.
 * Live runs produce the same rows from `action` messages on the socket.
 *
 * Rows are validated on the way in and positioned on the **cast timeline**, so
 * clicking one seeks a replay to the moment it happened.
 *
 * @packageDocumentation
 */

/** What a row is. */
export type CommandKind = 'step' | 'action' | 'assert' | 'input';

/** One line of the command log. */
export interface CommandRow {
  /** Stable id, unique within a log. */
  readonly id: string;
  readonly kind: CommandKind;
  /** Position on the cast timeline, in milliseconds. */
  readonly t: number;
  /** `locator.click`, `toBeVisible`, or the step's title. */
  readonly label: string;
  readonly selector?: string;
  /** Resolved target, `n8@42` — the node and the revision it was resolved at. */
  readonly ref?: string;
  /** Absent for steps that never closed, and for inputs. */
  readonly ok?: boolean;
  readonly error?: string;
  /** The step this row belongs to, when the producer reported one. */
  readonly stepId?: string;
  /** Steps only: when the step ended, on the cast timeline. */
  readonly endT?: number;
  /** Nesting depth: actions inside a step are one level in. */
  readonly depth: number;
}

/** Maximum rows kept for display. */
const MAX_ROWS = 5_000;
/** Longest string kept on a row. */
const MAX_TEXT = 2_048;

/**
 * Builds the log from `events.jsonl` entries.
 *
 * Steps become groups: a `step-start` opens one, and the matching `step-end`
 * closes it, carrying its outcome. Everything between them is nested inside.
 * Rows whose event cannot be read are skipped — the rest of the log is still
 * worth showing.
 */
export function buildCommandLog(events: Iterable<unknown>): readonly CommandRow[] {
  const rows: CommandRow[] = [];
  const open: { stepId: string; index: number }[] = [];
  let index = 0;

  for (const raw of events) {
    if (rows.length >= MAX_ROWS) break;
    const event = asObject(raw);
    if (event === null) continue;
    const kind = event['kind'];
    const t = position(event);
    if (t === null) continue;
    const depth = open.length;

    switch (kind) {
      case 'step-start': {
        const stepId = text(event['stepId']) ?? `step-${index}`;
        rows.push({
          id: `r${index}`,
          kind: 'step',
          t,
          label: text(event['title']) ?? 'step',
          stepId,
          depth,
        });
        open.push({ stepId, index: rows.length - 1 });
        break;
      }
      case 'step-end': {
        const stepId = text(event['stepId']);
        const openIndex = findOpen(open, stepId);
        if (openIndex === -1) break;
        const [entry] = open.splice(openIndex, 1);
        if (entry === undefined) break;
        const row = rows[entry.index];
        if (row === undefined) break;
        const status = text(event['status']);
        const failure = text(event['error']);
        rows[entry.index] = {
          ...row,
          endT: t,
          ...(status === undefined ? {} : { ok: status !== 'failed' }),
          ...(failure === undefined ? {} : { error: failure }),
        };
        break;
      }
      case 'action':
      case 'assert': {
        const api = text(event['api']);
        if (api === undefined) break;
        rows.push({
          id: `r${index}`,
          kind: kind === 'assert' ? 'assert' : 'action',
          t,
          label: api,
          depth,
          ...optional('selector', text(event['selector'])),
          ...optional('ref', text(event['ref'])),
          ...(typeof event['ok'] === 'boolean' ? { ok: event['ok'] } : {}),
          ...optional('error', text(event['error'])),
          ...optional('stepId', text(event['stepId']) ?? open.at(-1)?.stepId),
        });
        break;
      }
      case 'input': {
        const inputKind = text(event['inputKind']) ?? 'raw';
        rows.push({
          id: `r${index}`,
          kind: 'input',
          t,
          label: `input (${inputKind})`,
          depth,
          ...optional('stepId', open.at(-1)?.stepId),
        });
        break;
      }
      default:
        break;
    }
    index += 1;
  }

  rows.sort((left, right) => left.t - right.t);
  return rows;
}

/**
 * The row a replay is "on" at `timeMs` — the last one that had started.
 *
 * @param preferId - a row the user picked. Several rows can share a millisecond
 * (a step opening right after the assertion that preceded it), and when that
 * happens the one you clicked should be the one lit up, not whichever sorted
 * last.
 * @returns the index into `rows`, or `-1` before the first row.
 */
export function currentCommand(
  rows: readonly CommandRow[],
  timeMs: number,
  preferId?: string | null,
): number {
  let found = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined || row.t > timeMs) break;
    found = index;
  }
  if (preferId === undefined || preferId === null) return found;
  const preferred = rows.findIndex((row) => row.id === preferId);
  return preferred !== -1 && rows[preferred]?.t === rows[found]?.t ? preferred : found;
}

/** The next/previous action or assertion, for the arrow keys. */
export function stepCommand(
  rows: readonly CommandRow[],
  timeMs: number,
  direction: -1 | 1,
): CommandRow | undefined {
  const interesting = rows.filter((row) => row.kind === 'action' || row.kind === 'assert');
  if (direction === 1) return interesting.find((row) => row.t > timeMs + 1);
  return [...interesting].reverse().find((row) => row.t < timeMs - 1);
}

/** Splits `n8@42` into its node id and the revision it was resolved at. */
export function parseRef(ref: string): { nodeId: string; revision: number } | null {
  const match = /^([^@]+)@(\d+)$/.exec(ref);
  if (match === null) return null;
  const [, nodeId, revision] = match;
  if (nodeId === undefined || revision === undefined) return null;
  return { nodeId, revision: Number.parseInt(revision, 10) };
}

function findOpen(open: readonly { stepId: string }[], stepId: string | undefined): number {
  if (stepId === undefined) return open.length - 1; // innermost
  for (let index = open.length - 1; index >= 0; index -= 1) {
    if (open[index]?.stepId === stepId) return index;
  }
  return -1;
}

/**
 * Cast-timeline position. `castOffset` is required of every `events.jsonl`
 * line, so an event without one is an event this log cannot place and skips.
 */
function position(event: Record<string, unknown>): number | null {
  const castOffset = event['castOffset'];
  return typeof castOffset === 'number' && Number.isFinite(castOffset) ? castOffset : null;
}

function optional<K extends string>(key: K, value: string | undefined): Record<K, string> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value.slice(0, MAX_TEXT) : undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
