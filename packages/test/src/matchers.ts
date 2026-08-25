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
import { parseRef, TimeoutError, type AnyLocator, type BoundsExpectation, type ScreenSnapshot, type SemanticLocator, type SpatialRelationExpectation, type TerminalHarness } from '@termwright/driver';
import type {
  Condition,
  LocatorRef,
  Observation,
  Rect,
  SemanticExtendedState,
  SemanticExtendedValue,
  SemanticSnapshot,
  SemanticState,
} from '@termwright/protocol';
import { getTermwrightConfig } from './config.js';
import { serializeScreen, type CellSnapshotOptions } from './cells.js';
import {
  serializeSemanticSnapshot,
  normalizeName,
  type SerializeOptions,
  type StateSelection,
} from './yaml-serialize.js';
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
import { recordAssert } from './trace-context.js';
import { formatLogEntry, logsOf, type LogCollection, type LogQuery } from './logs.js';
import { attemptOperationTimeout, currentAttemptContext } from './attempt-context.js';

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
  /**
   * Match the pattern against what is *inside* this locator.
   *
   * The node itself is not part of the pattern, so a test can assert a dialog's
   * contents without restating the application and region nodes above it — the
   * usual shape for Ink and Textual apps, whose tree is rooted at
   * `application`. Re-resolved on every attempt, so a re-render that mints new
   * node ids does not invalidate the scope.
   */
  readonly within?: AnyLocator;
  /** Snapshot this node's subtree, the node included. Mutually exclusive with `within`. */
  readonly rootId?: string;
  /** Which state flags a written snapshot records. Default `stable`. */
  readonly states?: StateSelection;
}

/** The matchers this package adds to `expect`. */
export interface TermwrightMatchers<R = unknown> {
  /** The locator resolves to a node that is on screen and not hidden. */
  toBeVisible(options?: PollOptions): R;
  toBeAttached(options?: PollOptions): R;
  toBeDetached(options?: PollOptions): R;
  toBeDisplayed(options?: PollOptions): R;
  toBeHidden(options?: PollOptions): R;
  toBeOffscreen(options?: PollOptions): R;
  toBeInViewport(options?: PollOptions & { readonly ratio?: number; readonly fully?: boolean }): R;
  toReceivePointerEvents(options?: PollOptions): R;
  toHaveBounds(expected: BoundsExpectation, options?: PollOptions & { readonly box?: 'visible' | 'intended' }): R;
  toHaveSpatialRelation(expected: SpatialRelationExpectation, options?: PollOptions & { readonly box?: 'visible' | 'intended' }): R;
  /** The locator resolves to the node carrying `state.focused`. */
  toBeFocused(options?: PollOptions): R;
  toBeEnabled(options?: PollOptions): R;
  toBeDisabled(options?: PollOptions): R;
  toBeChecked(options?: PollOptions): R;
  toBeSelected(options?: PollOptions): R;
  toBeExpanded(options?: PollOptions): R;
  toHaveValue(expected: string | RegExp, options?: TextMatcherOptions): R;
  /** Every listed state key holds; unlisted keys are not constrained. */
  toHaveState(expected: Partial<SemanticState>, options?: PollOptions): R;
  /** Every listed application-domain key deep-equals the expected JSON value. */
  toHaveExtendedState(expected: SemanticExtendedState, options?: PollOptions): R;
  /** Accessible text of a locator, or the visible grid of a terminal. */
  toHaveText(expected: string | RegExp, options?: TextMatcherOptions): R;
  /** Framed rendering of the visible grid, inline or from `__snapshots__`. */
  toMatchCellSnapshot(expected?: string, options?: CellSnapshotMatcherOptions): R;
  /** Semantic tree as YAML, matched partially (`/CONTRACTS.md` §YAML). */
  toMatchSemanticSnapshot(expected?: string, options?: SemanticSnapshotMatcherOptions): R;
  /** The program logged an entry matching the query. */
  toHaveLogged(query: LogQuery, options?: PollOptions): R;
}

