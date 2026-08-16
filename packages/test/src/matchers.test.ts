import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Locator, ScreenSnapshot, TerminalHarness } from '@termwright/driver';
import type { SemanticSnapshot, SemanticState } from '@termwright/protocol';
import { fakeScreen } from './__fixtures__/screen.js';
import { node, permissionDialog, snapshot } from './__fixtures__/tree.js';
import { configureTermwright, resetTermwrightConfig } from './config.js';
import { registerTermwrightMatchers } from './matchers.js';
import { beginSnapshotScope, resetSnapshotCache } from './snapshot-store.js';
import { createLogCollection, type CapturedLog } from './logs.js';
import { enterScope, scopeKey, type TermwrightScope } from './trace-context.js';
import { resolveTermwrightConfig } from './config.js';
import type { TraceWriter } from '@termwright/trace';

registerTermwrightMatchers();

interface FakeLocatorState {
  visible?: boolean;
  state?: SemanticState | null;
  text?: string;
  ref?: string;
  resolveError?: unknown;
}

/** A locator with just the surface the matchers touch. */
function fakeLocator(read: () => FakeLocatorState, description = 'getByRole("button")'): Locator {
  const locator = {
    description,
    async isVisible() {
      return read().visible ?? false;
    },
    async semanticState() {
      const error = read().resolveError;
      if (error !== undefined) throw error;
      return read().state ?? null;
    },
    async textContent() {
      return read().text ?? '';
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
  configureTermwright({ timeouts: { expect: 250 }, snapshotDir: dir });
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

  it('fails fast on an error that waiting cannot fix', async () => {
    const fatal = Object.assign(new Error('no semantic tree'), {
      code: 'unsupported-action',
      diagnostics: { semanticTree: false },
    });
    const started = Date.now();
    await expect(async () => {
      await expect(fakeLocator(() => ({ resolveError: fatal, visible: false }))).toBeFocused({ timeout: 5_000 });
    }).rejects.toThrow(/no semantic tree/u);
    expect(Date.now() - started).toBeLessThan(1_000);
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
    }).rejects.toThrow(/not a semantic node/u);
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
