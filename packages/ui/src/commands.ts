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

import type { UiActionability, UiActionPlan } from './events.js';
import { CONDITION_KINDS } from '@termwright/protocol/action-model';

const CONDITION_KIND_SET: ReadonlySet<string> = new Set(CONDITION_KINDS);

/** What a row is. */
export type CommandKind = 'step' | 'action' | 'assert' | 'input';

/** One line of the command log. */
export interface CommandRow {
  /** Stable id, unique within a log. */
  readonly id: string;
  /** Correlates a live start row with its eventual completion. */
  readonly actionId?: string;
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
  readonly actionPlan?: UiActionPlan;
  readonly actionability?: UiActionability;
  /** The step this row belongs to, when the producer reported one. */
  readonly stepId?: string;
  /** Test that produced a live row. Archive rows already belong to one trace. */
  readonly testId?: string;
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
  const rawInputs = new Map<string, { readonly dataB64?: string; readonly inputKind: string }>();
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
          t: orderedTime(rows, t),
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
        const stepId = text(event['stepId']) ?? open.at(-1)?.stepId;
        // A driver action is reported after it has written to the PTY. The raw
        // input therefore immediately precedes `press`/`type`/`activate` in an
        // archive. Showing both as siblings makes one logical interaction look
        // like two unrelated commands (and puts the low-level implementation
        // detail first). Fold only the adjacent inputs into their high-level
        // action; truly raw writes with no following action stay visible.
        const consumed =
          kind === 'action' ? consumeTrailingInputs(rows, rawInputs, depth, stepId) : undefined;
        const actionPlan = kind === 'action' ? planFromReceipt(event['receipt']) : undefined;
        const actionability = kind === 'action' ? actionabilityFromTrace(event['actionability']) : undefined;
        rows.push({
          id: `r${index}`,
          kind: kind === 'assert' ? 'assert' : 'action',
          t: orderedTime(rows, consumed?.t ?? t),
          label: kind === 'action' ? describeAction(api, consumed?.inputs ?? []) : api,
          depth,
          ...optional('selector', text(event['selector'])),
          ...optional('ref', text(event['ref'])),
          ...(typeof event['ok'] === 'boolean' ? { ok: event['ok'] } : {}),
          ...optional('error', text(event['error'])),
          ...(actionPlan === undefined ? {} : { actionPlan }),
          ...(actionability === undefined ? {} : { actionability }),
          ...optional('stepId', stepId),
        });
        break;
      }
      case 'input': {
        const inputKind = text(event['inputKind']) ?? 'raw';
        const id = `r${index}`;
        rows.push({
          id,
          kind: 'input',
          t: orderedTime(rows, t),
          label: `input (${inputKind})`,
          depth,
          ...optional('stepId', open.at(-1)?.stepId),
        });
        rawInputs.set(id, { inputKind, ...optional('dataB64', text(event['dataB64'])) });
        break;
      }
      default:
        break;
    }
    index += 1;
  }

  return rows;
}

function actionabilityFromTrace(value: unknown): UiActionability | undefined {
  const explanation = asObject(value);
  const intent = asObject(explanation?.['intent']);
  const checkpoint = asObject(explanation?.['checkpoint']);
  const kind = text(intent?.['kind']);
  const contractId = text(checkpoint?.['contractId']);
  const sequence = finiteInteger(checkpoint?.['sequence']);
  const actionable = explanation?.['actionable'];
  const rawRequirements = explanation?.['requirements'];
  if (kind === undefined || contractId === undefined || sequence === undefined || typeof actionable !== 'boolean' || !Array.isArray(rawRequirements)) return undefined;
  const requirements: UiActionPlan['requirements'][number][] = [];
  for (const raw of rawRequirements.slice(0, 128)) {
    const requirement = asObject(raw);
    const condition = asObject(requirement?.['condition']);
    const observationValue = asObject(requirement?.['observation']);
    const requirementKind = text(condition?.['kind']);
    const target = text(condition?.['target']);
    const verdict = requirement?.['verdict'];
    const observation = observationValue?.['status'];
    if (requirementKind === undefined || !CONDITION_KIND_SET.has(requirementKind) || (verdict !== 'satisfied' && verdict !== 'unsatisfied' && verdict !== 'inconclusive') ||
        (observation !== 'known' && observation !== 'absent' && observation !== 'unknown' && observation !== 'unsupported')) return undefined;
    const evidence = evidenceFrom(observationValue?.['evidence']);
    requirements.push({ kind: requirementKind, ...(target === undefined ? {} : { target }), verdict, observation, ...(evidence === undefined ? {} : { evidence }) });
  }
  const strategy = text(explanation?.['strategy']);
  const rawReason = asObject(explanation?.['reason']);
  const reasonCode = text(rawReason?.['code']);
  const reasonMessage = text(rawReason?.['message']);
  const targetRef = text(rawReason?.['targetRef']);
  const reason = reasonCode === undefined || reasonMessage === undefined ? undefined : { code: reasonCode, message: reasonMessage, ...(targetRef === undefined ? {} : { targetRef }) };
  return { actionable, kind, contractId, sequence, requirements, ...(strategy === undefined ? {} : { strategy }), ...(reason === undefined ? {} : { reason }) };
}

