import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Locator, ScreenSnapshot, TerminalHarness } from '@termwright/driver';
import type {
  LocatorGeometry,
  LocatorVisibility,
  PointerHitTest,
  SemanticExtendedState,
  SemanticSnapshot,
  SemanticState,
} from '@termwright/protocol';
import { fakeScreen } from './__fixtures__/screen.js';
import { node, permissionDialog, snapshot } from './__fixtures__/tree.js';
import { configureTermwright, resetTermwrightConfig } from './config.js';
import { registerTermwrightMatchers } from './matchers.js';
import { beginSnapshotScope, resetSnapshotCache } from './snapshot-store.js';
import { createLogCollection, type CapturedLog } from './logs.js';
import { enterScope, type TermwrightScope } from './trace-context.js';
import { resolveTermwrightConfig } from './config.js';
import type { TraceWriter } from '@termwright/trace';

registerTermwrightMatchers();

const evidence = (providerId: string) => ({
  source: 'framework' as const,
  method: 'native' as const,
  strength: 'authoritative' as const,
  providerId,
});

interface FakeLocatorState {
  visible?: boolean;
  state?: SemanticState | null;
  extended?: SemanticExtendedState | null;
  text?: string;
  value?: string | null;
  ref?: string;
  resolveError?: unknown;
  visibility?: LocatorVisibility;
  geometry?: LocatorGeometry;
  hitTest?: PointerHitTest;
}

/** A locator with just the surface the matchers touch. */
function fakeLocator(read: () => FakeLocatorState, description = 'getByRole("button")'): Locator {
  const locator = {
    description,
    async evaluateCondition(condition: import('@termwright/protocol').Condition) {
      const error = read().resolveError;
      if (error !== undefined && typeof error === 'object' && error !== null &&
          'code' in error && error.code === 'capability-unavailable') throw error;
      const checkpoint = { sessionId: 'fake', contractId: 'fake:0', epoch: 0, sequence: 1, screenRevision: 1, semanticRevision: 1, pairedScreenRevision: 1 } as const;
      const known = (value: boolean): import('@termwright/protocol').Observation<boolean> =>
        ({ status: 'known', value, evidence: evidence('canonical-condition') });
      let observation: import('@termwright/protocol').Observation<boolean>;
      const visibility = await locator.visibility();
      const state = read().state;
      if (condition.kind === 'attached' || condition.kind === 'detached') {
        const attached = visibility.attached.status === 'known' ? visibility.attached.value : false;
        observation = known(condition.kind === 'attached' ? attached : !attached);
      } else if (visibility.attached.status === 'known' && !visibility.attached.value) {
        observation = condition.kind === 'hidden'
          ? known(true)
          : visibility.displayed as import('@termwright/protocol').Observation<boolean>;
      } else if (condition.kind === 'displayed' || condition.kind === 'hidden') {
        observation = visibility.displayed.status === 'known'
          ? known(condition.kind === 'displayed' ? visibility.displayed.value : !visibility.displayed.value)
          : visibility.displayed as import('@termwright/protocol').Observation<boolean>;
      } else if (condition.kind === 'visible' || condition.kind === 'in-viewport' || condition.kind === 'offscreen') {
        const viewport = visibility.viewport;
        observation = viewport.status === 'known'
          ? known(condition.kind === 'offscreen' ? viewport.value.ratio === 0 : condition.kind === 'visible' ? viewport.value.ratio > 0 : viewport.value.ratio >= condition.minRatio)
          : viewport as import('@termwright/protocol').Observation<boolean>;
      } else if (condition.kind === 'receives-pointer') {
        const receives = (await locator.hitTest()).receivesEvents;
        observation = receives.status === 'known'
          ? known(receives.value)
          : receives as import('@termwright/protocol').Observation<boolean>;
      } else if (condition.kind === 'value') {
        const value = read().value;
        const matcher = condition.matcher;
        observation = known(value !== null && value !== undefined && (matcher.kind === 'regex'
          ? new RegExp(matcher.source, matcher.flags.replace(/[gy]/gu, '')).test(value)
          : matcher.kind === 'exact' ? value === matcher.text : value.includes(matcher.text)));
      } else if (state === null || state === undefined) {
        observation = { status: 'unsupported', capability: condition.kind, reason: 'capability' };
      } else if (condition.kind === 'focused') observation = known(state.focused === true);
      else if (condition.kind === 'enabled') observation = known(state.disabled !== true);
      else if (condition.kind === 'disabled') observation = known(state.disabled === true);
      else if (condition.kind === 'checked' || condition.kind === 'selected' || condition.kind === 'expanded') {
        const actual = state[condition.kind];
        observation = actual === undefined
          ? { status: 'unsupported', capability: condition.kind, reason: 'capability' }
          : known(actual === condition.value);
      } else if (condition.kind === 'collapsed') observation = known(state.expanded === false);
      else observation = { status: 'unsupported', capability: condition.kind, reason: 'capability' };
      return { condition, checkpoint, observation, verdict: observation.status === 'known' ? observation.value ? 'satisfied' as const : 'unsatisfied' as const : 'inconclusive' as const };
    },
    async visibility() {
      const supplied = read().visibility;
      if (supplied !== undefined) return supplied;
      const visible = read().visible ?? false;
      const stamp = { sessionId: 'fake', contractId: 'fake:0', epoch: 0, sequence: 1, screenRevision: 1, semanticRevision: 1, pairedScreenRevision: 1 } as const;
      return {
        stamp,
        attached: { status: 'known', value: true, evidence: evidence('adapter') },
        displayed: { status: 'known', value: visible, evidence: evidence('adapter') },
        viewport: { status: 'known', value: { rect: { row: 0, column: 0, width: visible ? 1 : 0, height: visible ? 1 : 0 }, ratio: visible ? 1 : 0, fullyInside: visible }, evidence: evidence('viewport-clip') },
        offscreen: { status: 'known', value: !visible, evidence: evidence('viewport-clip') },
      };
    },
    async geometry() {
      const supplied = read().geometry;
      if (supplied !== undefined) return supplied;
      const stamp = { sessionId: 'fake', contractId: 'fake:0', epoch: 0, sequence: 1, screenRevision: 1, semanticRevision: 1, pairedScreenRevision: 1 } as const;
      const rect = { row: 0, column: 0, width: 1, height: 1 };
      return {
        stamp,
        coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence('probe') },
        intendedRect: { status: 'known', value: rect, evidence: evidence('probe') },
        visibleRect: { status: 'known', value: rect, evidence: evidence('viewport-clip') },
      };
    },
    async hitTest() {
      const supplied = read().hitTest;
      if (supplied !== undefined) return supplied;
      const stamp = { sessionId: 'fake', contractId: 'fake:0', epoch: 0, sequence: 1, screenRevision: 1, semanticRevision: 1, pairedScreenRevision: 1 } as const;
      return {
        stamp,
        point: { status: 'known', value: { row: 0, column: 0 }, evidence: evidence('hit-grid') },
        receivesEvents: { status: 'known', value: true, evidence: evidence('hit-grid') },
        recipient: { status: 'known', value: 'n1', evidence: evidence('hit-grid') },
      };
    },
    async semanticState() {
      const error = read().resolveError;
      if (error !== undefined) throw error;
      return read().state ?? null;
    },
    async extendedState() {
      const error = read().resolveError;
      if (error !== undefined) throw error;
      return read().extended ?? null;
    },
    async textContent() {
      return read().text ?? '';
    },
    async semanticValue() {
      return read().value ?? null;
    },
    async resolve() {
      const error = read().resolveError;
      if (error !== undefined) throw error;
      const ref = read().ref ?? 'n1@1';
      return { ref, revision: 1, semantic: ref.startsWith('n'), rect: null };
    },
  };
  return locator as unknown as Locator;
}

