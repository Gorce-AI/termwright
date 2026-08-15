/**
 * `expect.extend` matchers for terminals, locators and snapshots.
 *
 * Locator matchers are *retry-able*: they re-probe until the assertion holds or
 * the `expect` timeout class runs out, which is what makes an assertion right
 * after an action safe on a screen that repaints asynchronously. Failure
 * messages follow the driver's pattern — what was expected, what was observed,
 * the candidate nodes, and an excerpt of the screen.
 */

import { expect } from 'vitest';
import type { Locator, ScreenSnapshot, TerminalHarness } from '@termwright/driver';
import type { SemanticSnapshot, SemanticState } from '@termwright/protocol';
import { getTermwrightConfig } from './config.js';
import { serializeScreen, type CellSnapshotOptions } from './cells.js';
import { serializeSemanticSnapshot, normalizeName, type StateSelection } from './yaml-serialize.js';
import { parseSemanticSnapshot } from './yaml-pattern.js';
import { matchSemanticSnapshot } from './yaml-match.js';
import {
  nextSnapshotKey,
  readSnapshot,
  resolveUpdateMode,
  snapshotFilePath,
  writeSnapshot,
  type SnapshotKind,
} from './snapshot-store.js';
import { recordAssert, scopeKey } from './trace-context.js';

/** Every matcher accepts a per-assertion timeout override. */
export interface PollOptions {
  /** Milliseconds to keep re-probing. Defaults to the `expect` timeout class. */
  readonly timeout?: number;
}

/** Options for {@link TermwrightMatchers.toHaveText}. */
export interface TextMatcherOptions extends PollOptions {
  /**
   * `true` (default for locators) compares the whole accessible text after
   * whitespace normalization; `false` asserts a substring. A terminal as the
   * subject always uses substring matching against the visible grid.
   */
  readonly exact?: boolean;
}

/** Options for {@link TermwrightMatchers.toMatchCellSnapshot}. */
export interface CellSnapshotMatcherOptions extends PollOptions, CellSnapshotOptions {}

/** Options for {@link TermwrightMatchers.toMatchSemanticSnapshot}. */
export interface SemanticSnapshotMatcherOptions extends PollOptions {
  /** Snapshot this node's subtree instead of the whole tree. */
  readonly rootId?: string;
  /** Which state flags a written snapshot records. Default `stable`. */
  readonly states?: StateSelection;
}

/** The matchers this package adds to `expect`. */
export interface TermwrightMatchers<R = unknown> {
  /** The locator resolves to a node that is on screen and not hidden. */
  toBeVisible(options?: PollOptions): R;
  /** The locator resolves to the node carrying `state.focused`. */
  toBeFocused(options?: PollOptions): R;
  /** Every listed state key holds; unlisted keys are not constrained. */
  toHaveState(expected: Partial<SemanticState>, options?: PollOptions): R;
  /** Accessible text of a locator, or the visible grid of a terminal. */
  toHaveText(expected: string | RegExp, options?: TextMatcherOptions): R;
  /** Framed rendering of the visible grid, inline or from `__snapshots__`. */
  toMatchCellSnapshot(expected?: string, options?: CellSnapshotMatcherOptions): R;
  /** Semantic tree as YAML, matched partially (`/CONTRACTS.md` §YAML). */
  toMatchSemanticSnapshot(expected?: string, options?: SemanticSnapshotMatcherOptions): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors Vitest's own declaration
  interface Matchers<T = any> extends TermwrightMatchers<T> {}
}

/**
 * The slice of Vitest's matcher state this package reads.
 *
 * `isNot` is only present on a negated assertion, so it is read through
 * {@link negated} rather than compared directly — treating `undefined` as a
 * value would end every polling loop on its first probe.
 */
interface MatcherState {
  readonly isNot?: boolean;
  readonly currentTestName?: string | undefined;
  readonly testPath?: string | undefined;
  readonly snapshotState?: { readonly _updateSnapshot?: string } | undefined;
}

interface MatcherResult {
  readonly pass: boolean;
  message(): string;
  readonly actual?: unknown;
  readonly expected?: unknown;
}

const POLL_INTERVAL_MS = 25;

/** Driver failures that will never become true by waiting longer. */
const FATAL_CODES: ReadonlySet<string> = new Set([
  'session-closed',
  'unsupported-action',
  'protocol-violation',
]);

// ---------------------------------------------------------------------------
// Locator matchers

async function toBeVisible(
  this: MatcherState,
  received: unknown,
  options: PollOptions = {},
): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeVisible');
  return locatorAssertion(this, {
    matcher: 'toBeVisible',
    locator,
    options,
    expected: 'visible',
    probe: async () => {
      const visible = await locator.isVisible();
      return { pass: visible, actual: visible ? 'visible' : 'hidden' };
    },
  });
}