declare module 'vitest' {
  // `any` mirrors Vitest's own declaration and keeps matcher augmentation compatible.
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

/** Driver failures that will never become true by waiting longer. */
const FATAL_CODES: ReadonlySet<string> = new Set([
  'session-closed',
  'semantic-capability-unavailable',
  'probe-attach-failed',
  'capability-unavailable',
  'capability-provider-lost',
  'capability-provider-violation',
  'adapter-guarantee-violation',
  'duplicate-semantic-key',
  'protocol-violation',
]);

async function conditionProbe(
  locator: AnyLocator,
  condition: Condition,
  positive: string,
  negative: string,
  timeout?: number,
): Promise<Probe> {
  // The public screen domain exposes only physical conditions. This shared
  // matcher adapter receives a canonical condition chosen by the matcher and
  // calls the common internal evaluator after that choice has been made.
  const result = await (locator as unknown as { evaluateCondition(value: Condition, options: PollOptions): Promise<import('@termwright/protocol').ConditionResult> })
    .evaluateCondition(condition, timeout === undefined ? {} : { timeout });
  if (result.observation.status === 'known') {
    return { pass: result.observation.value, actual: result.observation.value ? positive : negative };
  }
  return inconclusive(result.observation, condition.kind);
}

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
    probe: (timeout) => conditionProbe(locator, { kind: 'visible', target: locator.description }, 'visible', 'hidden', timeout),
  });
}

async function toBeAttached(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeAttached');
  return locatorAssertion(this, { matcher: 'toBeAttached', locator, options, expected: 'attached', probe: (timeout) =>
    conditionProbe(locator, { kind: 'attached', target: locator.description }, 'attached', 'detached', timeout) });
}

async function toBeDetached(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeDetached');
  return locatorAssertion(this, { matcher: 'toBeDetached', locator, options, expected: 'detached', probe: (timeout) =>
    conditionProbe(locator, { kind: 'detached', target: locator.description }, 'detached', 'attached', timeout) });
}

async function toBeDisplayed(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeDisplayed');
  return locatorAssertion(this, { matcher: 'toBeDisplayed', locator, options, expected: 'displayed', probe: (timeout) =>
    conditionProbe(locator, { kind: 'displayed', target: locator.description }, 'displayed', 'not displayed', timeout) });
}

async function toBeHidden(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeHidden');
  return locatorAssertion(this, { matcher: 'toBeHidden', locator, options, expected: 'hidden or detached', probe: (timeout) =>
    conditionProbe(locator, { kind: 'hidden', target: locator.description }, 'hidden or detached', 'displayed', timeout) });
}

async function toBeOffscreen(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeOffscreen');
  return locatorAssertion(this, { matcher: 'toBeOffscreen', locator, options, expected: 'offscreen', probe: (timeout) =>
    conditionProbe(locator, { kind: 'offscreen', target: locator.description }, 'offscreen', 'on screen', timeout) });
}

async function toBeInViewport(this: MatcherState, received: unknown, options: PollOptions & { readonly ratio?: number; readonly fully?: boolean } = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toBeInViewport');
  if (options.ratio !== undefined && (!Number.isFinite(options.ratio) || options.ratio < 0 || options.ratio > 1)) {
    throw new TypeError('toBeInViewport ratio must be a finite number from 0 through 1');
  }
  const threshold = options.ratio;
  const ratio = options.fully === true ? 1 : threshold ?? Number.MIN_VALUE;
  return locatorAssertion(this, { matcher: 'toBeInViewport', locator, options, expected: options.fully === true ? 'fully inside viewport' : threshold === undefined ? 'any viewport intersection' : `viewport ratio >= ${threshold}`, probe: (timeout) =>
    conditionProbe(locator, { kind: 'in-viewport', target: locator.description, minRatio: ratio }, 'in viewport', 'outside viewport', timeout) });
}

async function toReceivePointerEvents(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toReceivePointerEvents');
  return locatorAssertion(this, { matcher: 'toReceivePointerEvents', locator, options, expected: 'receives pointer events', probe: (timeout) =>
    conditionProbe(locator, { kind: 'receives-pointer', target: locator.description }, 'receives pointer events', 'does not receive pointer events', timeout) });
}

