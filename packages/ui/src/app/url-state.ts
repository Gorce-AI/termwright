import type { AppRoute, AppState, ExecutionCase } from './domain/model.js';

const ROUTES = new Set<AppRoute>(['specs', 'runner', 'runs', 'settings']);
const MAX_IDENTIFIER_LENGTH = 4_096;
type RouteKey = 'view' | 'runId' | 'executionId' | 'traceRef' | 'timeMs';

export interface AppUrlState {
  readonly view: AppRoute;
  readonly runId?: string;
  readonly executionId?: string;
  readonly traceRef?: string;
  readonly timeMs?: number;
}

/** Reads only the documented, shareable application state. Credentials and unknown parameters are ignored. */
export function parseAppUrl(value: string | URL): AppUrlState {
  const url = value instanceof URL ? value : new URL(value);
  const views = url.searchParams.getAll('view');
  const requestedView = views.length === 1 ? views[0] ?? null : null;
  const validView = requestedView === null || ROUTES.has(requestedView as AppRoute);
  const view = requestedView !== null && validView
    ? requestedView as AppRoute
    : 'runner';
  if (!validView) return { view: 'runner' };
  const runId = singleBoundedValue(url, 'runId');
  if (view !== 'runner') return { view, ...(view === 'runs' && runId !== undefined ? { runId } : {}) };
  const executionId = singleBoundedValue(url, 'executionId');
  const traceRef = singleBoundedValue(url, 'traceRef');
  const times = url.searchParams.getAll('timeMs');
  const rawTime = times.length === 1 ? times[0] ?? null : null;
  const parsedTime = rawTime === null || rawTime.trim() === '' ? Number.NaN : Number(rawTime);
  const roundedTime = Math.round(parsedTime);
  const timeMs = Number.isFinite(parsedTime) && parsedTime >= 0 && Number.isSafeInteger(roundedTime) ? roundedTime : undefined;
  return {
    view,
    ...(runId === undefined ? {} : { runId }),
    ...(executionId === undefined ? {} : { executionId }),
    ...(traceRef === undefined ? {} : { traceRef }),
    ...(timeMs === undefined ? {} : { timeMs }),
  };
}

/** Produces a canonical deep link and deliberately drops every non-route parameter, including auth tokens. */
export function shareableAppUrl(base: string | URL, state: AppUrlState): URL {
  const url = base instanceof URL ? new URL(base.href) : new URL(base);
  url.search = '';
  writeRouteParams(url, state);
  return url;
}

export function urlStateFromApp(state: AppState, openedRunId?: string | null): AppUrlState {
  if (state.route !== 'runner') return {
    view: state.route,
    ...(state.route === 'runs' && openedRunId !== null && openedRunId !== undefined ? { runId: openedRunId } : {}),
  };
  const selected = selectedExecution(state);
  const replay = state.evidence.kind === 'replay' ? state.evidence.replay : null;
  const traceRef = state.evidence.kind === 'replay'
    ? state.evidence.replay.traceRef
    : state.evidence.kind === 'replay-loading' || state.evidence.kind === 'replay-error'
      ? state.evidence.traceRef
      : undefined;
  return {
    view: 'runner',
    ...(selected?.runId === null || selected?.runId === undefined ? {} : { runId: selected.runId }),
    ...(selected === undefined ? {} : { executionId: selected.executionId }),
    ...(traceRef === undefined ? {} : { traceRef }),
    ...(replay === null ? {} : { timeMs: Math.round(replay.timeMs) }),
  };
}

export function sameAppUrlState(left: AppUrlState, right: AppUrlState): boolean {
  return left.view === right.view
    && left.runId === right.runId
    && left.executionId === right.executionId
    && left.traceRef === right.traceRef
    && left.timeMs === right.timeMs;
}

function selectedExecution(state: AppState): ExecutionCase | undefined {
  return state.executions.find((execution) => execution.executionId === state.selectedExecutionId)
    ?? state.catalog.find((execution) => execution.executionId === state.selectedExecutionId);
}

function boundedValue(value: string | null): string | undefined {
  if (value === null || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) return undefined;
  return value;
}

function singleBoundedValue(url: URL, key: RouteKey): string | undefined {
  const values = url.searchParams.getAll(key);
  return values.length === 1 ? boundedValue(values[0] ?? null) : undefined;
}

function writeRouteParams(url: URL, state: AppUrlState): void {
  url.searchParams.set('view', state.view);
  if (state.view !== 'runner') {
    if (state.view === 'runs' && state.runId !== undefined) url.searchParams.set('runId', state.runId);
    return;
  }
  if (state.runId !== undefined) url.searchParams.set('runId', state.runId);
  if (state.executionId !== undefined) url.searchParams.set('executionId', state.executionId);
  if (state.traceRef !== undefined) url.searchParams.set('traceRef', state.traceRef);
  if (state.timeMs !== undefined) url.searchParams.set('timeMs', String(Math.max(0, Math.round(state.timeMs))));
}