async function toBeFocused(
  this: MatcherState,
  received: unknown,
  options: PollOptions = {},
): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeFocused');
  return locatorAssertion(this, {
    matcher: 'toBeFocused',
    locator,
    options,
    expected: 'focused',
    probe: async () => {
      const state = await locator.semanticState();
      if (state === null) return { pass: false, actual: 'not a semantic node (no focus state)' };
      return { pass: state.focused === true, actual: state.focused === true ? 'focused' : 'not focused' };
    },
  });
}

async function toHaveState(
  this: MatcherState,
  received: unknown,
  expected: Partial<SemanticState>,
  options: PollOptions = {},
): Promise<MatcherResult> {
  const locator = asLocator(received, 'toHaveState');
  return locatorAssertion(this, {
    matcher: 'toHaveState',
    locator,
    options,
    expected: JSON.stringify(expected),
    probe: async () => {
      const state = await locator.semanticState();
      if (state === null) return { pass: false, actual: 'not a semantic node (no state)' };
      const differing = Object.entries(expected).filter(
        ([key, value]) => state[key as keyof SemanticState] !== value,
      );
      return {
        pass: differing.length === 0,
        actual: JSON.stringify(pick(state, Object.keys(expected) as (keyof SemanticState)[])),
      };
    },
  });
}

async function toHaveText(
  this: MatcherState,
  received: unknown,
  expected: string | RegExp,
  options: TextMatcherOptions = {},
): Promise<MatcherResult> {
  if (isHarness(received)) {
    const harness = received;
    const exact = options.exact ?? false;
    return locatorAssertion(this, {
      matcher: 'toHaveText',
      options,
      expected: describeExpectedText(expected, exact),
      probe: async () => {
        const text = harness.screen().text();
        return { pass: textMatches(text, expected, exact), actual: excerpt(text) };
      },
      diagnostics: () => screenBlock(harness),
    });
  }
  const locator = asLocator(received, 'toHaveText');
  const exact = options.exact ?? true;
  return locatorAssertion(this, {
    matcher: 'toHaveText',
    locator,
    options,
    expected: describeExpectedText(expected, exact),
    probe: async () => {
      const text = await locator.textContent();
      return { pass: textMatches(text, expected, exact), actual: JSON.stringify(normalizeName(text)) };
    },
  });
}

// ---------------------------------------------------------------------------
// Snapshot matchers

async function toMatchCellSnapshot(
  this: MatcherState,
  received: unknown,
  expected?: string,
  options: CellSnapshotMatcherOptions = {},
): Promise<MatcherResult> {
  const screen = asScreenSource(received, 'toMatchCellSnapshot');
  const config = getTermwrightConfig();
  const serialize = (): string =>
    serializeScreen(screen(), {
      ...(config.palette === undefined ? {} : { palette: config.palette }),
      ...options,
    });
  return snapshotAssertion(this, {
    matcher: 'toMatchCellSnapshot',
    kind: 'cells',
    options,
    inline: expected,
    serialize,
    compare: (stored) => {
      const actual = serialize();
      return actual.trimEnd() === stored.trimEnd()
        ? { ok: true, actual }
        : { ok: false, actual, reason: 'the visible grid differs from the stored snapshot' };
    },
  });
}

