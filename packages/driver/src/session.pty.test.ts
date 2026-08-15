/**
 * Integration tests against a real PTY. They are skipped automatically where no
 * pseudo-terminal can be opened (sandboxed CI, missing prebuild) so the rest of
 * the suite still runs; set `TERMWRIGHT_SKIP_PTY=1` to skip them explicitly.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerminalHarness } from './api.js';
import { AmbiguousLocatorError, TermwrightError } from './errors.js';
import { createNodePtyBackend } from './pty.js';
import { launchTerminal } from './session.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures');

function environment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function ptyAvailable(): boolean {
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') return false;
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: environment(),
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return true;
  } catch {
    return false;
  }
}

const sessions: TerminalHarness[] = [];

async function launch(fixture: string, options: Record<string, unknown> = {}): Promise<TerminalHarness> {
  const terminal = await launchTerminal({
    command: [process.execPath, join(FIXTURES, fixture)],
    columns: 60,
    rows: 10,
    ...options,
  });
  sessions.push(terminal);
  return terminal;
}

afterEach(async () => {
  while (sessions.length > 0) {
    const terminal = sessions.pop();
    await terminal?.close();
  }
});

describe.skipIf(!ptyAvailable())('a generic session over a real PTY', { timeout: 20_000 }, () => {
  it('observes output, title and exit status', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    expect(terminal.capabilities().semanticTree).toBe(false);
    expect(terminal.semanticTree()).toBeNull();
    expect(terminal.screen().text()).toContain('READY');
    await terminal.waitForTitle('echo-app');

    await terminal.press('q');
    const status = await terminal.waitForExit();
    expect(status.code).toBe(0);
    expect(await terminal.exit).toEqual(status);
  });

  it('delivers keystrokes as the bytes a terminal would send', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    await terminal.press('Control+A');
    await terminal.waitForText('KEY:01');

    await terminal.type('hi');
    await terminal.waitForText('KEY:68');

    await terminal.press('ArrowUp');
    await terminal.waitForText('KEY:1b 5b 41');
  });

  it('refuses a click when the child never enabled mouse tracking', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    const error = await terminal
      .getByText('READY')
      .click()
      .catch((cause: unknown) => cause as TermwrightError);
    expect(error).toBeInstanceOf(TermwrightError);
    expect((error as TermwrightError).code).toBe('unsupported-action');
    expect((error as TermwrightError).diagnostics.semanticTree).toBe(false);
  });

  it('resizes the pty and the emulator together', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    await terminal.resize({ columns: 40, rows: 8 });
    const screen = terminal.screen();
    expect(screen.columns).toBe(40);
    expect(screen.rows).toBe(8);
  });

  it('reports a typed timeout with a screen excerpt', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    const error = await terminal
      .waitForText('never printed', { timeout: 300 })
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('timeout');
    expect((error as TermwrightError).diagnostics.screenExcerpt).toContain('READY');
  });
});

describe.skipIf(!ptyAvailable())('session events and emulator-side APIs', { timeout: 20_000 }, () => {
  it('emits output, input, resize, revision and exit events', async () => {
    const terminal = await launch('echo-app.mjs');
    const seen: string[] = [];
    for (const event of ['output', 'input', 'resize', 'screen-revision', 'exit'] as const) {
      terminal.events.on(event, () => {
        if (!seen.includes(event)) seen.push(event);
      });
    }

    await terminal.waitForText('READY');
    await terminal.press('a');
    await terminal.resize({ columns: 50, rows: 12 });
    await terminal.press('q');
    await terminal.waitForExit();

    expect(seen.sort()).toEqual(['exit', 'input', 'output', 'resize', 'screen-revision']);
  });

  it('stops delivering events after unsubscribing', async () => {
    const terminal = await launch('echo-app.mjs');
    let count = 0;
    const off = terminal.events.on('screen-revision', () => {
      count += 1;
    });
    await terminal.waitForText('READY');
    off();
    const afterUnsubscribe = count;
    await terminal.press('a');
    await terminal.waitForText('KEY:61');
    expect(count).toBe(afterUnsubscribe);
  });

  it('waits for renders, stability and idleness without sleeping', async () => {
    const terminal = await launch('scroll-app.mjs', { rows: 8 });
    await terminal.waitForText('DONE');
    await terminal.waitForIdle();
    await terminal.waitForStable({ frames: 1 });

    const before = terminal.screen().revision;
    await terminal.press('p');
    await terminal.waitForRender({ after: before });
    expect(terminal.screen().revision).toBeGreaterThan(before);
  });

  it('exposes scrollback with an explicit retained floor', async () => {
    const terminal = await launch('scroll-app.mjs', { rows: 8, scrollbackLines: 20 });
    await terminal.waitForText('DONE');
    await terminal.waitForIdle();

    expect(terminal.scrollback.length).toBeGreaterThan(0);
    expect(terminal.scrollback.retainedFloor).toBeGreaterThan(0);
    const hits = terminal.scrollback.search('line 55');
    expect(hits).toHaveLength(1);

    const error = await Promise.resolve()
      .then(() => terminal.scrollback.text({ from: 0 }))
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('history-truncated');
  });

  it('copies an emulator-side cell selection without sending input', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    terminal.selection.selectCells({ start: { row: 0, column: 0 }, end: { row: 0, column: 4 } });
    expect(terminal.selection.copy()).toBe('READY');
    terminal.selection.clear();
    expect(terminal.selection.copy()).toBe('');
  });

  it('refuses to act on a closed harness', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');
    await terminal.close();
    await terminal.close(); // idempotent

    const error = await terminal.press('a').catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('session-closed');
  });
});

describe.skipIf(!ptyAvailable())('the child environment', { timeout: 20_000 }, () => {
  it('does not hand the test runner’s secrets to the child by default', async () => {
    process.env['TERMWRIGHT_FIXTURE_SECRET'] = 'leaked';
    try {
      const terminal = await launch('env-app.mjs');
      await terminal.waitForText('ENV DONE');
      const text = terminal.screen().text();
      expect(text).toContain('ENV TERMWRIGHT_FIXTURE_SECRET=<unset>');
      // The allowlist keeps what a program needs to run at all.
      expect(text).toContain('ENV PATH=<set>');
    } finally {
      delete process.env['TERMWRIGHT_FIXTURE_SECRET'];
    }
  });

  it('passes the whole environment through when asked explicitly', async () => {
    process.env['TERMWRIGHT_FIXTURE_SECRET'] = 'shared-on-purpose';
    try {
      const terminal = await launch('env-app.mjs', { envMode: 'inherit' });
      await terminal.waitForText('ENV DONE');
      expect(terminal.screen().text()).toContain('ENV TERMWRIGHT_FIXTURE_SECRET=shared-on-purpose');
    } finally {
      delete process.env['TERMWRIGHT_FIXTURE_SECRET'];
    }
  });

  it('always passes explicit env entries, in either mode', async () => {
    const terminal = await launch('env-app.mjs', { env: { TERMWRIGHT_FIXTURE_EXPLICIT: 'yes' } });
    await terminal.waitForText('ENV DONE');
    expect(terminal.screen().text()).toContain('ENV TERMWRIGHT_FIXTURE_EXPLICIT=yes');
  });
});

describe.skipIf(!ptyAvailable())('waitForReady', { timeout: 20_000 }, () => {
  it('uses OSC 133 prompt marks when the program emits them', async () => {
    const terminal = await launch('prompt-app.mjs');
    await terminal.waitForReady();
    expect(terminal.screen().text()).toContain('$');

    const strategy = terminal.diagnostics().findLast((entry) => entry.code === 'ready-strategy');
    expect(strategy?.detail).toContain('shell integration');

    // While a command runs, readiness is false again until D arrives.
    await terminal.press('x');
    await terminal.waitForText('working');
    await terminal.waitForReady();
    expect(terminal.diagnostics().filter((entry) => entry.code === 'ready-strategy')).toHaveLength(2);
  });

  it('falls back to a settled screen, and says so', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForReady();

    const strategy = terminal.diagnostics().findLast((entry) => entry.code === 'ready-strategy');
    expect(strategy?.detail).toContain('heuristic');
  });

  it('times out while a command is still running', async () => {
    const terminal = await launch('scroll-app.mjs', { rows: 8 });
    await terminal.waitForText('line 1');
    const error = await terminal
      .waitForReady({ timeout: 10 })
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('timeout');
  });
});

describe.skipIf(!ptyAvailable())('session diagnostics', { timeout: 20_000 }, () => {
  it('records why a generic session stayed generic, and emits it', async () => {
    const terminal = await launch('echo-app.mjs', { semanticNegotiationMs: 60 });
    const events: string[] = [];
    terminal.events.on('diagnostic', (entry) => events.push(entry.code));

    await terminal.waitForText('READY');
    await expect
      .poll(() => terminal.diagnostics().some((entry) => entry.code === 'negotiation-timeout'))
      .toBe(true);

    const entry = terminal.diagnostics().find((item) => item.code === 'negotiation-timeout');
    expect(entry?.detail).toContain('generic session');
    expect(entry?.timeMs).toBeGreaterThanOrEqual(0);
    expect(events).toContain('negotiation-timeout');
  });

  it('records the handshake and the advisory revision-commit', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.getByTestId('approve').resolve();

    const codes = terminal.diagnostics().map((entry) => entry.code);
    expect(codes).toContain('adapter-attached');
    expect(codes).toContain('revision-commit');

    const commit = terminal.diagnostics().find((entry) => entry.code === 'revision-commit');
    expect(commit?.revision).toBe(1);
    expect(commit?.detail).toContain('render marker');
  });
});

describe.skipIf(!ptyAvailable())('locatorForRef', { timeout: 20_000 }, () => {
  it('round-trips a semantic ref by identity', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    const approve = await terminal.getByTestId('approve').resolve();

    const locator = terminal.locatorForRef(approve.ref);
    expect(locator.description).toContain(approve.ref);
    const again = await locator.resolve();
    expect(again.ref).toBe(approve.ref);
    expect(await locator.textContent()).toBe('Approve');
  });

  it('raises stale-snapshot once the revision it was minted at is gone', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    const reject = await terminal.getByTestId('reject').resolve();

    await terminal.press('Tab');
    await expect
      .poll(() => terminal.semanticTree()?.revision ?? 0)
      .toBeGreaterThan(reject.revision);

    const error = await terminal
      .locatorForRef(reject.ref)
      .resolve()
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('stale-snapshot');
    expect((error as TermwrightError).diagnostics.suggestion).toContain('fresh refs');
  });

  it('round-trips a grid ref and rejects nonsense', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');
    const ready = await terminal.getByText('READY').resolve();
    expect(ready.semantic).toBe(false);

    const again = await terminal.locatorForRef(ready.ref).resolve();
    expect(again.rect).toEqual(ready.rect);

    const error = await Promise.resolve()
      .then(() => terminal.locatorForRef('not-a-ref!'))
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('unsupported-action');
  });
});

describe.skipIf(!ptyAvailable())('mouse input over a real PTY', { timeout: 20_000 }, () => {
  it('sends an SGR mouse report the child can decode', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');
    expect(terminal.screen().modes.mouseEncoding).toBe('sgr');

    await terminal.getByText('MOUSE ON').click();
    await terminal.waitForText('MOUSE press b=0');
    await terminal.waitForText('MOUSE release b=0');
  });

  it('sends wheel reports and right-button clicks', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');

    await terminal.getByText('MOUSE ON').wheel({ deltaY: 1 });
    await terminal.waitForText('MOUSE press b=65');

    await terminal.getByText('MOUSE ON').click({ button: 'right' });
    await terminal.waitForText('MOUSE press b=2');
  });

  it('refuses a drag when the child only asked for click reporting', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');
    expect(terminal.screen().modes.mouseTracking).toBe('vt200');

    const error = await terminal
      .getByText('MOUSE ON')
      .drag({ from: { row: 0, column: 0 }, to: { row: 1, column: 4 } })
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('unsupported-action');
    expect((error as TermwrightError).diagnostics.suggestion).toContain('1002');
  });

  it('refuses focus reports the child never asked for', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');

    const error = await terminal.focus().catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('unsupported-action');
    expect((error as TermwrightError).diagnostics.suggestion).toContain('1004');
  });
});

describe.skipIf(!ptyAvailable())('a semantic session over a real PTY', { timeout: 20_000 }, () => {
  it('negotiates the tree, pairs revisions and resolves semantic locators', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('Permission required');

    const capabilities = terminal.capabilities();
    expect(capabilities.semanticTree).toBe(true);
    expect(capabilities.adapter?.name).toBe('fixture');
    expect(capabilities.capabilities).toContain('render-revisions');

    // Resolving waits for the first paired revision, so the tree is published
    // by the time the locator returns.
    const approve = await terminal.getByRole('button', { name: 'Approve' }).resolve();

    const tree = terminal.semanticTree();
    expect(tree?.revision).toBeGreaterThanOrEqual(1);
    expect(tree?.nodes.map((node) => node.name)).toContain('Approve');

    expect(approve.semantic).toBe(true);
    expect(approve.rect).toEqual({ row: 1, column: 2, width: 9, height: 1 });
    expect(approve.ref).toMatch(/^n2@\d+$/u);
  });

  it('fails strictly on an ambiguous locator with bounded candidates', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('Permission required');

    const error = await terminal
      .getByRole('button')
      .resolve({ timeout: 500 })
      .catch((cause: unknown) => cause as TermwrightError);
    expect(error).toBeInstanceOf(AmbiguousLocatorError);
    expect((error as TermwrightError).diagnostics.candidates).toHaveLength(2);
    expect(await terminal.getByRole('button').count()).toBe(2);
  });

  it('supports the CSS dialect, within() and testIds', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('Permission required');

    const reject = await terminal.locator('dialog button#reject').resolve();
    expect(reject.name).toBe('Reject');

    const scoped = terminal.getByRole('button', { name: 'Approve' }).within(terminal.locator('dialog'));
    expect((await scoped.resolve()).ref).toMatch(/^n2@/u);

    expect(await terminal.getByTestId('approve').textContent()).toBe('Approve');
    expect(await terminal.locator('button:focused').textContent()).toBe('Approve');
  });

  it('clicks a semantic node through the PTY and observes the new revision', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.getByTestId('approve').resolve();
    const before = terminal.semanticTree()?.revision ?? 0;

    await terminal.getByRole('button', { name: 'Reject' }).click();
    await terminal.waitForText('CLICKED reject');

    await expect
      .poll(() => terminal.semanticTree()?.revision ?? 0, { timeout: 5_000 })
      .toBeGreaterThan(before);
    expect(await terminal.getByTestId('reject').semanticState()).toMatchObject({ focused: true });
  });

  it('reports an empty published value as empty text, not as the label', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    const input = terminal.getByTestId('name-input');
    await input.resolve();

    // The textbox publishes value: '' — an empty input has no text, and
    // falling back to its label would make an empty-text assertion impossible.
    expect(await input.textContent()).toBe('');

    await terminal.press('a');
    await terminal.waitForText('name: [a]');
    await expect.poll(() => input.textContent()).toBe('a');

    // A node without a value still falls back to its name.
    expect(await terminal.getByTestId('approve').textContent()).toBe('Approve');
  });

  it('keeps working when the adapter publishes no bounds at all', async () => {
    // Legal state, not a broken adapter: class-B/C frameworks never have
    // trustworthy coordinates, and Ink drops them whenever a <Static> region
    // shifts the live region by an amount it cannot observe.
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_FIXTURE_NO_BOUNDS: '1' },
    });
    await terminal.waitForText('Permission required');

    const approve = terminal.getByRole('button', { name: 'Approve' });
    const target = await approve.resolve();
    expect(target.semantic).toBe(true);
    expect(target.rect).toBeNull();
    expect(await approve.count()).toBe(1);
    expect(await approve.textContent()).toBe('Approve');
    expect(await approve.semanticState()).toMatchObject({ focused: true });
    expect(await approve.boundingBox()).toBeNull();

    const error = await approve.click().catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('unsupported-action');
    expect((error as TermwrightError).diagnostics.suggestion).toContain('press()');

    // Keyboard activation still reaches the focused node.
    const receipt = await approve.activate();
    expect(receipt.strategy).toBe('focus-enter');
    await terminal.waitForText('ACTIVATED approve');
  });

  it('activates the focused node with the keyboard and reports the strategy', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('Permission required');

    const receipt = await terminal.getByTestId('approve').activate();
    expect(receipt.strategy).toBe('focus-enter');
    await terminal.waitForText('ACTIVATED approve');
  });
});