async function toHaveBounds(this: MatcherState, received: unknown, expected: BoundsExpectation, options: PollOptions & { readonly box?: 'visible' | 'intended' } = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toHaveBounds');
  const box = options.box ?? 'visible';
  return locatorAssertion(this, { matcher: 'toHaveBounds', locator, options, expected: `${box} bounds ${JSON.stringify(expected)}`, probe: async () => {
    const observation = (await locator.geometry())[box === 'visible' ? 'visibleRect' : 'intendedRect'];
    if (observation.status !== 'known') return inconclusive(observation, `${box} bounds`);
    const pass = (Object.keys(expected) as (keyof Rect)[]).every((key) => expected[key] === undefined || observation.value[key] === expected[key]);
    return { pass, actual: JSON.stringify(observation.value) };
  }});
}

async function toHaveSpatialRelation(this: MatcherState, received: unknown, expected: SpatialRelationExpectation, options: PollOptions & { readonly box?: 'visible' | 'intended' } = {}): Promise<MatcherResult> {
  const locator = asLocator(received, 'toHaveSpatialRelation');
  const box = options.box ?? 'visible';
  return locatorAssertion(this, { matcher: 'toHaveSpatialRelation', locator, options, expected: `${expected.relation} ${expected.target.description}`, probe: async () => {
    const [a, b] = await Promise.all([locator.geometry(), expected.target.geometry()]);
    if (a.stamp.sessionId !== b.stamp.sessionId) {
      return { pass: false, conclusive: false, fatal: true, actual: 'locators belong to different terminal sessions' };
    }
    if (a.stamp.screenRevision !== b.stamp.screenRevision || a.stamp.semanticRevision !== b.stamp.semanticRevision) {
      return { pass: false, conclusive: false, actual: 'locators were observed at different revisions' };
    }
    if (a.coordinateSpace.status !== 'known') return inconclusive(a.coordinateSpace, 'source coordinate space');
    if (b.coordinateSpace.status !== 'known') return inconclusive(b.coordinateSpace, 'target coordinate space');
    if (a.coordinateSpace.value !== b.coordinateSpace.value) {
      return { pass: false, conclusive: false, fatal: true, actual: `incompatible coordinate spaces: ${a.coordinateSpace.value} and ${b.coordinateSpace.value}` };
    }
    const left = a[box === 'visible' ? 'visibleRect' : 'intendedRect'];
    const right = b[box === 'visible' ? 'visibleRect' : 'intendedRect'];
    if (left.status !== 'known') return inconclusive(left, 'source bounds');
    if (right.status !== 'known') return inconclusive(right, 'target bounds');
    const { spatialRelation } = await import('@termwright/protocol');
    const pass = spatialRelation(left.value, expected.relation, right.value);
    return { pass, actual: `${JSON.stringify(left.value)} ${expected.relation} ${JSON.stringify(right.value)}` };
  }});
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
    probe: (timeout) => conditionProbe(locator, { kind: 'focused', target: locator.description }, 'focused', 'not focused', timeout),
  });
}

async function semanticFlag(
  state: MatcherState,
  received: unknown,
  matcher: string,
  key: 'disabled' | 'checked' | 'selected' | 'expanded',
  expectedValue: boolean,
  options: PollOptions,
): Promise<MatcherResult> {
  const locator = asLocator(received, matcher);
  return locatorAssertion(state, {
    matcher,
    locator,
    options,
    expected: expectedValue ? key : `not ${key}`,
    probe: (timeout) => conditionProbe(locator,
      key === 'disabled'
        ? { kind: expectedValue ? 'disabled' : 'enabled', target: locator.description }
        : { kind: key, target: locator.description, value: expectedValue },
      expectedValue ? key : `not ${key}`,
      expectedValue ? `not ${key}` : key, timeout),
  });
}

async function toBeEnabled(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  return semanticFlag(this, received, 'toBeEnabled', 'disabled', false, options);
}

async function toBeDisabled(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  return semanticFlag(this, received, 'toBeDisabled', 'disabled', true, options);
}

async function toBeChecked(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  return semanticFlag(this, received, 'toBeChecked', 'checked', true, options);
}

async function toBeSelected(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  return semanticFlag(this, received, 'toBeSelected', 'selected', true, options);
}

async function toBeExpanded(this: MatcherState, received: unknown, options: PollOptions = {}): Promise<MatcherResult> {
  return semanticFlag(this, received, 'toBeExpanded', 'expanded', true, options);
}