function fakeHarness(read: () => { screen?: ScreenSnapshot; tree?: SemanticSnapshot | null }): TerminalHarness {
  const harness = {
    screen: () => read().screen ?? fakeScreen(['']),
    semanticTree: () => read().tree ?? null,
  };
  return harness as unknown as TerminalHarness;
}

/** A driver-shaped failure, so the matcher can harvest its diagnostics. */
function timeoutError(): Error & { code: string } {
  const error = new Error('locator getByRole("button") matched 0 nodes; expected exactly one') as Error & {
    code: string;
    diagnostics: unknown;
  };
  error.code = 'timeout';
  error.diagnostics = {
    semanticTree: true,
    suggestion: 'narrow the locator with within()',
    candidates: [{ role: 'button', name: 'Reject', ref: 'n4@7' }],
    screenExcerpt: 'Permission required',
  };
  return error;
}

const directories: string[] = [];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-matchers-'));
  directories.push(dir);
  // The snapshot mode is pinned, never inherited. Left ambient, these tests
  // would run in whatever mode the environment implies — and on CI Vitest
  // implies `none`, which is right for a real suite (a missing baseline must
  // fail rather than be written) and fatal for tests whose subject is writing
  // one. Tests that need another mode set it themselves.
  configureTermwright({ timeouts: { expect: 250 }, snapshotDir: dir, updateSnapshots: 'missing' });
  beginSnapshotScope();
  resetSnapshotCache();
});