function planFromReceipt(value: unknown): UiActionPlan | undefined {
  const receipt = asObject(value);
  const plan = asObject(receipt?.['plan']);
  const intent = asObject(receipt?.['intent']);
  const before = asObject(receipt?.['before']);
  const after = asObject(receipt?.['after']);
  const executed = receipt?.['executed'];
  const rawRequirements = plan?.['requirements'];
  const actionId = text(plan?.['actionId']);
  const kind = text(intent?.['kind']);
  const strategy = text(plan?.['strategy']);
  const contractId = text(plan?.['contractId']);
  const beforeSequence = finiteInteger(before?.['sequence']);
  const afterSequence = finiteInteger(after?.['sequence']);
  if (actionId === undefined || kind === undefined || strategy === undefined || contractId === undefined ||
      beforeSequence === undefined || afterSequence === undefined || !Array.isArray(executed) || !Array.isArray(rawRequirements)) return undefined;
  const operations: { device: 'keyboard' | 'mouse'; kind: string; modifiers?: readonly ('shift' | 'alt' | 'control')[] }[] = [];
  for (const raw of executed) {
    const operation = asObject(raw);
    const device = operation?.['device'];
    const operationKind = text(operation?.['kind']);
    if ((device !== 'keyboard' && device !== 'mouse') || operationKind === undefined) return undefined;
    const rawModifiers = operation?.['modifiers'];
    if (rawModifiers !== undefined && (device !== 'mouse' || !Array.isArray(rawModifiers) ||
        rawModifiers.some((modifier) => modifier !== 'shift' && modifier !== 'alt' && modifier !== 'control'))) return undefined;
    operations.push({
      device,
      kind: operationKind,
      ...(rawModifiers === undefined ? {} : { modifiers: rawModifiers as ('shift' | 'alt' | 'control')[] }),
    });
  }
  const requirements: UiActionPlan['requirements'][number][] = [];
  for (const raw of rawRequirements.slice(0, 128)) {
    const requirement = asObject(raw);
    const condition = asObject(requirement?.['condition']);
    const observationValue = asObject(requirement?.['observation']);
    const requirementKind = text(condition?.['kind']);
    const target = text(condition?.['target']);
    const verdict = requirement?.['verdict'];
    const observation = observationValue?.['status'];
    if (requirementKind === undefined || !CONDITION_KIND_SET.has(requirementKind) ||
        (verdict !== 'satisfied' && verdict !== 'unsatisfied' && verdict !== 'inconclusive') ||
        (observation !== 'known' && observation !== 'absent' && observation !== 'unknown' && observation !== 'unsupported')) return undefined;
    const requirementEvidence = evidenceFrom(observationValue?.['evidence']);
    requirements.push({ kind: requirementKind, ...(target === undefined ? {} : { target }), verdict, observation, ...(requirementEvidence === undefined ? {} : { evidence: requirementEvidence }) });
  }
  const physicalRegion = asObject(plan?.['physicalRegion']);
  const physicalEvidence = evidenceFrom(physicalRegion?.['evidence']);
  return { actionId, kind, strategy, contractId, beforeSequence, afterSequence, operations, requirements, ...(physicalEvidence === undefined ? {} : { physicalEvidence }) };
}

