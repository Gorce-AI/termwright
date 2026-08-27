/** Closed first-class lifecycle vocabulary for a Termwright run. */
export const RUN_STATES = Object.freeze([
  'requested',
  'collecting',
  'scheduled',
  'running',
  'cancelling',
  'finalizing',
  'passed',
  'passed-with-skips',
  'failed',
  'skipped',
  'cancelled',
  'infrastructure-failed',
  'crashed',
  'incomplete',
  'flaky',
] as const);

export type RunState = (typeof RUN_STATES)[number];

export const TERMINAL_RUN_STATES = Object.freeze([
  'passed',
  'passed-with-skips',
  'failed',
  'skipped',
  'cancelled',
  'infrastructure-failed',
  'crashed',
  'incomplete',
  'flaky',
] as const satisfies readonly RunState[]);

export type TerminalRunState = (typeof TERMINAL_RUN_STATES)[number];

const TERMINAL = new Set<RunState>(TERMINAL_RUN_STATES);

/** Executable transition graph; consumers must not duplicate this table. */
export const RUN_STATE_TRANSITIONS = Object.freeze({
  requested: ['collecting', 'cancelling', 'infrastructure-failed'],
  collecting: ['scheduled', 'cancelling', 'infrastructure-failed', 'incomplete'],
  scheduled: ['running', 'cancelling', 'finalizing', 'infrastructure-failed', 'incomplete'],
  running: ['cancelling', 'finalizing', 'infrastructure-failed', 'crashed', 'incomplete'],
  cancelling: ['finalizing', 'cancelled', 'infrastructure-failed', 'incomplete'],
  finalizing: TERMINAL_RUN_STATES,
  passed: [],
  'passed-with-skips': [],
  failed: [],
  skipped: [],
  cancelled: [],
  'infrastructure-failed': [],
  crashed: [],
  incomplete: [],
  flaky: [],
} as const satisfies Readonly<Record<RunState, readonly RunState[]>>);

export function isRunState(value: unknown): value is RunState {
  return typeof value === 'string' && RUN_STATES.includes(value as RunState);
}

export function isTerminalRunState(value: RunState): value is TerminalRunState {
  return TERMINAL.has(value);
}

export function canTransitionRunState(from: RunState, to: RunState): boolean {
  return (RUN_STATE_TRANSITIONS[from] as readonly RunState[]).includes(to);
}

export type RunStateTransitionResult =
  | { readonly ok: true; readonly from: RunState; readonly to: RunState }
  | {
      readonly ok: false;
      readonly code: 'invalid-run-state' | 'illegal-run-transition';
      readonly detail: string;
    };

export function validateRunStateTransition(from: unknown, to: unknown): RunStateTransitionResult {
  if (!isRunState(from) || !isRunState(to)) {
    return Object.freeze({
      ok: false,
      code: 'invalid-run-state',
      detail: 'run state is outside the closed Termwright vocabulary',
    });
  }
  if (!canTransitionRunState(from, to)) {
    return Object.freeze({
      ok: false,
      code: 'illegal-run-transition',
      detail: `run cannot transition from ${from} to ${to}`,
    });
  }
  return Object.freeze({ ok: true, from, to });
}