async function toHaveValue(
  this: MatcherState,
  received: unknown,
  expected: string | RegExp,
  options: TextMatcherOptions = {},
): Promise<MatcherResult> {
  const locator = asLocator(received, 'toHaveValue');
  const exact = options.exact ?? true;
  return locatorAssertion(this, {
    matcher: 'toHaveValue',
    locator,
    options,
    expected: describeExpectedText(expected, exact),
    probe: (timeout) => conditionProbe(locator, {
      kind: 'value', target: locator.description,
      matcher: expected instanceof RegExp
        ? { kind: 'regex', source: expected.source, flags: expected.flags }
        : { kind: exact ? 'exact' : 'substring', text: expected },
    }, 'value matched', 'value did not match', timeout),
  });
}

async function toHaveState(
  this: MatcherState,
  received: unknown,
  expected: Partial<SemanticState>,
  options: PollOptions = {},
): Promise<MatcherResult> {
  const locator = asSemanticLocator(received, 'toHaveState');
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

async function toHaveExtendedState(
  this: MatcherState,
  received: unknown,
  expected: SemanticExtendedState,
  options: PollOptions = {},
): Promise<MatcherResult> {
  const locator = asSemanticLocator(received, 'toHaveExtendedState');
  return locatorAssertion(this, {
    matcher: 'toHaveExtendedState',
    locator,
    options,
    expected: JSON.stringify(expected),
    probe: async () => {
      const state = await locator.extendedState();
      if (state === null) return { pass: false, actual: 'not a semantic node (no extended state)' };
      const keys = Object.keys(expected);
      const differing = keys.filter(
        (key) => !sameExtended(state[key], expected[key] as SemanticExtendedValue),
      );
      return {
        pass: differing.length === 0,
        actual: JSON.stringify(Object.fromEntries(keys.map((key) => [key, state[key]]))),
      };
    },
  });
}

function sameExtended(left: SemanticExtendedValue | undefined, right: SemanticExtendedValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameExtended(value, right[index] as SemanticExtendedValue))
    );
  }
  const leftObject = left as Readonly<Record<string, SemanticExtendedValue>>;
  const rightObject = right as Readonly<Record<string, SemanticExtendedValue>>;
  const leftKeys = Object.keys(leftObject);
  const rightKeys = Object.keys(rightObject);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => key in rightObject && sameExtended(leftObject[key], rightObject[key] as SemanticExtendedValue),
    )
  );
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
      eventSource: {
        revision: () => harness.checkpoint(),
        waitForChange: async (after, timeout) => {
          await harness.waitForCheckpointChange({
            after: after as import('@termwright/protocol').ObservationStamp,
            timeout,
          });
        },
      },
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
  const locator = isLocator(received) ? received : undefined;
  const harness = isHarness(received) ? received : undefined;
  const source = locator ?? harness;
  const screen = locator === undefined ? asScreenSource(received, 'toMatchCellSnapshot') : undefined;
  const config = getTermwrightConfig();
  const serialize = async (): Promise<string> =>
    serializeScreen(locator === undefined ? (screen as () => ScreenSnapshot)() : await locator.cellSnapshot(), {
      ...(config.palette === undefined ? {} : { palette: config.palette }),
      ...options,
    });
  return snapshotAssertion(this, {
    matcher: 'toMatchCellSnapshot',
    kind: 'cells',
    options,
    inline: expected,
    serialize,
    compare: async (stored) => {
      const actual = await serialize();
      return actual.trimEnd() === stored.trimEnd()
        ? { ok: true, actual }
        : { ok: false, actual, reason: 'the visible grid differs from the stored snapshot' };
    },
    ...(locator === undefined ? {} : { target: locator.description }),
    ...(source === undefined ? {} : { source }),
  });
}