afterEach(() => {
  resetTermwrightConfig();
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

describe('toBeVisible', () => {
  it('passes for a visible locator and its negation for a hidden one', async () => {
    await expect(fakeLocator(() => ({ visible: true }))).toBeVisible();
    await expect(fakeLocator(() => ({ visible: false }))).not.toBeVisible();
  });

  it('polls until the node appears', async () => {
    const appearsAt = Date.now() + 80;
    await expect(fakeLocator(() => ({ visible: Date.now() >= appearsAt }))).toBeVisible();
  });

  it('reports what it expected, what it saw, and the driver diagnostics', async () => {
    const locator = fakeLocator(() => ({ visible: false, resolveError: timeoutError() }));
    await expect(async () => {
      await expect(locator).toBeVisible({ timeout: 50 });
    }).rejects.toThrow(/Expected: visible[\s\S]*Received: hidden[\s\S]*Timeout:  50ms/u);
    await expect(async () => {
      await expect(locator).toBeVisible({ timeout: 50 });
    }).rejects.toThrow(/candidates:\n {2}- button "Reject" ref=n4@7[\s\S]*screen:/u);
  });

  it('refuses a subject that is not a locator', async () => {
    await expect(async () => {
      await expect(42).toBeVisible();
    }).rejects.toThrow(/toBeVisible expects a locator, received number/u);
  });

  it('rejects the removed boolean-only visibility surface instead of falling back to it', async () => {
    const legacy = {
      description: 'legacy locator',
      async resolve() { return { ref: 'n1@1', revision: 1, semantic: true, rect: null }; },
      async isVisible() { return true; },
    };
    await expect(expect(legacy).toBeVisible({ timeout: 0 })).rejects.toThrow(/expects a locator/u);
    await expect(expect(legacy).not.toBeVisible({ timeout: 0 })).rejects.toThrow(/expects a locator/u);
  });

  it('fails fast on an error that waiting cannot fix', async () => {
    const fatal = Object.assign(new Error('no semantic tree'), {
      code: 'capability-unavailable',
      diagnostics: { semanticTree: false },
    });
    const started = Date.now();
    await expect(async () => {
      await expect(fakeLocator(() => ({ resolveError: fatal, visible: false }))).toBeFocused({ timeout: 5_000 });
    }).rejects.toThrow(/no semantic tree/u);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('never lets unknown evidence pass either the positive or negated assertion', async () => {
    const stamp = { sessionId: 'fake', contractId: 'fake:0', epoch: 0, sequence: 1, screenRevision: 1, semanticRevision: 1, pairedScreenRevision: 1 } as const;
    const unknown = { status: 'unknown', reason: 'stale-revision' } as const;
    const locator = fakeLocator(() => ({
      visibility: {
        stamp,
        attached: { status: 'known', value: true, evidence: evidence('probe') },
        displayed: { status: 'known', value: true, evidence: evidence('probe') },
        viewport: unknown,
        offscreen: unknown,
      },
    }));
    await expect(expect(locator).toBeVisible({ timeout: 0 })).rejects.toThrow(/unknown/u);
    await expect(expect(locator).not.toBeVisible({ timeout: 0 })).rejects.toThrow(/unknown/u);
  });

  it('never lets unsupported evidence pass either the positive or negated assertion', async () => {
    const stamp = { sessionId: 'fake', contractId: 'fake:0', epoch: 0, sequence: 1, screenRevision: 1, semanticRevision: 1, pairedScreenRevision: 1 } as const;
    const unsupported = {
      status: 'unsupported', capability: 'visible-rect', reason: 'framework-unobservable',
    } as const;
    const locator = fakeLocator(() => ({
      visibility: {
        stamp,
        attached: { status: 'known', value: true, evidence: evidence('probe') },
        displayed: { status: 'known', value: true, evidence: evidence('probe') },
        viewport: unsupported,
        offscreen: unsupported,
      },
    }));
    await expect(expect(locator).toBeVisible({ timeout: 0 })).rejects.toThrow(/unsupported/u);
    await expect(expect(locator).not.toBeVisible({ timeout: 0 })).rejects.toThrow(/unsupported/u);
  });
});

describe('qualified geometry matchers', () => {
  const stamp = { sessionId: 'fake', contractId: 'fake:0', epoch: 0, sequence: 7, screenRevision: 4, semanticRevision: 7, pairedScreenRevision: 4 } as const;
  const geometry = (rect: { row: number; column: number; width: number; height: number }): LocatorGeometry => ({
    stamp,
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence('probe') },
    intendedRect: { status: 'known', value: rect, evidence: evidence('probe') },
    visibleRect: { status: 'known', value: rect, evidence: evidence('viewport-clip') },
  });

  it('distinguishes attachment and display state from viewport clipping', async () => {
    const detached: LocatorVisibility = {
      stamp,
      attached: { status: 'known', value: false, evidence: evidence('adapter') },
      displayed: { status: 'absent', reason: 'detached', evidence: evidence('adapter') },
      viewport: { status: 'absent', reason: 'detached', evidence: evidence('adapter') },
      offscreen: { status: 'absent', reason: 'detached', evidence: evidence('adapter') },
    };
    const hidden: LocatorVisibility = {
      stamp,
      attached: { status: 'known', value: true, evidence: evidence('adapter') },
      displayed: { status: 'known', value: false, evidence: evidence('probe') },
      viewport: { status: 'absent', reason: 'not-displayed', evidence: evidence('probe') },
      offscreen: { status: 'absent', reason: 'not-displayed', evidence: evidence('probe') },
    };
    const offscreen: LocatorVisibility = {
      stamp,
      attached: { status: 'known', value: true, evidence: evidence('adapter') },
      displayed: { status: 'known', value: true, evidence: evidence('probe') },
      viewport: {
        status: 'known',
        value: { rect: { row: 20, column: 0, width: 1, height: 0 }, ratio: 0, fullyInside: false },
        evidence: evidence('viewport-clip'),
      },
      offscreen: { status: 'known', value: true, evidence: evidence('viewport-clip') },
    };
    await expect(fakeLocator(() => ({ visibility: detached }))).toBeDetached();
    await expect(fakeLocator(() => ({ visibility: detached }))).toBeHidden();
    await expect(expect(fakeLocator(() => ({ visibility: detached }))).not.toBeEnabled()).rejects.toThrow(/absent/u);
    await expect(fakeLocator(() => ({ visibility: hidden }))).toBeAttached();
    await expect(fakeLocator(() => ({ visibility: hidden }))).toBeHidden();
    await expect(fakeLocator(() => ({ visibility: offscreen }))).toBeDisplayed();
    await expect(fakeLocator(() => ({ visibility: offscreen }))).not.toBeHidden();
    await expect(fakeLocator(() => ({ visibility: offscreen }))).toBeOffscreen();
  });

  it('treats an explicit viewport ratio as an inclusive minimum and the default as non-zero', async () => {
    const visibility: LocatorVisibility = {
      stamp,
      attached: { status: 'known', value: true, evidence: evidence('probe') },
      displayed: { status: 'known', value: true, evidence: evidence('probe') },
      viewport: {
        status: 'known',
        value: { rect: { row: 0, column: 0, width: 1, height: 1 }, ratio: 0.5, fullyInside: false },
        evidence: evidence('viewport-clip'),
      },
      offscreen: { status: 'known', value: false, evidence: evidence('viewport-clip') },
    };
    const locator = fakeLocator(() => ({ visibility }));
    await expect(locator).toBeInViewport({ ratio: 0.5 });
    await expect(locator).not.toBeInViewport({ ratio: 0.75 });
    await expect(locator).toBeInViewport();
    await expect(expect(locator).toBeInViewport({ ratio: 1.1 })).rejects.toThrow(/ratio must be/u);
  });

  it('matches exact bounds and half-open spatial relations', async () => {
    const left = fakeLocator(() => ({ geometry: geometry({ row: 2, column: 1, width: 3, height: 2 }) }), 'left');
    const right = fakeLocator(() => ({ geometry: geometry({ row: 2, column: 4, width: 2, height: 2 }) }), 'right');
    await expect(left).toHaveBounds({ row: 2, width: 3 });
    await expect(left).toHaveSpatialRelation({ relation: 'left-of', target: right });
    await expect(left).toHaveSpatialRelation({ relation: 'adjacent-horizontal', target: right });
    await expect(left).not.toHaveSpatialRelation({ relation: 'overlaps', target: right });
  });

  it('never compares geometry from different sessions or observation revisions', async () => {
    const source = fakeLocator(() => ({ geometry: geometry({ row: 0, column: 0, width: 1, height: 1 }) }), 'source');
    const otherSession = fakeLocator(() => ({ geometry: {
      ...geometry({ row: 0, column: 2, width: 1, height: 1 }),
      stamp: { ...stamp, sessionId: 'other' },
    } }), 'other-session');
    const otherRevision = fakeLocator(() => ({ geometry: {
      ...geometry({ row: 0, column: 2, width: 1, height: 1 }),
      stamp: { ...stamp, screenRevision: stamp.screenRevision + 1 },
    } }), 'other-revision');
    await expect(expect(source).toHaveSpatialRelation({ relation: 'left-of', target: otherSession }, { timeout: 0 })).rejects.toThrow(/different terminal sessions/u);
    await expect(expect(source).not.toHaveSpatialRelation({ relation: 'left-of', target: otherSession }, { timeout: 0 })).rejects.toThrow(/different terminal sessions/u);
    await expect(expect(source).toHaveSpatialRelation({ relation: 'left-of', target: otherRevision }, { timeout: 0 })).rejects.toThrow(/different revisions/u);
  });

  it('uses exact point ownership and keeps unsupported hit tests fail-closed', async () => {
    const locator = fakeLocator(() => ({}));
    await expect(locator).toReceivePointerEvents();
    const unsupported = {
      status: 'unsupported', capability: 'pointer-hit-test', reason: 'framework-unobservable',
    } as const;
    const unobservable = fakeLocator(() => ({ hitTest: {
      stamp,
      point: { status: 'known', value: { row: 0, column: 0 }, evidence: evidence('probe') },
      receivesEvents: unsupported,
      recipient: unsupported,
    } }));
    await expect(expect(unobservable).toReceivePointerEvents({ timeout: 0 })).rejects.toThrow(/unsupported/u);
    await expect(expect(unobservable).not.toReceivePointerEvents({ timeout: 0 })).rejects.toThrow(/unsupported/u);
  });
});

describe('toBeFocused and toHaveState', () => {
  it('reads the semantic state', async () => {
    await expect(fakeLocator(() => ({ state: { focused: true } }))).toBeFocused();
    await expect(fakeLocator(() => ({ state: { focused: false } }))).not.toBeFocused();
    await expect(fakeLocator(() => ({ state: { focused: true, disabled: false } }))).toHaveState({ focused: true });
  });

  it('constrains only the listed keys', async () => {
    const locator = fakeLocator(() => ({ state: { focused: true, disabled: true, modal: true } }));
    await expect(locator).toHaveState({ disabled: true });
    await expect(async () => {
      await expect(locator).toHaveState({ disabled: false }, { timeout: 50 });
    }).rejects.toThrow(/Expected: \{"disabled":false\}[\s\S]*Received: \{"disabled":true\}/u);
  });

  it('says when the node is not semantic at all', async () => {
    await expect(async () => {
      await expect(fakeLocator(() => ({ state: null }))).toBeFocused({ timeout: 50 });
    }).rejects.toThrow(/focused unsupported/u);
  });
});

describe('common semantic state matchers', () => {
  it('reads portable boolean state without requiring generic state objects', async () => {
    const locator = fakeLocator(() => ({
      state: { disabled: false, checked: true, selected: true, expanded: true },
    }));
    await expect(locator).toBeEnabled();
    await expect(locator).not.toBeDisabled();
    await expect(locator).toBeChecked();
    await expect(locator).toBeSelected();
    await expect(locator).toBeExpanded();
  });

  it('treats an omitted disabled flag as enabled but not as a checked state', async () => {
    const locator = fakeLocator(() => ({ state: {} }));
    await expect(locator).toBeEnabled();
    await expect(expect(locator).toBeChecked({ timeout: 0 })).rejects.toThrow(/checked unsupported/u);
  });

  it('matches the published semantic value rather than the accessible name', async () => {
    const locator = fakeLocator(() => ({ value: 'deployment-42', text: 'Deploy production' }));
    await expect(locator).toHaveValue('deployment-42');
    await expect(locator).not.toHaveValue('Deploy production');
  });
});

describe('toHaveExtendedState', () => {
  it('deep-matches listed domain keys without constraining the rest', async () => {
    const locator = fakeLocator(() => ({
      extended: {
        deploymentStatus: 'rolling-out',
        retryCount: 2,
        rollout: { regions: ['eu', 'us'], percent: 0.5 },
        ignored: true,
      },
    }));
    await expect(locator).toHaveExtendedState({
      deploymentStatus: 'rolling-out',
      rollout: { regions: ['eu', 'us'], percent: 0.5 },
    });
    await expect(async () => {
      await expect(locator).toHaveExtendedState({ retryCount: 3 }, { timeout: 50 });
    }).rejects.toThrow(/Expected: \{"retryCount":3\}[\s\S]*Received: \{"retryCount":2\}/u);
  });

  it('distinguishes a missing namespace from an empty one', async () => {
    await expect(async () => {
      await expect(fakeLocator(() => ({ extended: null }))).toHaveExtendedState({}, { timeout: 50 });
    }).rejects.toThrow(/no extended state/u);
    await expect(fakeLocator(() => ({ extended: {} }))).toHaveExtendedState({});
  });
});

describe('toHaveText', () => {
  it('compares the text of a locator exactly, after normalizing whitespace', async () => {
    await expect(fakeLocator(() => ({ text: '  Approve  ' }))).toHaveText('Approve');
    await expect(fakeLocator(() => ({ text: 'Approve all' }))).not.toHaveText('Approve');
    await expect(fakeLocator(() => ({ text: 'Approve all' }))).toHaveText('Approve', { exact: false });
    await expect(fakeLocator(() => ({ text: 'Approve all' }))).toHaveText(/^Approve/u);
  });

  it('searches the whole screen when the subject is a terminal', async () => {
    const harness = fakeHarness(() => ({ screen: fakeScreen(['Permission required', 'last: none']) }));
    await expect(harness).toHaveText('last: none');
    await expect(async () => {
      await expect(harness).toHaveText('ACTIVATED', { timeout: 50 });
    }).rejects.toThrow(/screen:[\s\S]*Permission required/u);
  });
});

describe('toMatchSemanticSnapshot', () => {
  it('matches an inline pattern partially', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    await expect(harness).toMatchSemanticSnapshot(`
      - dialog "Permission" [modal]:
          - button "Approve" [focused]
    `);
  });

  it('accepts a snapshot object directly', async () => {
    await expect(permissionDialog()).toMatchSemanticSnapshot('- dialog "Permission"');
  });

  it('polls until the tree settles', async () => {
    const settlesAt = Date.now() + 80;
    const harness = fakeHarness(() => ({
      tree: Date.now() >= settlesAt ? permissionDialog() : snapshot([node('n1', 'text', 'Loading')]),
    }));
    await expect(harness).toMatchSemanticSnapshot('- dialog "Permission"');
  });

  it('prints both trees and the reason on a mismatch', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot('- dialog "Denied"', { timeout: 50 });
    }).rejects.toThrow(/Expected:[\s\S]*- dialog "Denied"[\s\S]*Received:[\s\S]*- dialog "Permission" \[modal\]/u);
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot('- dialog "Denied"', { timeout: 50 });
    }).rejects.toThrow(/reason: "dialog \\"Denied\\"" — closest candidate: name is "Permission"/u);
  });

  it('waits out the gap before the first tree is observable', async () => {
    const arrivesAt = Date.now() + 80;
    const harness = fakeHarness(() => ({ tree: Date.now() >= arrivesAt ? permissionDialog() : null }));
    await expect(harness).toMatchSemanticSnapshot('- dialog "Permission"');
  });

  it('explains a session that published no tree', async () => {
    const harness = fakeHarness(() => ({ tree: null }));
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot('- dialog "X"', { timeout: 50 });
    }).rejects.toThrow(/published no semantic tree/u);
  });

  it('scopes the pattern to the inside of a locator', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    const dialog = fakeLocator(() => ({ ref: 'n1@1' }), 'getByRole("dialog")');
    await expect(harness).toMatchSemanticSnapshot(
      ['- button "Approve" [focused]', '- button "Reject"'].join('\n'),
      { within: dialog },
    );
  });

  it('re-resolves the scope on every attempt', async () => {
    const movesAt = Date.now() + 80;
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    // Resolves to the focused button first, to the dialog once the app settles.
    const moving = fakeLocator(() => ({ ref: Date.now() >= movesAt ? 'n1@1' : 'n3@1' }), 'getByTestId("scope")');
    await expect(harness).toMatchSemanticSnapshot('- button "Approve" [focused]', { within: moving });
  });

  it('names the scope in the failure header', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    const dialog = fakeLocator(() => ({ ref: 'n1@1' }), 'getByRole("dialog")');
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot('- button "Deny"', { within: dialog, timeout: 50 });
    }).rejects.toThrow(/expect\(semantic tree within getByRole\("dialog"\)\)\.toMatchSemanticSnapshot\(\)/u);
  });

  it('refuses a scope that is not a semantic node', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    const region = fakeLocator(() => ({ ref: 'grid:1,2,9,1@4' }), 'getByText("Approve")');
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot('- button "Approve"', { within: region });
    }).rejects.toThrow(/needs a semantic locator[\s\S]*resolved to grid:1,2,9,1@4/u);
  });

  it('refuses to scope twice', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot('- button "Approve"', {
        within: fakeLocator(() => ({ ref: 'n1@1' })),
        rootId: 'n1',
      });
    }).rejects.toThrow(/either \{ within \} or \{ rootId \}, not both/u);
  });

  it('supports negation with an inline pattern', async () => {
    await expect(permissionDialog()).not.toMatchSemanticSnapshot('- alert "Boom"');
  });
});