function evidenceFrom(value: unknown): UiActionPlan['physicalEvidence'] | undefined {
  const record = asObject(value);
  if (record === undefined || record === null) return undefined;
  const source = record['source'];
  const method = record['method'];
  const strength = record['strength'];
  const providerId = text(record['providerId']);
  if ((source !== 'framework' && source !== 'application' && source !== 'terminal' && source !== 'recognizer' && source !== 'driver') ||
      (method !== 'native' && method !== 'instrumented' && method !== 'declared' && method !== 'correlated' && method !== 'measured' && method !== 'derived' && method !== 'heuristic') ||
      (strength !== 'authoritative' && strength !== 'diagnostic') || providerId === undefined) return undefined;
  return { source, method, strength, providerId };
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** Preserve semantic event order even when two producer clocks differ by a
 * few milliseconds. A child cannot appear before the step that contains it. */
function orderedTime(rows: readonly CommandRow[], timeMs: number): number {
  return Math.max(timeMs, rows.at(-1)?.t ?? 0);
}

interface ConsumedInputs {
  readonly t: number;
  readonly inputs: readonly { readonly dataB64?: string; readonly inputKind: string }[];
}

function consumeTrailingInputs(
  rows: CommandRow[],
  rawInputs: ReadonlyMap<string, { readonly dataB64?: string; readonly inputKind: string }>,
  depth: number,
  stepId: string | undefined,
): ConsumedInputs | undefined {
  const inputs: { readonly dataB64?: string; readonly inputKind: string }[] = [];
  let firstT: number | undefined;
  while (rows.length > 0) {
    const row = rows.at(-1);
    if (row?.kind !== 'input' || row.depth !== depth || row.stepId !== stepId) break;
    rows.pop();
    firstT = row.t;
    const input = rawInputs.get(row.id);
    if (input !== undefined) inputs.unshift(input);
  }
  return firstT === undefined ? undefined : { t: firstT, inputs };
}

function describeAction(
  api: string,
  inputs: readonly { readonly dataB64?: string; readonly inputKind: string }[],
): string {
  if (inputs.length === 0) return api;
  const bytes = decodeInputs(inputs);
  if (bytes === null) return api;
  if (api === 'press') return `${api} ${describeKeys(bytes)}`;
  if (api === 'type') return `${api} · ${characterCount(bytes)} chars`;
  if (api === 'paste') return `${api} · ${characterCount(bytes)} chars`;
  if (api === 'write') return `${api} · ${bytes.length} bytes`;
  // `activate`, pointer actions and similar calls may send terminal bytes as
  // an implementation strategy. That is not a second user-facing command.
  return api;
}

function decodeInputs(
  inputs: readonly { readonly dataB64?: string; readonly inputKind: string }[],
): Uint8Array | null {
  try {
    const chunks = inputs.map((input) => {
      if (input.dataB64 === undefined) return new Uint8Array();
      const binary = globalThis.atob(input.dataB64);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    });
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  } catch {
    return null;
  }
}

function describeKeys(bytes: Uint8Array): string {
  const encoded = [...bytes].map((byte) => String.fromCharCode(byte)).join('');
  const known = new Map<string, string>([
    ['\t', 'Tab'],
    ['\r', 'Enter'],
    ['\n', 'Enter'],
    ['\u001b', 'Escape'],
    ['\u001b[A', 'ArrowUp'],
    ['\u001b[B', 'ArrowDown'],
    ['\u001b[C', 'ArrowRight'],
    ['\u001b[D', 'ArrowLeft'],
    ['\u001b[Z', 'Shift+Tab'],
    ['\u007f', 'Backspace'],
  ]);
  const name = known.get(encoded);
  if (name !== undefined) return name;
  if (bytes.length === 1 && bytes[0] !== undefined && bytes[0] >= 1 && bytes[0] <= 26) {
    return `Control+${String.fromCharCode(64 + bytes[0])}`;
  }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (/^[^\p{Cc}]{1,24}$/u.test(decoded)) return JSON.stringify(decoded);
  return `· ${bytes.length} bytes`;
}

function characterCount(bytes: Uint8Array): number {
  return [...new TextDecoder('utf-8', { fatal: false }).decode(bytes)].length;
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