async function toMatchSemanticSnapshot(
  this: MatcherState,
  received: unknown,
  expected?: string,
  options: SemanticSnapshotMatcherOptions = {},
): Promise<MatcherResult> {
  const tree = asTreeSource(received, 'toMatchSemanticSnapshot');
  const serializeOptions = {
    ...(options.states === undefined ? {} : { states: options.states }),
    ...(options.rootId === undefined ? {} : { rootId: options.rootId }),
  };
  const serialize = (): string => {
    const snapshot = tree();
    if (snapshot === null) {
      throw new TypeError(
        'toMatchSemanticSnapshot needs a semantic tree, but this session published none. ' +
          'Assert with toMatchCellSnapshot, or check that the adapter completed its handshake.',
      );
    }
    return serializeSemanticSnapshot(snapshot, serializeOptions);
  };
  return snapshotAssertion(this, {
    matcher: 'toMatchSemanticSnapshot',
    kind: 'semantic',
    options,
    inline: expected,
    // `capabilities().semanticTree` is true from the handshake, but the tree
    // itself only becomes observable once a snapshot and its render-commit
    // marker have been paired — a screen wait can land in that gap.
    ready: () => tree() !== null,
    serialize,
    compare: (stored) => {
      const patterns = parseSemanticSnapshot(stored);
      const snapshot = tree();
      if (snapshot === null) return { ok: false, actual: '', reason: 'this session published no semantic tree' };
      const result = matchSemanticSnapshot(patterns, snapshot, {
        ...(options.rootId === undefined ? {} : { rootId: options.rootId }),
      });
      const actual = serializeSemanticSnapshot(snapshot, serializeOptions);
      if (result.ok) return { ok: true, actual };
      const mismatch = result.mismatch;
      return {
        ok: false,
        actual,
        reason:
          mismatch === undefined
            ? 'the semantic tree does not match'
            : `${mismatch.path === '' ? '' : `under ${mismatch.path}: `}` +
              `${JSON.stringify(mismatch.expected)} — ${mismatch.reason}`,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Shared machinery

interface Probe {
  readonly pass: boolean;
  readonly actual: string;
}

interface LocatorAssertion {
  readonly matcher: string;
  readonly locator?: Locator;
  readonly options: PollOptions;
  readonly expected: string;
  probe(): Promise<Probe>;
  diagnostics?(): string;
}

/** The trace scope this assertion belongs to, when Vitest tells us which test it is. */
function testKey(state: MatcherState): string | undefined {
  const { testPath, currentTestName } = state;
  return testPath === undefined || currentTestName === undefined
    ? undefined
    : scopeKey(testPath, currentTestName);
}

/** Whether this assertion was written as `.not`. */
function negated(state: MatcherState): boolean {
  return state.isNot === true;
}

async function locatorAssertion(state: MatcherState, spec: LocatorAssertion): Promise<MatcherResult> {
  const isNot = negated(state);
  const timeout = spec.options.timeout ?? getTermwrightConfig().timeouts.expect;
  const deadline = Date.now() + timeout;
  const target = spec.locator === undefined ? 'terminal' : describeLocator(spec.locator);
  let last: Probe = { pass: false, actual: 'not probed' };
  let failure: unknown;

  for (;;) {
    try {
      last = await spec.probe();
      failure = undefined;
    } catch (error) {
      if (isFatal(error)) throw error;
      failure = error;
      last = { pass: false, actual: errorSummary(error) };
    }
    if (last.pass !== isNot || Date.now() >= deadline) break;
    await delay(POLL_INTERVAL_MS);
  }

  const pass = last.pass;
  recordAssert(
    {
      api: spec.matcher,
      ok: pass !== isNot,
      selector: target,
      ...(pass === isNot ? { error: `expected ${spec.expected}, received ${last.actual}` } : {}),
    },
    testKey(state),
  );

  const diagnostics =
    pass === isNot
      ? (spec.diagnostics?.() ?? (await locatorDiagnostics(spec.locator, failure)))
      : '';
  const actual = last.actual;
  return {
    pass,
    message: () =>
      report({
        matcher: spec.matcher,
        target,
        isNot: isNot,
        expected: spec.expected,
        received: actual,
        timeout,
        diagnostics,
      }),
  };
}

interface Comparison {
  readonly ok: boolean;
  readonly actual: string;
  readonly reason?: string;
}

interface SnapshotAssertion {
  readonly matcher: string;
  readonly kind: SnapshotKind;
  readonly options: PollOptions;
  readonly inline: string | undefined;
  /** Whether the subject can be serialized yet. Absent means always. */
  ready?(): boolean;
  serialize(): string;
  compare(stored: string): Comparison;
}

async function snapshotAssertion(state: MatcherState, spec: SnapshotAssertion): Promise<MatcherResult> {
  const isNot = negated(state);
  const config = getTermwrightConfig();
  const timeout = spec.options.timeout ?? config.timeouts.expect;
  // Allocated once per assertion: asking twice would consume two snapshot keys.
  const location =
    spec.inline === undefined ? snapshotLocation(state, spec.kind, config.snapshotDir) : undefined;
  const stored =
    spec.inline ?? (location === undefined ? undefined : readSnapshot(location.file, location.key));

  if (stored === undefined) {
    if (isNot) {
      throw new TypeError(`${spec.matcher} cannot be negated without an inline expected snapshot`);
    }
    await settle(spec, Date.now() + timeout);
    const mode = updateMode(state);
    const place = location ?? snapshotLocation(state, spec.kind, config.snapshotDir);
    if (mode === 'none') {
      return {
        pass: false,
        message: () =>
          `${spec.matcher}: no stored snapshot for ${JSON.stringify(place.key)}.\n` +
          `Run with \`vitest -u\` (or TERMWRIGHT_UPDATE_SNAPSHOTS=missing) to write ${place.file}.\n\n` +
          spec.serialize(),
      };
    }
    writeSnapshot(place.file, place.key, spec.serialize());
    recordAssert({ api: spec.matcher, ok: true, selector: place.key }, testKey(state));
    return { pass: true, message: () => `${spec.matcher}: snapshot written` };
  }

  const deadline = Date.now() + timeout;
  let comparison = spec.compare(stored);
  while (comparison.ok === isNot && Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    comparison = spec.compare(stored);
  }

  const mode = updateMode(state);
  if (location !== undefined && !isNot) {
    if (mode === 'all' || (mode === 'changed' && !comparison.ok)) {
      writeSnapshot(location.file, location.key, comparison.actual);
      recordAssert({ api: spec.matcher, ok: true, selector: location.key }, testKey(state));
      return { pass: true, message: () => `${spec.matcher}: snapshot updated` };
    }
  }

  const pass = comparison.ok;
  recordAssert(
    {
      api: spec.matcher,
      ok: pass !== isNot,
      ...(comparison.reason === undefined ? {} : { error: comparison.reason }),
    },
    testKey(state),
  );
  return {
    pass,
    actual: comparison.actual,
    expected: stored,
    message: () =>
      report({
        matcher: spec.matcher,
        target: spec.kind === 'semantic' ? 'semantic tree' : 'screen',
        isNot: isNot,
        expected: stored.trimEnd(),
        received: comparison.actual.trimEnd(),
        timeout,
        diagnostics: comparison.reason === undefined ? '' : `reason: ${comparison.reason}`,
        block: true,
      }),
  };
}

/**
 * Waits for the subject to become serializable.
 *
 * Only the write path needs this: comparing already re-probes, but writing a
 * new snapshot happens once, and doing it in the gap before the first semantic
 * tree arrives would store an error instead of a tree.
 */
async function settle(spec: SnapshotAssertion, deadline: number): Promise<void> {
  if (spec.ready === undefined) return;
  while (!spec.ready() && Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
  }
}

interface SnapshotLocation {
  readonly file: string;
  readonly key: string;
}

/**
 * Which file and key back this snapshot. Every call allocates the next key for
 * the test, so callers resolve it once per assertion.
 */
function snapshotLocation(state: MatcherState, kind: SnapshotKind, dir: string): SnapshotLocation {
  const testPath = state.testPath;
  const testName = state.currentTestName;
  if (testPath === undefined || testName === undefined) {
    throw new TypeError(
      'external snapshots need Vitest test context; pass the expected snapshot inline when asserting outside a test',
    );
  }
  return {
    file: snapshotFilePath(testPath, kind, dir),
    key: nextSnapshotKey(`${testPath}::${testName}`, testName, kind),
  };
}

function updateMode(state: MatcherState): ReturnType<typeof resolveUpdateMode> {
  const configured = getTermwrightConfig().updateSnapshots;
  if (configured !== undefined) return configured;
  return resolveUpdateMode(process.env, state.snapshotState?._updateSnapshot);
}

interface ReportInput {
  readonly matcher: string;
  readonly target: string;
  readonly isNot: boolean;
  readonly expected: string;
  readonly received: string;
  readonly timeout: number;
  readonly diagnostics: string;
  /** Multi-line values are printed as blocks rather than on the label line. */
  readonly block?: boolean;
}

function report(input: ReportInput): string {
  const head = `expect(${input.target})${input.isNot ? '.not' : ''}.${input.matcher}()`;
  const lines =
    input.block === true
      ? [head, '', 'Expected:', indent(input.expected), '', 'Received:', indent(input.received)]
      : [head, '', `Expected: ${input.isNot ? 'not ' : ''}${input.expected}`, `Received: ${input.received}`];
  lines.push(`Timeout:  ${input.timeout}ms`);
  if (input.diagnostics.length > 0) lines.push('', input.diagnostics);
  return lines.join('\n');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/** Harvests the driver's own diagnostics (candidates + screen excerpt). */
async function locatorDiagnostics(locator: Locator | undefined, failure: unknown): Promise<string> {
  const fromFailure = diagnosticsBlock(failure);
  if (fromFailure !== '') return fromFailure;
  if (locator === undefined) return '';
  try {
    await locator.resolve({ timeout: 1 });
    return '';
  } catch (error) {
    return diagnosticsBlock(error);
  }
}

interface DiagnosticsCarrier {
  readonly code: string;
  readonly diagnostics: {
    readonly screenExcerpt?: string;
    readonly candidates?: readonly { role?: string; name?: string; ref: string }[];
    readonly suggestion?: string;
  };
}

function isDiagnosticsCarrier(error: unknown): error is DiagnosticsCarrier {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<DiagnosticsCarrier>;
  return typeof candidate.code === 'string' && typeof candidate.diagnostics === 'object';
}

function diagnosticsBlock(error: unknown): string {
  if (!isDiagnosticsCarrier(error)) return '';
  const { candidates, screenExcerpt, suggestion } = error.diagnostics;
  const parts: string[] = [];
  if (suggestion !== undefined) parts.push(`suggestion: ${suggestion}`);
  if (candidates !== undefined && candidates.length > 0) {
    parts.push(
      `candidates:\n${candidates
        .map((candidate) => `  - ${candidate.role ?? 'generic'} ${JSON.stringify(candidate.name ?? '')} ref=${candidate.ref}`)
        .join('\n')}`,
    );
  }
  if (screenExcerpt !== undefined) parts.push(`screen:\n${indent(screenExcerpt)}`);
  return parts.join('\n');
}

function screenBlock(harness: TerminalHarness): string {
  try {
    return `screen:\n${indent(serializeScreen(harness.screen()).trimEnd())}`;
  } catch {
    return '';
  }
}

function isFatal(error: unknown): boolean {
  return isDiagnosticsCarrier(error) && FATAL_CODES.has(error.code);
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function textMatches(text: string, expected: string | RegExp, exact: boolean): boolean {
  if (expected instanceof RegExp) return expected.test(text);
  if (!exact) return normalizeName(text).includes(normalizeName(expected));
  return normalizeName(text) === normalizeName(expected);
}

function describeExpectedText(expected: string | RegExp, exact: boolean): string {
  if (expected instanceof RegExp) return `text matching ${String(expected)}`;
  return `${exact ? 'text' : 'text containing'} ${JSON.stringify(expected)}`;
}

function excerpt(text: string, rows = 12): string {
  const lines = text.split('\n');
  const head = lines.slice(0, rows).join('\n');
  return lines.length > rows ? `${head}\n…` : head;
}

function pick<T extends object>(value: T, keys: readonly (keyof T)[]): Partial<T> {
  const picked: Partial<T> = {};
  for (const key of keys) {
    if (key in value) picked[key] = value[key];
  }
  return picked;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

function describeLocator(locator: Locator): string {
  const described = (locator as { description?: unknown }).description;
  return typeof described === 'string' ? described : 'locator';
}

function isLocator(value: unknown): value is Locator {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Locator>;
  return typeof candidate.resolve === 'function' && typeof candidate.isVisible === 'function';
}

function isHarness(value: unknown): value is TerminalHarness {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TerminalHarness>;
  return typeof candidate.screen === 'function' && typeof candidate.semanticTree === 'function';
}

function isScreen(value: unknown): value is ScreenSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ScreenSnapshot>;
  return typeof candidate.text === 'function' && typeof candidate.columns === 'number';
}

function isSnapshot(value: unknown): value is SemanticSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SemanticSnapshot>;
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.rootIds);
}

function asLocator(value: unknown, matcher: string): Locator {
  if (isLocator(value)) return value;
  throw new TypeError(`${matcher} expects a locator, received ${describeValue(value)}`);
}

function asScreenSource(value: unknown, matcher: string): () => ScreenSnapshot {
  if (isHarness(value)) return () => value.screen();
  if (isScreen(value)) return () => value;
  throw new TypeError(`${matcher} expects a terminal or a screen snapshot, received ${describeValue(value)}`);
}

function asTreeSource(value: unknown, matcher: string): () => SemanticSnapshot | null {
  if (isHarness(value)) return () => value.semanticTree();
  if (isSnapshot(value)) return () => value;
  throw new TypeError(`${matcher} expects a terminal or a semantic snapshot, received ${describeValue(value)}`);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (isLocator(value)) return 'a locator';
  if (isHarness(value)) return 'a terminal';
  return typeof value;
}

/** The matcher implementations, exported for manual registration. */
export const termwrightMatchers = {
  toBeVisible,
  toBeFocused,
  toHaveState,
  toHaveText,
  toMatchCellSnapshot,
  toMatchSemanticSnapshot,
};

let registered = false;

/**
 * Registers the matchers with Vitest's `expect`. Importing `@termwright/test`
 * calls this for you; it is exported for setups that build their own entry
 * point. Calling it twice is a no-op.
 */
export function registerTermwrightMatchers(): void {
  if (registered) return;
  registered = true;
  // Vitest types `expect.extend` against its own matcher state, which carries a
  // full `SnapshotState`; these matchers only read three of its fields.
  expect.extend(termwrightMatchers as unknown as Parameters<typeof expect.extend>[0]);
}