describe('toMatchCellSnapshot', () => {
  it('compares the framed grid', async () => {
    const harness = fakeHarness(() => ({ screen: fakeScreen(['ready'], { columns: 5, rows: 1 }) }));
    await expect(harness).toMatchCellSnapshot(['┌─ 5×1 ┐', '│ready│', '└─────┘', ''].join('\n'));
  });

  it('reports the difference as two blocks', async () => {
    const harness = fakeHarness(() => ({ screen: fakeScreen(['ready'], { columns: 5, rows: 1 }) }));
    await expect(async () => {
      await expect(harness).toMatchCellSnapshot('nope', { timeout: 50 });
    }).rejects.toThrow(/Expected:\n {2}nope[\s\S]*Received:\n {2}┌─ 5×1 ┐/u);
  });
});

describe('external snapshots', () => {
  it('writes a missing snapshot, then matches it', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    await expect(harness).toMatchSemanticSnapshot();
    beginSnapshotScope();
    await expect(harness).toMatchSemanticSnapshot();
  });

  it('fails instead of writing when updates are disabled', async () => {
    configureTermwright({
      timeouts: { expect: 100 },
      snapshotDir: directories[directories.length - 1] as string,
      updateSnapshots: 'none',
    });
    await expect(async () => {
      await expect(fakeHarness(() => ({ tree: permissionDialog() }))).toMatchSemanticSnapshot();
    }).rejects.toThrow(/no stored snapshot for[\s\S]*TERMWRIGHT_UPDATE_SNAPSHOTS=missing/u);
  });

  it('rewrites a mismatching snapshot in changed mode', async () => {
    const dir = directories[directories.length - 1] as string;
    const state = { tree: snapshot([node('n1', 'text', 'first')]) };
    const harness = fakeHarness(() => state);
    await expect(harness).toMatchSemanticSnapshot();

    state.tree = snapshot([node('n1', 'text', 'second')]);
    beginSnapshotScope();
    resetSnapshotCache();
    configureTermwright({ timeouts: { expect: 100 }, snapshotDir: dir, updateSnapshots: 'none' });
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot();
    }).rejects.toThrow(/differs from the stored snapshot[\s\S]*/u);

    beginSnapshotScope();
    configureTermwright({ timeouts: { expect: 100 }, snapshotDir: dir, updateSnapshots: 'changed' });
    await expect(harness).toMatchSemanticSnapshot();

    beginSnapshotScope();
    configureTermwright({ timeouts: { expect: 100 }, snapshotDir: dir, updateSnapshots: 'none' });
    await expect(harness).toMatchSemanticSnapshot();
  });

  it('waits for the first tree before writing a new snapshot', async () => {
    const dir = directories[directories.length - 1] as string;
    const arrivesAt = Date.now() + 80;
    const harness = fakeHarness(() => ({ tree: Date.now() >= arrivesAt ? permissionDialog() : null }));
    await expect(harness).toMatchSemanticSnapshot();
    const stored = readFileSync(join(dir, 'matchers.test.ts.tw-semantic.yaml'), 'utf8');
    expect(stored).toContain('- dialog "Permission" [modal]:');
  });

  it('compares a stored snapshot strictly: a new node fails', async () => {
    const state = {
      tree: snapshot([node('n1', 'dialog', 'Permission'), node('n2', 'button', 'Approve', { parentId: 'n1' })]),
    };
    const harness = fakeHarness(() => state);
    await expect(harness).toMatchSemanticSnapshot();

    // The app grew a node. A partial match would still pass here, which is
    // exactly what a stored snapshot must not do (CONTRACTS.md §YAML).
    state.tree = snapshot([
      node('n1', 'dialog', 'Permission'),
      node('n2', 'button', 'Approve', { parentId: 'n1' }),
      node('n3', 'button', 'Reject', { parentId: 'n1' }),
    ]);
    beginSnapshotScope();
    configureTermwright({
      timeouts: { expect: 100 },
      snapshotDir: directories[directories.length - 1] as string,
      updateSnapshots: 'none',
    });
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot();
    }).rejects.toThrow(/Received:[\s\S]*button "Reject"[\s\S]*differs from the stored snapshot/u);
  });

  it('compares a stored snapshot strictly: a new state fails', async () => {
    const state = { tree: snapshot([node('n1', 'button', 'Approve')]) };
    const harness = fakeHarness(() => state);
    await expect(harness).toMatchSemanticSnapshot();

    // Same nodes, same names — only a flag appeared. The stored oracle exists
    // to catch exactly this.
    state.tree = snapshot([node('n1', 'button', 'Approve', { state: { focused: true } })]);
    beginSnapshotScope();
    configureTermwright({
      timeouts: { expect: 100 },
      snapshotDir: directories[directories.length - 1] as string,
      updateSnapshots: 'none',
    });
    await expect(async () => {
      await expect(harness).toMatchSemanticSnapshot();
    }).rejects.toThrow(/Expected:[\s\S]*- button "Approve"[\s\S]*Received:[\s\S]*\[focused\][\s\S]*differs from the stored snapshot/u);
  });

  it('keeps an inline pattern partial: a new node is fine', async () => {
    const harness = fakeHarness(() => ({ tree: permissionDialog() }));
    await expect(harness).toMatchSemanticSnapshot(`
      - dialog "Permission":
          - button "Approve"
    `);
  });

  it('gives each assertion in a test its own key', async () => {
    const dir = directories[directories.length - 1] as string;
    const state = { tree: snapshot([node('n1', 'text', 'first')]) };
    const harness = fakeHarness(() => state);
    await expect(harness).toMatchSemanticSnapshot();
    state.tree = snapshot([node('n1', 'text', 'second')]);
    await expect(harness).toMatchSemanticSnapshot();

    const file = join(dir, 'matchers.test.ts.tw-semantic.yaml');
    const stored = readFileSync(file, 'utf8');
    expect(stored).toContain('own key 1');
    expect(stored).toContain('own key 2');
    expect(stored).toContain('- text "first"');
    expect(stored).toContain('- text "second"');
  });

  it('refuses to negate an external snapshot', async () => {
    await expect(async () => {
      await expect(fakeHarness(() => ({ tree: permissionDialog() }))).not.toMatchSemanticSnapshot();
    }).rejects.toThrow(/cannot be negated without an inline expected snapshot/u);
  });
});