async function toMatchSemanticSnapshot(
  this: MatcherState,
  received: unknown,
  expected?: string,
  options: SemanticSnapshotMatcherOptions = {},
): Promise<MatcherResult> {
  const tree = asTreeSource(received, 'toMatchSemanticSnapshot');
  const harness = isHarness(received) ? received : undefined;
  const source = options.within ?? harness;
  if (options.within !== undefined && options.rootId !== undefined) {
    throw new TypeError('toMatchSemanticSnapshot takes either { within } or { rootId }, not both');
  }
  const timeout = options.timeout ?? getTermwrightConfig().timeouts.expect;
  let scopeRef: LocatorRef | undefined;

  /** Resolves the scope afresh, so a re-render between attempts is harmless. */
  const scope = async (): Promise<{ rootId?: string; includeRoot?: boolean }> => {
    if (options.within === undefined) {
      return options.rootId === undefined ? {} : { rootId: options.rootId };
    }
    const target = await options.within.resolve({ timeout });
    scopeRef = target.ref;
    const ref = parseRef(target.ref);
    if (ref === null || ref.kind !== 'node') {
      throw new TypeError(
        `toMatchSemanticSnapshot({ within }) needs a semantic locator, but ` +
          `${options.within.description} resolved to ${target.ref}, which is a screen region. ` +
          'Scope with a role or test id published by the adapter.',
      );
    }
    return { rootId: ref.nodeId, includeRoot: false };
  };

  const view = (scoped: { rootId?: string; includeRoot?: boolean }): SerializeOptions => ({
    ...(options.states === undefined ? {} : { states: options.states }),
    ...scoped,
  });

  const snapshotOf = (): SemanticSnapshot => {
    const snapshot = tree();
    if (snapshot === null) {
      throw new TypeError(
        'toMatchSemanticSnapshot needs a semantic tree, but this session published none. ' +
          'Assert with toMatchCellSnapshot, or check that the adapter completed its handshake.',
      );
    }
    return snapshot;
  };

  return snapshotAssertion(this, {
    matcher: 'toMatchSemanticSnapshot',
    kind: 'semantic',
    options,
    inline: expected,
    target:
      options.within === undefined
        ? 'semantic tree'
        : `semantic tree within ${options.within.description}`,
    ref: () => scopeRef,
    ...(source === undefined ? {} : { source }),
    // the frozen contract supports semantic-tree, but the first paired tree
    // itself only becomes observable once a snapshot and its render-commit
    // marker have been paired — a screen wait can land in that gap.
    ready: () => tree() !== null,
    serialize: async () => {
      const scoped = await scope();
      return serializeSemanticSnapshot(snapshotOf(), view(scoped));
    },
    compare: async (stored) => {
      const snapshot = tree();
      if (snapshot === null) return { ok: false, actual: '', reason: 'this session published no semantic tree' };
      const scoped = await scope();
      const actual = serializeSemanticSnapshot(snapshot, view(scoped));

      // Two comparison modes, by source (CONTRACTS.md §YAML snapshots). A
      // stored file holds the full serialized tree, so it is compared
      // strictly: a node or state the app grew must fail, which partial
      // matching could never do.
      if (expected === undefined) {
        return actual.trimEnd() === stored.trimEnd()
          ? { ok: true, actual }
          : { ok: false, actual, reason: 'the semantic tree differs from the stored snapshot' };
      }

      const patterns = parseSemanticSnapshot(stored);
      const result = matchSemanticSnapshot(patterns, snapshot, scoped);
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

async function toHaveLogged(
  this: MatcherState,
  received: unknown,
  query: LogQuery,
  options: PollOptions = {},
): Promise<MatcherResult> {
  const logs = asLogCollection(received, 'toHaveLogged');
  return locatorAssertion(this, {
    matcher: 'toHaveLogged',
    options,
    eventSource: {
      revision: () => logs.revision(),
      waitForChange: (after, timeout) => logs.waitForChange(after as number, timeout),
    },
    expected: `a log entry matching ${JSON.stringify(query, replaceRegExp)}`,
    probe: async () => {
      const found = logs.filter(query);
      return {
        pass: found.length > 0,
        actual: found.length > 0 ? `${found.length} matching` : 'nothing matching',
      };
    },
    diagnostics: () => {
      const all = logs.all();
      if (all.length === 0) return 'the program logged nothing at all';
      const shown = all.slice(-LOG_DIAGNOSTIC_LINES);
      return [
        `logged (last ${shown.length} of ${all.length}):`,
        ...shown.map((entry) => `  ${formatLogEntry(entry)}`),
      ].join('\n');
    },
  });
}

/** Entries shown when a log assertion fails. */
const LOG_DIAGNOSTIC_LINES = 10;

/** `JSON.stringify` renders a RegExp as `{}`; show its source instead. */
function replaceRegExp(_key: string, value: unknown): unknown {
  return value instanceof RegExp ? String(value) : value;
}

// ---------------------------------------------------------------------------
// Shared machinery

interface Probe {
  readonly pass: boolean;
  readonly actual: string;
  readonly conclusive?: boolean;
  /** Inconclusive fact that cannot improve by polling (for example unsupported). */
  readonly fatal?: boolean;
}

function inconclusive(observation: Observation<unknown>, label: string): Probe {
  if (observation.status === 'known') {
    throw new TypeError(`internal matcher error: ${label} was passed to inconclusive() with a known value`);
  }
  if (observation.status === 'unsupported') {
    return {
      pass: false,
      conclusive: false,
      fatal: true,
      actual: `${label} unsupported (${observation.capability}: ${observation.reason})`,
    };
  }
  return { pass: false, conclusive: false, actual: `${label} ${observation.status}: ${observation.reason}` };
}

interface LocatorAssertion {
  readonly matcher: string;
  readonly locator?: AnyLocator;
  readonly options: PollOptions;
  readonly expected: string;
  probe(timeout?: number): Promise<Probe>;
  diagnostics?(): string;
  readonly eventSource?: {
    revision(): unknown;
    waitForChange(after: unknown, timeout: number): Promise<void>;
  };
}

/** The trace scope this assertion belongs to, when Vitest tells us which test it is. */
/** Whether this assertion was written as `.not`. */
function negated(state: MatcherState): boolean {
  return state.isNot === true;
}

async function locatorAssertion(state: MatcherState, spec: LocatorAssertion): Promise<MatcherResult> {
  const isNot = negated(state);
  const requestedTimeout = spec.options.timeout ?? getTermwrightConfig().timeouts.expect;
  const timeout = attemptOperationTimeout(requestedTimeout, 'assertion');
  const deadline = performance.now() + timeout;
  const target = spec.locator === undefined ? 'terminal' : describeLocator(spec.locator);
  let last: Probe = { pass: false, actual: 'not probed' };
  let failure: unknown;

  for (;;) {
    const locatorSource = spec.locator === undefined ? undefined : {
      revision: () => spec.locator?.checkpoint(),
      waitForChange: async (after: unknown, wait: number) => {
        await spec.locator?.waitForCheckpointChange({
          after: after as import('@termwright/protocol').ObservationStamp,
          timeout: wait,
        });
      },
    };
    const source = spec.eventSource ?? locatorSource;
    const checkpoint = source?.revision();
    const remaining = Math.max(0, deadline - performance.now());
    try {
      last = await spec.probe(remaining);
      failure = undefined;
    } catch (error) {
      if (isFatal(error)) throw error;
      failure = error;
      last = { pass: false, actual: errorSummary(error) };
    }
    if (last.fatal === true || (last.conclusive !== false && last.pass !== isNot) || performance.now() >= deadline) break;
    if (source === undefined || checkpoint === undefined) {
      throw new TypeError(`${spec.matcher} has no event source; polling matchers are not supported`);
    }
    try {
      await source.waitForChange(checkpoint, Math.max(0, deadline - performance.now()));
    } catch (error) {
      if (isFatal(error)) throw error;
      failure = error;
      break;
    }
  }

  // An unknown observation must fail both a positive assertion and `.not`.
  // Returning `isNot` makes Vitest's negation invert it to failure.
  const pass = last.conclusive === false ? isNot : last.pass;
  // One bounded resolve, used for both the ref the trace stores and the
  // diagnostics a failure prints: the UI needs the ref to light up the target's
  // bounds when someone clicks the row in the command log.
  const resolution = await resolveTarget(spec.locator);
  recordAssert(
    {
      api: spec.matcher,
      ok: pass !== isNot,
      selector: target,
      ...(resolution.ref === undefined ? {} : { ref: resolution.ref }),
      ...(resolution.observation === undefined ? {} : { observation: resolution.observation }),
      ...(pass === isNot ? { error: `expected ${spec.expected}, received ${last.actual}` } : {}),
    },
  );

  const diagnostics = pass === isNot ? failureDiagnostics(spec, failure, resolution.error) : '';
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
  /** Subject shown in the failure header. Defaults to the snapshot kind. */
  readonly target?: string;
  /** Ref of the scope the snapshot was taken from, when it was scoped. */
  ref?(): LocatorRef | undefined;
  /** Whether the subject can be serialized yet. Absent means always. */
  ready?(): boolean;
  /** Async because a scoped snapshot resolves its locator per attempt. */
  serialize(): string | Promise<string>;
  compare(stored: string): Comparison | Promise<Comparison>;
  readonly source?: Pick<TerminalHarness | AnyLocator, 'checkpoint' | 'waitForCheckpointChange'>;
}

async function snapshotAssertion(state: MatcherState, spec: SnapshotAssertion): Promise<MatcherResult> {
  const isNot = negated(state);
  const config = getTermwrightConfig();
  const timeout = attemptOperationTimeout(spec.options.timeout ?? config.timeouts.expect, 'assertion');
  // Allocated once per assertion: asking twice would consume two snapshot keys.
  const location =
    spec.inline === undefined ? snapshotLocation(state, spec.kind, config.snapshotDir) : undefined;
  const stored =
    spec.inline ?? (location === undefined ? undefined : readSnapshot(location.file, location.key));

  if (stored === undefined) {
    if (isNot) {
      throw new TypeError(`${spec.matcher} cannot be negated without an inline expected snapshot`);
    }
    await settle(spec, performance.now() + timeout);
    const mode = updateMode(state);
    const place = location ?? snapshotLocation(state, spec.kind, config.snapshotDir);
    const produced = await spec.serialize();
    if (mode === 'none') {
      return {
        pass: false,
        message: () =>
          `${spec.matcher}: no stored snapshot for ${JSON.stringify(place.key)}.\n` +
          `Run with \`vitest -u\` (or TERMWRIGHT_UPDATE_SNAPSHOTS=missing) to write ${place.file}.\n\n` +
          produced,
      };
    }
    writeSnapshot(place.file, place.key, produced);
    recordAssert({ api: spec.matcher, ok: true, selector: place.key });
    return { pass: true, message: () => `${spec.matcher}: snapshot written` };
  }

  const deadline = performance.now() + timeout;
  let checkpoint = spec.source?.checkpoint();
  let comparison = await spec.compare(stored);
  while (comparison.ok === isNot && performance.now() < deadline) {
    if (spec.source === undefined || checkpoint === undefined) {
      throw new TypeError(`${spec.matcher} has no event source; polling snapshots are not supported`);
    }
    try {
      await spec.source.waitForCheckpointChange({ after: checkpoint, timeout: Math.max(0, deadline - performance.now()) });
    } catch (error) {
      // No relevant revision before this assertion's own deadline means the
      // last authoritative comparison is the result. Session loss, protocol
      // failure and every other error still fail closed instead of being
      // disguised as a snapshot mismatch.
      if (!(error instanceof TimeoutError)) throw error;
      break;
    }
    checkpoint = spec.source.checkpoint();
    comparison = await spec.compare(stored);
  }

  const mode = updateMode(state);
  if (location !== undefined && !isNot) {
    if (mode === 'all' || (mode === 'changed' && !comparison.ok)) {
      writeSnapshot(location.file, location.key, comparison.actual);
      recordAssert({ api: spec.matcher, ok: true, selector: location.key });
      return { pass: true, message: () => `${spec.matcher}: snapshot updated` };
    }
  }

  const pass = comparison.ok;
  const scopeRef = spec.ref?.();
  recordAssert(
    {
      api: spec.matcher,
      ok: pass !== isNot,
      ...(scopeRef === undefined ? {} : { ref: scopeRef }),
      ...(comparison.reason === undefined ? {} : { error: comparison.reason }),
    },
  );
  return {
    pass,
    actual: comparison.actual,
    expected: stored,
    message: () =>
      report({
        matcher: spec.matcher,
        target: spec.target ?? (spec.kind === 'semantic' ? 'semantic tree' : 'screen'),
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
  let checkpoint = spec.source?.checkpoint();
  while (!spec.ready() && performance.now() < deadline) {
    if (spec.source === undefined || checkpoint === undefined) {
      throw new TypeError(`${spec.matcher} has no event source; polling snapshots are not supported`);
    }
    await spec.source.waitForCheckpointChange({ after: checkpoint, timeout: Math.max(0, deadline - performance.now()) });
    checkpoint = spec.source.checkpoint();
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
function snapshotLocation(_state: MatcherState, kind: SnapshotKind, dir: string): SnapshotLocation {
  const attempt = currentAttemptContext();
  return {
    file: snapshotFilePath(attempt.file, kind, dir),
    key: nextSnapshotKey(attempt.fullName, kind),
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

/** The most specific explanation available for a failed locator assertion. */
function failureDiagnostics(spec: LocatorAssertion, probeError: unknown, resolveError: unknown): string {
  const own = spec.diagnostics?.();
  if (own !== undefined && own !== '') return own;
  const fromProbe = diagnosticsBlock(probeError);
  return fromProbe !== '' ? fromProbe : diagnosticsBlock(resolveError);
}

/**
 * Resolves a locator once, without waiting and without throwing.
 *
 * A matcher that just passed resolves immediately; one that failed yields the
 * driver's error, whose diagnostics are what the failure message prints.
 */
async function resolveTarget(locator: AnyLocator | undefined): Promise<{ ref?: LocatorRef; observation?: import('@termwright/protocol').ObservationStamp; error?: unknown }> {
  if (locator === undefined) return {};
  try {
    const ref = (await locator.resolve({ timeout: 1 })).ref;
    const observation = typeof locator.geometry === 'function' ? (await locator.geometry()).stamp : undefined;
    return { ref, ...(observation === undefined ? {} : { observation }) };
  } catch (error) {
    return { error };
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

function describeLocator(locator: AnyLocator): string {
  const described = (locator as { description?: unknown }).description;
  return typeof described === 'string' ? described : 'locator';
}

function isLocator(value: unknown): value is AnyLocator {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AnyLocator>;
  return typeof candidate.resolve === 'function' && typeof candidate.visibility === 'function';
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

function asLocator(value: unknown, matcher: string): AnyLocator {
  if (isLocator(value)) return value;
  throw new TypeError(`${matcher} expects a locator, received ${describeValue(value)}`);
}

function asSemanticLocator(value: unknown, matcher: string): SemanticLocator {
  const locator = asLocator(value, matcher);
  if (locator.domain === 'semantic') return locator;
  throw new TypeError(`${matcher} requires a semantic locator, received a screen locator`);
}

function asScreenSource(value: unknown, matcher: string): () => ScreenSnapshot {
  if (isHarness(value)) return () => value.screen();
  if (isScreen(value)) return () => value;
  throw new TypeError(`${matcher} expects a terminal or a screen snapshot, received ${describeValue(value)}`);
}

/** A log collection, a terminal factory holding one, or a harness with one. */
function asLogCollection(value: unknown, matcher: string): LogCollection {
  if (isLogCollection(value)) return value;
  const nested = (value as { logs?: unknown } | null)?.logs;
  if (isLogCollection(nested)) return nested;
  if (typeof value === 'object' && value !== null) {
    const attached = logsOf(value);
    if (attached !== undefined) return attached;
  }
  throw new TypeError(
    `${matcher} expects a terminal, a harness with collected logs, or a log collection, ` +
      `received ${describeValue(value)}. For a harness the fixtures did not launch, call collectLogs(harness) first.`,
  );
}

function isLogCollection(value: unknown): value is LogCollection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LogCollection>;
  return typeof candidate.all === 'function' && typeof candidate.filter === 'function';
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
  toBeAttached,
  toBeDetached,
  toBeDisplayed,
  toBeHidden,
  toBeOffscreen,
  toBeInViewport,
  toReceivePointerEvents,
  toHaveBounds,
  toHaveSpatialRelation,
  toHaveLogged,
  toBeFocused,
  toBeEnabled,
  toBeDisabled,
  toBeChecked,
  toBeSelected,
  toBeExpanded,
  toHaveValue,
  toHaveState,
  toHaveExtendedState,
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