describe('toHaveLogged', () => {
  function logs(...entries: CapturedLog[]) {
    const collection = createLogCollection();
    for (const entry of entries) collection.push(entry);
    return collection;
  }

  let seq = 0;

  /** A record with a fresh `seq`: records sharing one are deduplicated. */
  function record(level: 'info' | 'warn' | 'error', message: string): CapturedLog {
    seq += 1;
    return { source: 'adapter', sessionId: 's1', timeMs: 1, record: { ts: 1, level, message, seq } };
  }

  it('accepts a log collection and anything holding one', async () => {
    const collection = logs(record('error', 'save failed'));
    await expect(collection).toHaveLogged({ level: 'error' });
    // A terminal factory exposes its logs as `.logs`.
    await expect({ logs: collection }).toHaveLogged({ message: 'save failed' });
  });

  it('polls until the entry shows up', async () => {
    const collection = createLogCollection();
    setTimeout(() => collection.push(record('warn', 'late arrival')), 80);
    await expect(collection).toHaveLogged({ message: 'late arrival' });
  });

  it('supports asserting that nothing was logged', async () => {
    await expect(logs(record('info', 'fine'))).not.toHaveLogged({ level: 'error' });
  });

  it('shows what was logged when nothing matched', async () => {
    const collection = logs(record('info', 'starting'), record('warn', 'disk almost full'));
    await expect(async () => {
      await expect(collection).toHaveLogged({ level: 'error' }, { timeout: 50 });
    }).rejects.toThrow(/logged \(last 2 of 2\):[\s\S]*info starting[\s\S]*warn disk almost full/u);
  });

  it('says so when the program logged nothing at all', async () => {
    await expect(async () => {
      await expect(createLogCollection()).toHaveLogged({ level: 'error' }, { timeout: 50 });
    }).rejects.toThrow(/the program logged nothing at all/u);
  });

  it('renders a regular expression in the expectation rather than as {}', async () => {
    await expect(async () => {
      await expect(createLogCollection()).toHaveLogged({ message: /ENOENT/u }, { timeout: 50 });
    }).rejects.toThrow(/"message":"\/ENOENT\/u"/u);
  });

  it('explains what to do for a harness the fixtures did not launch', async () => {
    await expect(async () => {
      await expect({ sessionId: 'x' }).toHaveLogged({ level: 'error' });
    }).rejects.toThrow(/call collectLogs\(harness\) first/u);
  });
});

describe('what the trace records', () => {
  /** A writer that keeps the assertions it was handed. */
  function recordingScope(): { asserts: Record<string, unknown>[]; exit: () => void } {
    const asserts: Record<string, unknown>[] = [];
    const writer = {
      recordAssert: (entry: Record<string, unknown>) => asserts.push(entry),
      addStep: () => ({ stepId: 's1', title: '', end: () => {} }),
    } as unknown as TraceWriter;
    const scope: TermwrightScope = {
      testId: 't1',
      testName: 'records refs',
      testFile: '/repo/a.test.ts',
      config: resolveTermwrightConfig({}, {}),
      writers: [writer],
      traces: [],
    };
    return { asserts, exit: enterScope(scope) };
  }

  it('stores the ref of the node the assertion was about', async () => {
    const { asserts, exit } = recordingScope();
    try {
      await expect(fakeLocator(() => ({ visible: true, ref: 'n8@42' }))).toBeVisible();
    } finally {
      exit();
    }
    expect(asserts).toHaveLength(1);
    expect(asserts[0]).toMatchObject({ api: 'toBeVisible', ok: true, ref: 'n8@42' });
    expect(asserts[0]?.['selector']).toBe('getByRole("button")');
  });

  it('records a failed assertion without a ref when nothing resolved', async () => {
    const { asserts, exit } = recordingScope();
    try {
      await expect(async () => {
        await expect(fakeLocator(() => ({ visible: false, resolveError: timeoutError() }))).toBeVisible({
          timeout: 50,
        });
      }).rejects.toThrow();
    } finally {
      exit();
    }
    expect(asserts[0]).toMatchObject({ api: 'toBeVisible', ok: false });
    expect(asserts[0]).not.toHaveProperty('ref');
  });

  it('stores the scope ref for a snapshot taken within a locator', async () => {
    const { asserts, exit } = recordingScope();
    try {
      const harness = fakeHarness(() => ({ tree: permissionDialog() }));
      await expect(harness).toMatchSemanticSnapshot('- button "Approve" [focused]', {
        within: fakeLocator(() => ({ ref: 'n1@3' }), 'getByRole("dialog")'),
      });
    } finally {
      exit();
    }
    expect(asserts[0]).toMatchObject({ api: 'toMatchSemanticSnapshot', ok: true, ref: 'n1@3' });
  });
});
