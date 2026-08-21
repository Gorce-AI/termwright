/**
 * Integration tests against a real PTY. They are skipped automatically where no
 * pseudo-terminal can be opened (sandboxed CI, missing prebuild) so the rest of
 * the suite still runs; set `TERMWRIGHT_SKIP_PTY=1` to skip them explicitly.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionEvent, ActionStartedEvent, TerminalHarness } from './api.js';
import { AmbiguousLocatorError, ProbeAttachFailedError, TermwrightError } from './errors.js';
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

/** Launches a fixture with extra argv, for fixtures that take flags. */
async function launchWith(
  argv: readonly string[],
  options: Record<string, unknown> = {},
): Promise<TerminalHarness> {
  const [fixture, ...rest] = argv;
  const terminal = await launchTerminal({
    command: [process.execPath, join(FIXTURES, fixture ?? ''), ...rest],
    columns: 60,
    rows: 10,
    ...options,
  });
  sessions.push(terminal);
  return terminal;
}

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

async function waitForPairedSemanticRevision(terminal: TerminalHarness, minimum: number): Promise<void> {
  await expect.poll(() => {
    const checkpoint = terminal.checkpoint();
    return checkpoint.semanticRevision !== null
      && checkpoint.semanticRevision >= minimum
      && checkpoint.pairedScreenRevision === checkpoint.screenRevision;
  }, { timeout: 5_000 }).toBe(true);
}

afterEach(async () => {
  while (sessions.length > 0) {
    const terminal = sessions.pop();
    await terminal?.close();
  }
});

describe.skipIf(!ptyAvailable())('a generic session over a real PTY', { timeout: 20_000 }, () => {
  // ConPTY consumes these terminal queries before xterm-headless can observe
  // and answer them. The child therefore cannot prove Termwright's emulator
  // response path on Windows; the direct VtScreen test remains platform-free.
  it.skipIf(process.platform === 'win32')('returns emulator query responses through PTY without classifying them as user input', async () => {
    const terminal = await launch('terminal-query-app.mjs', { columns: 80, rows: 24 });
    const inputs: unknown[] = [];
    const unsubscribe = terminal.events.on('input', (event) => inputs.push(event));
    try {
      await terminal.waitForText('dsr=3;7 background=rgb:0000/0000/0000');
      expect(inputs).toEqual([]);
      expect(terminal.diagnostics().filter((entry) => entry.code === 'terminal-response')).toHaveLength(2);
    } finally {
      unsubscribe();
    }
  });

  it('fails launch immediately when a required capability is unavailable', async () => {
    const failure = await launchTerminal({
      command: [process.execPath, join(FIXTURES, 'echo-app.mjs')],
      columns: 60,
      rows: 10,
      semanticNegotiationMs: 20,
      requiredCapabilities: ['semantic-tree'],
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProbeAttachFailedError);
    expect(failure).toMatchObject({ code: 'probe-attach-failed' });
    expect(String(failure)).toContain('required=[semantic-tree]');
    expect(String(failure)).toContain('no probe attached');
  });

  it('observes output, title and exit status', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    expect(terminal.capabilities().semanticTree).toBe(false);
    expect(terminal.semanticTree()).toBeNull();
    expect(terminal.screen().text()).toContain('READY');
    await terminal.waitForTitle('echo-app');

    const terminalState = terminal.terminalState.snapshot();
    expect(terminalState.screenRevision).toBe(terminal.screen().revision);
    expect(terminalState.dimensions).toEqual({ columns: 60, rows: 10 });
    expect(terminalState.buffer).toBe('normal');
    expect(terminalState.title).toBe('echo-app');
    expect(terminalState.cursor).toEqual(expect.objectContaining({ row: expect.any(Number), column: expect.any(Number) }));
    expect(terminalState.bellCount).toBe(0);
    expect(terminalState.modes).toEqual(expect.objectContaining({ bracketedPaste: false }));

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
    // Pins the known-off branch: echo-app enables nothing, and the flag keeps
    // the mode observable so the verdict is 'none' rather than the 'unknown' a
    // ConPTY host would report. The hidden-mode branch is a separate test.
    const terminal = await launch('echo-app.mjs', { modesObservable: true });
    await terminal.waitForText('READY');

    const error = await terminal
      .getByScreenText('READY')
      .click()
      .catch((cause: unknown) => cause as TermwrightError);
    expect(error).toBeInstanceOf(TermwrightError);
    expect((error as TermwrightError).code).toBe('input-mode-disabled');
    expect((error as TermwrightError).diagnostics.semanticTree).toBe(false);
  });

  it('names a launch path that does not exist instead of dying blank', async () => {
    // node-pty starts a pty either way and the child dies immediately, so
    // without this the caller gets exit code 1 and an empty screen — the same
    // thing a program that genuinely failed produces.
    const missingCwd = await launchTerminal({
      command: [process.execPath, '-e', '0'],
      cwd: join(FIXTURES, 'no-such-directory'),
    }).catch((cause: unknown) => cause as TermwrightError);
    expect(missingCwd).toBeInstanceOf(TermwrightError);
    expect((missingCwd as TermwrightError).code).toBe('not-found');
    expect((missingCwd as TermwrightError).message).toContain('no-such-directory');

    const missingCommand = await launchTerminal({
      command: [join(FIXTURES, 'no-such-fixture.mjs')],
    }).catch((cause: unknown) => cause as TermwrightError);
    expect((missingCommand as TermwrightError).code).toBe('not-found');
  });

  it('leaves a bare command name to the platform to resolve', async () => {
    // Only a command that is a path is checked: reimplementing PATH (and
    // PATHEXT) lookup would eventually refuse a program that exists, which is
    // worse than the blank screen the check above replaces.
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');
    expect(terminal.screen().text()).toContain('READY');
  });

  it('resizes the pty and the emulator together', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    const receipt = await terminal.resize({ columns: 40, rows: 8 });
    const screen = terminal.screen();
    expect(screen.columns).toBe(40);
    expect(screen.rows).toBe(8);
    expect(receipt.requested).toEqual({ columns: 40, rows: 8 });
    expect(receipt.after.screenRevision).toBeGreaterThan(receipt.before.screenRevision);
    expect(receipt.pairedRender).toMatchObject({ status: 'known', value: receipt.after.screenRevision });
  });

  it('captures locator-scoped cells with an atomic origin and revision', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');
    const ready = terminal.getByScreenText('READY', { exact: true });
    const region = await ready.cellSnapshot({ padding: 1 });
    expect(region.text()).toContain('READY');
    expect(region.stamp.screenRevision).toBe(terminal.screen().revision);
    expect(region.origin.row).toBeGreaterThanOrEqual(0);
    expect(region.origin.column).toBeGreaterThanOrEqual(0);
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

describe.skipIf(!ptyAvailable())('crash reports', { timeout: 20_000 }, () => {
  it('captures the stack trace of a program that threw', async () => {
    const terminal = await launch('crash-app.mjs');
    await terminal.waitForText('CRASH APP READY');

    const crashes: unknown[] = [];
    terminal.events.on('crash', (report) => crashes.push(report));

    await terminal.press('a'); // remembered as the input before the death
    await terminal.press('x');
    const status = await terminal.waitForExit();
    expect(status.code).toBe(1);

    const report = terminal.crashReport();
    expect(report).not.toBeNull();
    // The dying output is parsed before the exit is published, so the trace is
    // in the report rather than still in flight.
    expect(report?.screenTail.join('\n')).toContain('boom from the fixture');
    // The trace wraps at 60 columns, so the frame is reassembled before matching.
    expect(report?.screenTail.join('')).toMatch(/at .*crash-app\.mjs/u);
    expect(report?.exit).toEqual(status);
    expect(report?.lastSemanticTree).toBeNull();
    expect(report?.timeMs).toBeGreaterThan(0);

    const inputs = report?.recentInputs ?? [];
    expect(inputs.map((input) => input.preview)).toEqual(['a', 'x']);
    expect(inputs.every((input) => input.kind === 'key')).toBe(true);

    // The event carries the same report a caller can read afterwards.
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toBe(report);
  });

  it('captures a death the operating system reports its own way', async () => {
    const terminal = await launch('crash-app.mjs');
    await terminal.waitForText('CRASH APP READY');

    await terminal.press('k');
    const status = await terminal.waitForExit();
    // POSIX reports the signal; Windows has none and reports a code. Both are
    // deaths nobody asked for, which is what the report is about.
    if (process.platform === 'win32') expect(status.code).not.toBe(0);
    else expect(status.signal).toBe('SIGKILL');

    const report = terminal.crashReport();
    expect(report).not.toBeNull();
    expect(report?.exit).toEqual(status);
    expect(report?.screenTail.join('\n')).toContain('CRASH APP READY');
  });

  it('reports the crash from any wait that can no longer make progress', async () => {
    const terminal = await launch('crash-app.mjs');
    await terminal.waitForText('CRASH APP READY');
    await terminal.press('x');
    await terminal.waitForExit();

    const error = await terminal
      .waitForText('never', { timeout: 500 })
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('process-exited');
    expect((error as TermwrightError).diagnostics.screenExcerpt).toContain('boom from the fixture');
    expect((error as TermwrightError).diagnostics.suggestion).toContain('crashReport()');
  });

  it('keeps the last semantic tree of an instrumented program that died', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.getByTestId('approve').resolve();

    await terminal.press('X');
    await terminal.waitForExit();

    const report = terminal.crashReport();
    expect(report?.lastSemanticTree?.revision).toBe(1);
    expect(report?.lastSemanticTree?.nodes.map((node) => node.name)).toContain('Approve');
    expect(report?.diagnosticsTail.some((entry) => entry.code === 'adapter-attached')).toBe(true);
  });

  it('never reports a crash for a clean exit or a teardown the caller asked for', async () => {
    const clean = await launch('crash-app.mjs');
    await clean.waitForText('CRASH APP READY');
    await clean.press('e');
    expect((await clean.waitForExit()).code).toBe(0);
    expect(clean.crashReport()).toBeNull();

    const signalled = await launch('crash-app.mjs');
    await signalled.waitForText('CRASH APP READY');
    await signalled.signal('KILL');
    await signalled.waitForExit();
    expect(signalled.crashReport()).toBeNull();

    const closed = await launch('crash-app.mjs');
    await closed.waitForText('CRASH APP READY');
    await closed.close();
    expect(closed.crashReport()).toBeNull();
  });

  it('remembers a paste by size only', async () => {
    const terminal = await launch('crash-app.mjs');
    await terminal.waitForText('CRASH APP READY');

    // The payload avoids the fixture's command keys: it reads every code point
    // of a chunk, exactly as a raw-mode program does.
    const secret = 'S3CR3T-P4SSW0RD-42';
    await terminal.paste(secret);
    await terminal.press('x');
    await terminal.waitForExit();

    const report = terminal.crashReport();
    const paste = report?.recentInputs.find((input) => input.kind === 'paste');
    expect(paste?.bytes).toBe(secret.length);
    expect(paste?.preview).toBeUndefined();
    // The guarantee is about the input record. The screen tail is deliberately
    // not scrubbed: it reports what the terminal showed, echo included, and a
    // crash report that edited the screen would be lying about the crash.
    expect(JSON.stringify(report?.recentInputs)).not.toContain(secret);
  });
});

describe.skipIf(!ptyAvailable())('action events', { timeout: 20_000 }, () => {
  it('reports every action in order, with the target it resolved', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: {
        TERMWRIGHT_FIXTURE_MOUSE_MODE: '0',
        TERMWRIGHT_FIXTURE_STARTUP_REPUBLISH: '1',
      },
    });
    await terminal.getByTestId('approve').resolve();
    await waitForPairedSemanticRevision(terminal, 2);

    const actions: ActionEvent[] = [];
    const starts: ActionStartedEvent[] = [];
    terminal.events.on('action-start', (event) => starts.push(event));
    terminal.events.on('action', (event) => actions.push(event));

    await terminal.getByRole('button', { name: 'Approve' }).activate();
    await terminal.press('Tab');
    await terminal.resize({ columns: 50, rows: 12 });

    expect(actions.map((event) => event.api)).toEqual(['activate', 'press', 'resize']);
    expect(starts.map((event) => event.api)).toEqual(['activate', 'press', 'resize']);
    expect(starts.map((event) => event.actionId)).toEqual(actions.map((event) => event.actionId));
    expect(actions.every((event) => event.ok)).toBe(true);

    // A locator action names what it aimed at; a harness action has no target.
    const activation = actions[0];
    expect(activation?.selector).toContain('getByRole');
    expect(starts[0]?.selector).toContain('getByRole');
    expect(activation?.ref).toMatch(/^n\d+@\d+$/u);
    expect(activation?.receipt).toMatchObject({
      outcome: 'completed',
      intent: { kind: 'activate' },
      plan: { strategy: 'focus-enter' },
    });
    expect(activation?.receipt?.executed).toEqual(activation?.receipt?.plan.operations);
    expect(actions[1]?.selector).toBeUndefined();
    expect(actions[1]?.ref).toBeUndefined();
    expect(actions[1]?.receipt).toMatchObject({
      outcome: 'completed',
      plan: { strategy: 'raw-physical-input' },
      executed: [{ device: 'keyboard', kind: 'press', value: 'Tab' }],
    });
    expect(actions.every((event) => event.timeMs > 0)).toBe(true);
  });

  it('reports a failed action with its code, not its prose', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    const actions: ActionEvent[] = [];
    terminal.events.on('action', (event) => actions.push(event));

    // The failure is generated by a target that never appears, not by a
    // refused click: whether a click is refused depends on what the platform
    // lets the driver see about mouse modes, and this test is about the shape
    // of the event, not about the mouse.
    await terminal.getByScreenText('NEVER-ON-THIS-SCREEN').click({ timeout: 300 }).catch(() => {});

    const [event] = actions;
    expect(actions).toHaveLength(1);
    expect(event?.api).toBe('click');
    expect(event?.ok).toBe(false);
    // A code a consumer can switch on, not the message that explains it.
    expect(event?.error).toBe('timeout');
    expect(actions[0]?.selector).toContain('getByScreenText');
  });

  it('reports the action after it finished, not when it started', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.getByTestId('approve').resolve();

    const order: string[] = [];
    terminal.events.on('action-start', (event) => order.push(`start:${event.api}`));
    terminal.events.on('action', (event) => order.push(`action:${event.api}`));
    terminal.events.on('input', () => order.push('input'));

    await terminal.press('Tab');
    // The bytes reach the program first; the event describes what happened.
    expect(order).toEqual(['start:press', 'input', 'action:press']);
  });

  it('settles an announced action when the session closes concurrently', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');

    const starts: ActionStartedEvent[] = [];
    const actions: ActionEvent[] = [];
    terminal.events.on('action-start', (event) => starts.push(event));
    terminal.events.on('action', (event) => actions.push(event));

    const pending = terminal.getByScreenText('NEVER-ON-THIS-SCREEN').click({ timeout: 5_000 }).catch(() => undefined);
    expect(starts).toHaveLength(1);
    await terminal.close();
    await pending;

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actionId: starts[0]?.actionId,
      api: 'click',
      ok: false,
      error: 'session-closed',
    });
  });
});

describe.skipIf(!ptyAvailable())('terminal profiles', { timeout: 20_000 }, () => {
  /** Launches a program that prints one box-drawing character. */
  async function printBoxChar(profile?: string): Promise<TerminalHarness> {
    const terminal = await launchTerminal({
      command: [process.execPath, '-e', 'process.stdout.write("\u2502x")'],
      columns: 20,
      rows: 4,
      ...(profile !== undefined ? { terminalProfile: profile } : {}),
    });
    sessions.push(terminal);
    await terminal.waitForText('x');
    return terminal;
  }

  it('reports the profile it is counting characters with', async () => {
    const terminal = await printBoxChar();
    expect(terminal.capabilities().terminalProfile).toBe('default');

    const chosen = await printBoxChar('iterm2-ambiguous-wide');
    expect(chosen.capabilities().terminalProfile).toBe('iterm2-ambiguous-wide');
  });

  it('measures an ambiguous character the way the profile says', async () => {
    // The same byte, two profiles, two layouts: this is the whole point of
    // recording the profile alongside a session.
    const narrow = await printBoxChar('default');
    expect(narrow.screen().cell(0, 0).width).toBe(1);
    expect(narrow.screen().cell(0, 1).char).toBe('x');

    const wide = await printBoxChar('iterm2-ambiguous-wide');
    expect(wide.screen().cell(0, 0).width).toBe(2);
    expect(wide.screen().cell(0, 2).char).toBe('x');
  });

  it('refuses an unknown profile instead of quietly picking one', async () => {
    const error = await launchTerminal({
      command: [process.execPath, '-e', '0'],
      terminalProfile: 'konsole',
    }).catch((cause: unknown) => cause as Error);
    expect((error as Error).message).toContain('unknown terminal profile');
  });
});

describe.skipIf(!ptyAvailable())('settled()', { timeout: 20_000 }, () => {
  it('resolves with the final verdict for a generic program', async () => {
    const terminal = await launch('echo-app.mjs', { semanticNegotiationMs: 30 });
    const capabilities = await terminal.settled({ timeout: 10_000 });

    expect(capabilities.capabilities['semantic-tree'].status).toBe('unsupported');
    // Final means final: a semantic locator now fails immediately.
    const error = await terminal
      .getByTestId('nothing')
      .resolve({ timeout: 100 })
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('semantic-capability-unavailable');
  });

  it('freezes a generic contract and rejects an adapter that attaches late', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 50,
      env: { TERMWRIGHT_FIXTURE_HELLO_DELAY: '400' },
    });

    const capabilities = await terminal.settled({ timeout: 10_000 });
    expect(capabilities.capabilities['semantic-tree'].status).toBe('unsupported');
    expect(terminal.contract()).toBe(capabilities);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(terminal.semanticTree()).toBeNull();
    expect(terminal.contract()).toBe(capabilities);
  });

  it('keeps the bounded default window open for a slow certified adapter startup', async () => {
    const terminal = await launch('semantic-app.mjs', {
      env: { TERMWRIGHT_FIXTURE_HELLO_DELAY: '1500' },
    });

    const capabilities = await terminal.settled({ timeout: 10_000 });
    expect(capabilities.capabilities['semantic-tree'].status).toBe('supported');
    expect(terminal.semanticTree()?.v).toBe(2);
    expect(terminal.diagnostics().some((entry) => entry.code === 'negotiation-timeout')).toBe(false);
  });

  it('uses the startup readiness budget when semantic capabilities are required', async () => {
    const terminal = await launch('semantic-app.mjs', {
      env: { TERMWRIGHT_FIXTURE_HELLO_DELAY: '2100' },
      requiredCapabilities: ['semantic-tree'],
      timeouts: { ready: 3_000 },
    });

    expect(terminal.contract()?.capabilities['semantic-tree'].status).toBe('supported');
    expect(terminal.diagnostics().some((entry) => entry.code === 'negotiation-timeout')).toBe(false);
  });

  it('keeps the default fail-closed after the bounded negotiation window', async () => {
    const terminal = await launch('semantic-app.mjs', {
      env: { TERMWRIGHT_FIXTURE_HELLO_DELAY: '2100' },
    });

    const capabilities = await terminal.settled({ timeout: 10_000 });
    expect(capabilities.capabilities['semantic-tree'].status).toBe('unsupported');
    expect(terminal.semanticTree()).toBeNull();
    expect(terminal.diagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'negotiation-timeout' }),
    ]));
  });
});

describe.skipIf(!ptyAvailable())('the debug log', { timeout: 20_000 }, () => {
  it('narrates the session to stderr without leaking the session token', async () => {
    const lines: string[] = [];
    const restore = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const terminal = await launch('semantic-app.mjs', {
        semanticNegotiationMs: 5_000,
        debug: true,
        env: {
          TERMWRIGHT_FIXTURE_MOUSE_MODE: '0',
          TERMWRIGHT_FIXTURE_STARTUP_REPUBLISH: '1',
        },
      });
      await terminal.waitForText('Permission required');
      await waitForPairedSemanticRevision(terminal, 2);
      await terminal.getByRole('button', { name: 'Approve' }).activate();
      await terminal.paste('correct horse battery staple');
    } finally {
      process.stderr.write = restore;
    }

    const output = lines.join('');
    expect(output).toContain('tw:wait');
    expect(output).toContain('waitForText("Permission required") succeeded in');
    expect(output).toContain('getByRole("button"');
    expect(output).toContain('locator.activate() succeeded in');
    expect(output).toContain('semantic revision 1 published');
    expect(output).toContain('adapter-attached');

    // Secrets stay out: the pasted payload by size only, and no 256-bit token.
    expect(output).not.toContain('correct horse');
    expect(output).toContain('paste(<28 chars>)');
    expect(output).not.toMatch(/[A-Za-z0-9_-]{43}/u);
  });

  it('stays silent when it is off', async () => {
    const lines: string[] = [];
    const restore = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const terminal = await launch('echo-app.mjs');
      await terminal.waitForText('READY');
      await terminal.press('a');
    } finally {
      process.stderr.write = restore;
    }

    expect(lines.join('')).not.toContain('tw:');
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

  it('tells the child which terminal it is attached to', async () => {
    // Asserted on what the child received, not on what the driver believes it
    // sent: on Windows the runner has no TERM of its own, and node-pty only
    // forces one on POSIX, so this is the platform split that has to hold.
    const terminal = await launch('env-app.mjs');
    await terminal.waitForText('ENV DONE');
    const text = terminal.screen().text();
    expect(text).toContain('ENV TERM=xterm-256color');
    expect(text).toContain('ENV COLORTERM=truecolor');
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

    expect(terminal.diagnostics().at(-1)?.code).toBe('ready-shell-integration');

    // While a command runs, readiness is false again until D arrives.
    await terminal.press('x');
    await terminal.waitForText('working');
    await terminal.waitForReady();
    expect(
      terminal.diagnostics().filter((entry) => entry.code === 'ready-shell-integration'),
    ).toHaveLength(2);
  });

  it('falls back to a settled screen, and says so', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForReady();

    // The fallback is a guess and says so by code, not by prose.
    const strategy = terminal.diagnostics().at(-1);
    expect(strategy?.code).toBe('ready-settled-screen');
    expect(
      terminal.diagnostics().some((entry) => entry.code === 'ready-shell-integration'),
    ).toBe(false);
  });

  it('does not call an exited program ready, even with a prompt on screen', async () => {
    // Readiness is a claim about the future: the prompt is still visible, but
    // nothing can accept the input this call promises.
    const terminal = await launchWith(['prompt-app.mjs', '--exit-after-prompt']);
    await terminal.waitForExit();
    expect(terminal.screen().text()).toContain('$');

    const error = await terminal.waitForReady().catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('process-exited');
    // A past observation, by contrast, stays true after the exit.
    await terminal.waitForText('booting');
  });

  it('times out while a command is still running', async () => {
    const terminal = await launch('prompt-app.mjs');
    await terminal.waitForReady();

    // The fixture marks the command as started (C) and only finishes it 120 ms
    // later, so this deadline lands squarely inside the running command.
    await terminal.press('x');
    await terminal.waitForText('working');
    const error = await terminal
      .waitForReady({ timeout: 20 })
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('timeout');
    expect((error as TermwrightError).message).toContain('never reported an input prompt');
  });
});

describe.skipIf(!ptyAvailable())('shell command integration', { timeout: 20_000 }, () => {
  it('returns exact command boundaries, exit status, cwd and terminal state', async () => {
    const reportedCwd = process.platform === 'win32' ? '\\workspace\\project' : '/workspace/project';
    const terminal = await launch('shell-app.mjs');
    await terminal.shell.waitForPrompt();

    const result = await terminal.shell.run('fail');
    expect(result).toMatchObject({
      command: 'fail',
      exitCode: 7,
      cwd: reportedCwd,
      title: 'Termwright shell fixture',
    });
    expect(result.output).toContain('ran fail');
    expect(result.receipt).toMatchObject({
      intent: { kind: 'shell-command' },
      outcome: 'completed',
      plan: { strategy: 'shell-keyboard-submit' },
    });
    expect(result.receipt.before).toEqual(result.receipt.plan.checkpoint);
    expect(result.receipt.executed).toEqual(result.receipt.plan.operations);
    expect(result.receipt.after.contractId).toBe(result.receipt.before.contractId);
    expect(terminal.shell.status()).toMatchObject({
      supported: true,
      ready: true,
      lastMark: 'B',
      lastExitCode: 7,
      cwd: reportedCwd,
      title: 'Termwright shell fixture',
    });

    await terminal.shell.run('bell');
    expect(terminal.shell.status().bellCount).toBe(1);
  });

  it('does not infer shell support from a quiet generic program', async () => {
    const terminal = await launch('echo-app.mjs');
    await expect(terminal.shell.waitForPrompt({ timeout: 30 })).rejects.toMatchObject({
      code: 'capability-unavailable',
      message: expect.stringContaining('OSC 133'),
    });
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
    expect(entry?.detail).toContain('contract is generic');
    expect(entry?.timeMs).toBeGreaterThanOrEqual(0);
    expect(events).toContain('negotiation-timeout');
  });

  it('records which wire error closed the channel', async () => {
    const terminal = await launch('hostile-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('HOSTILE READY');

    await expect
      .poll(() => terminal.diagnostics().some((entry) => entry.code === 'protocol-violation'), {
        timeout: 5_000,
      })
      .toBe(true);

    const violation = terminal.diagnostics().find((entry) => entry.code === 'protocol-violation');
    // A ceiling breach, not a syntax error — readable without parsing prose.
    expect(violation?.wireCode).toBe('limit-exceeded');
    expect(violation?.detail).toContain('framing');
  });

  it('records the handshake and the advisory revision-commit', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.getByTestId('approve').resolve();

    await expect
      .poll(() => terminal.diagnostics().map((entry) => entry.code))
      .toEqual(expect.arrayContaining(['adapter-attached', 'revision-commit']));

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

  it('re-resolves a stable semantic identity after the revision moves on', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    const reject = await terminal.getByTestId('reject').resolve();

    await terminal.press('Tab');
    await expect
      .poll(() => terminal.semanticTree()?.revision ?? 0)
      .toBeGreaterThan(reject.revision);

    const again = await terminal.locatorForRef(reject.ref).resolve();
    expect(again.identity).toBe('stable');
    expect(again.name).toBe('Reject');
    expect(again.revision).toBeGreaterThan(reject.revision);
    expect(again.ref).toBe(`${reject.ref.split('@')[0]}@${again.revision}`);
  });

  it('round-trips a grid ref and rejects nonsense', async () => {
    const terminal = await launch('echo-app.mjs');
    await terminal.waitForText('READY');
    const ready = await terminal.getByScreenText('READY').resolve();
    expect(ready.semantic).toBe(false);

    const again = await terminal.locatorForRef(ready.ref).resolve();
    expect(again.rect).toEqual(ready.rect);

    expect(() => terminal.locatorForRef('not-a-ref!')).toThrow(TypeError);
  });
});

describe.skipIf(!ptyAvailable())('mouse input over a real PTY', { timeout: 20_000 }, () => {
  // ConPTY hides the application's DECSET mouse negotiation. The frozen
  // contract correctly reports pointer-input unsupported, so positive PTY
  // delivery tests cannot run authoritatively there. The negative hidden-mode
  // tests below remain enabled on Windows and assert that no bytes are guessed.
  it.skipIf(process.platform === 'win32')('sends an SGR mouse report the child can decode', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');
    // ConPTY consumes the child's DECSET, so on Windows the encoding is
    // unobservable rather than absent. Either way the child must receive SGR —
    // which the waits below, not this assertion, are what actually prove.
    expect(['sgr', 'unknown']).toContain(terminal.screen().modes.mouseEncoding);

    await terminal.getByScreenText('MOUSE ON').click();
    await terminal.waitForText('MOUSE press b=0');
    await terminal.waitForText('MOUSE release b=0');
  });

  it.skipIf(process.platform === 'win32')('sends wheel reports and right-button clicks', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');

    await terminal.getByScreenText('MOUSE ON').wheel({ deltaY: 1 });
    await terminal.waitForText('MOUSE press b=65');

    await terminal.getByScreenText('MOUSE ON').click({ button: 'right' });
    await terminal.waitForText('MOUSE press b=2');
  });

  it.skipIf(process.platform === 'win32')('delivers semantic modifier-click through PTY and preserves it in the receipt', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    const receipt = await terminal.getByTestId('approve').click({
      modifiers: ['control', 'shift', 'alt'],
    });
    await terminal.waitForText('CLICKED approve modifiers=28');
    expect(receipt.executed).toEqual(receipt.plan.operations);
    expect(receipt.executed).toEqual([
      expect.objectContaining({ device: 'mouse', kind: 'down', modifiers: ['shift', 'alt', 'control'] }),
      expect.objectContaining({ device: 'mouse', kind: 'up', modifiers: ['shift', 'alt', 'control'] }),
    ]);
  });

  it.skipIf(process.platform === 'win32')('delivers semantic hover as real any-motion terminal input', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_FIXTURE_HOVER: '1' },
    });
    const receipt = await terminal.getByTestId('approve').hover();
    await terminal.waitForText('HOVER approve modifiers=0');
    expect(receipt.executed).toEqual([
      expect.objectContaining({ device: 'mouse', kind: 'move', modifiers: [] }),
    ]);
  });

  it.skipIf(process.platform === 'win32')('plans horizontal wheel input truthfully and returns the executed operations', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');

    const receipt = await terminal.getByScreenText('MOUSE ON').wheel({ deltaX: 2 });
    expect(receipt.outcome).toBe('completed');
    expect(receipt.before).toEqual(receipt.plan.checkpoint);
    expect(receipt.executed).toEqual(receipt.plan.operations);
    expect(receipt.plan.operations).toEqual([
      expect.objectContaining({ device: 'mouse', kind: 'wheel', deltaX: 1 }),
      expect.objectContaining({ device: 'mouse', kind: 'wheel', deltaX: 1 }),
    ]);
    await terminal.waitForText('MOUSE press b=67');
  });

  it('rejects zero, fractional, and huge locator wheel deltas before writing PTY bytes', async () => {
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');
    const input: Uint8Array[] = [];
    terminal.events.on('input', ({ kind, data }) => {
      if (kind === 'mouse') input.push(data);
    });
    const locator = terminal.getByScreenText('MOUSE ON');

    await expect(locator.wheel({ deltaY: 0, deltaX: 0 })).rejects.toThrow(TypeError);
    await expect(locator.wheel({ deltaY: 0.5 })).rejects.toThrow(TypeError);
    await expect(locator.wheel({ deltaY: 101 })).rejects.toThrow(RangeError);
    expect(input).toHaveLength(0);
  });

  it('rejects horizontal locator wheel input under an unobservable mouse contract without bytes', async () => {
    const terminal = await launch('mouse-app.mjs', { modesObservable: false });
    await terminal.waitForText('MOUSE ON');
    const input: Uint8Array[] = [];
    terminal.events.on('input', ({ kind, data }) => {
      if (kind === 'mouse') input.push(data);
    });

    await expect(terminal.getByScreenText('MOUSE ON').wheel({ deltaX: 1 })).rejects.toMatchObject({
      code: 'capability-unavailable',
    });
    expect(input).toHaveLength(0);
  });

  it.skipIf(process.platform === 'win32')('executes a locator drag as one checkpointed stepped device plan', async () => {
    const terminal = await launch('mouse-app.mjs', {
      env: { TERMWRIGHT_MOUSE_DRAG: '1' },
    });
    await terminal.waitForText('DRAG DESTINATION');

    const receipt = await terminal.getByScreenText('MOUSE ON').dragTo(
      terminal.getByScreenText('DRAG DESTINATION'),
      { path: [{ row: 3, column: 4 }, { row: 4, column: 8 }] },
    );

    expect(receipt.outcome).toBe('completed');
    expect(receipt.before).toEqual(receipt.plan.checkpoint);
    expect(receipt.executed).toEqual(receipt.plan.operations);
    expect(receipt.plan.operations.map(({ kind }) => kind)).toEqual(['down', 'move', 'move', 'move', 'up']);
    expect(receipt.plan.operations.slice(1, -1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ device: 'mouse', kind: 'move', button: 'left' })]),
    );
    expect(receipt.plan.requirements.every(({ checkpoint }) => checkpoint.sequence === receipt.before.sequence)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('writes no drag bytes when destination resolution makes the source stale', async () => {
    const terminal = await launch('mouse-app.mjs', {
      env: { TERMWRIGHT_MOUSE_DRAG: '1', TERMWRIGHT_MOUSE_LATE_TARGET: '1' },
    });
    await terminal.waitForText('MOUSE ON');
    await terminal.settled();
    const input: Uint8Array[] = [];
    terminal.events.on('input', ({ kind, data }) => {
      if (kind === 'mouse') input.push(data);
    });

    const drag = terminal.getByScreenText('MOUSE ON').dragTo(terminal.getByScreenText('LATE TARGET'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await terminal.write('l');
    await expect(drag).rejects.toMatchObject({ code: 'stale-snapshot' });
    expect(input).toHaveLength(0);
  });

  it('refuses a drag when the tracking level is insufficient or unobservable', async () => {
    // Branching on the observed mode rather than on the platform: the contract
    // is "refuse what is known off, send what cannot be seen", and a test that
    // says `process.platform` instead stops describing the contract.
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');
    const tracking = terminal.screen().modes.mouseTracking;
    const input: Uint8Array[] = [];
    const actions: ActionEvent[] = [];
    terminal.events.on('input', ({ kind, data }) => {
      if (kind === 'mouse') input.push(data);
    });
    terminal.events.on('action', (event) => actions.push(event));

    const outcome = await terminal.mouse
      .drag({ from: { row: 0, column: 0 }, to: { row: 1, column: 4 } })
      .then(() => null)
      .catch((cause: unknown) => cause as TermwrightError);

    expect(outcome?.code).toBe('input-mode-disabled');
    expect(outcome?.diagnostics.suggestion).toContain(tracking === 'unknown' ? 'does not guess' : '1002');

    const locatorOutcome = await terminal.getByScreenText('MOUSE ON')
      .dragTo(terminal.getByScreenText('DRAG DESTINATION'))
      .then(() => null)
      .catch((cause: unknown) => cause as TermwrightError);
    const pointerInput = terminal.contract()?.capabilities['pointer-input'].status;
    expect(locatorOutcome?.code).toBe(pointerInput === 'supported' ? 'input-mode-disabled' : 'capability-unavailable');
    expect(input).toHaveLength(0);
    const failedLocatorAction = actions.find((event) => event.api === 'dragTo');
    expect(failedLocatorAction?.actionability).toMatchObject({
      actionable: false,
      intent: { kind: 'drag' },
      requirements: pointerInput === 'supported'
        ? [
            { condition: { kind: 'pointer-input' }, verdict: 'satisfied' },
            { condition: { kind: 'mouse-input-enabled' }, verdict: 'unsatisfied' },
          ]
        : [
            { condition: { kind: 'pointer-input' }, verdict: 'inconclusive' },
            { condition: { kind: 'mouse-input-enabled' }, verdict: 'unsatisfied' },
          ],
      reason: { code: pointerInput === 'supported' ? 'input-mode-disabled' : 'capability-unavailable' },
    });
    expect(failedLocatorAction?.actionability?.checkpoint).toEqual(
      (locatorOutcome as TermwrightError).actionability?.checkpoint,
    );
  });

  it('reports unavailable pointer capability when the backend hides mouse modes', async () => {
    // The whole Windows path, exercised where mouse modes do arrive: the
    // session is told they are unobservable, so it must behave exactly as it
    // does under ConPTY — freeze pointer input as unavailable instead of
    // guessing SGR and pretending the current runtime mode is known.
    const terminal = await launch('mouse-app.mjs', { modesObservable: false });
    await terminal.waitForText('MOUSE ON');
    expect(terminal.screen().modes.mouseTracking).toBe('unknown');
    expect(terminal.diagnostics().map((entry) => entry.code)).not.toContain(
      'mode-unverifiable',
    );

    const error = await terminal.getByScreenText('MOUSE ON').click().catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('capability-unavailable');
    expect((error as TermwrightError).message).toContain('outside the effective session contract');
  });

  it('refuses focus reports the child never asked for, unless the terminal enabled them', async () => {
    // ConPTY turns focus reporting on by itself, and that is observable — so
    // the expectation follows the mode the session reports, not the OS.
    const terminal = await launch('mouse-app.mjs');
    await terminal.waitForText('MOUSE ON');

    const outcome = await terminal
      .window.focus()
      .then(() => null)
      .catch((cause: unknown) => cause as TermwrightError);

    const reporting = terminal.screen().modes.focusReporting;
    if (reporting === 'off') {
      expect(outcome?.code).toBe('input-mode-disabled');
      expect(outcome?.diagnostics.suggestion).toContain('1004');
      return;
    }
    if (reporting === 'unknown') {
      expect(outcome?.code).toBe('input-mode-disabled');
      return;
    }
    expect(outcome).toBeNull();
  });

  it('refuses focus and pointer reports under hidden modes', async () => {
    // The Windows path on any platform: mouse-app never asks for 1004, so a
    // driver reading the host's answer must neither refuse nor stay quiet.
    const terminal = await launch('mouse-app.mjs', { modesObservable: false });
    await terminal.waitForText('MOUSE ON');
    expect(terminal.screen().modes.focusReporting).toBe('unknown');

    await expect(terminal.window.focus()).rejects.toMatchObject({ code: 'input-mode-disabled' });
    await expect(terminal.window.blur()).rejects.toMatchObject({ code: 'input-mode-disabled' });
    await expect(terminal.getByScreenText('MOUSE ON').click()).rejects.toMatchObject({ code: 'capability-unavailable' });
  });
});

describe.skipIf(!ptyAvailable())('a probe-backed session', { timeout: 20_000 }, () => {
  it('uses one canonical Condition evaluator for detached, visibility, state and value facts', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { ...environment(), TERMWRIGHT_FIXTURE_CONDITIONS: '1' },
    });
    const approve = terminal.getByTestId('approve');
    const input = terminal.getByTestId('name-input');
    const missing = terminal.getByTestId('missing');
    await approve.resolve();

    await expect(approve.evaluateCondition({ kind: 'visible', target: approve.description }))
      .resolves.toMatchObject({ verdict: 'satisfied', observation: { status: 'known', value: true } });
    await expect(approve.evaluateCondition({ kind: 'selected', target: approve.description, value: true }))
      .resolves.toMatchObject({ verdict: 'satisfied' });
    await expect(approve.evaluateCondition({ kind: 'expanded', target: approve.description, value: true }))
      .resolves.toMatchObject({ verdict: 'unsatisfied' });
    await expect(approve.evaluateCondition({ kind: 'collapsed', target: approve.description }))
      .resolves.toMatchObject({ verdict: 'satisfied' });
    await expect(input.evaluateCondition({
      kind: 'value', target: input.description, matcher: { kind: 'exact', text: '' },
    })).resolves.toMatchObject({ verdict: 'satisfied' });
    await expect(missing.evaluateCondition({ kind: 'detached', target: missing.description }))
      .resolves.toMatchObject({ verdict: 'satisfied', observation: { status: 'known', value: true } });
    await expect(missing.evaluateCondition({ kind: 'hidden', target: missing.description }))
      .resolves.toMatchObject({ verdict: 'inconclusive', observation: { status: 'absent', reason: 'detached' } });
    await expect(missing.evaluateCondition({
      kind: 'not', condition: { kind: 'enabled', target: missing.description },
    })).resolves.toMatchObject({ verdict: 'inconclusive', observation: { status: 'absent', reason: 'detached' } });
  });

  it('re-resolves a ref when the probe has stable identity', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { ...environment(), TERMWRIGHT_FIXTURE_PROBE: 'stable' },
    });
    const approve = await terminal.getByRole('button', { name: 'Approve' }).resolve();
    expect(approve.identity).toBe('stable');
    expect(terminal.capabilities().probe).toEqual({
      framework: 'fixture-fw',
      frameworkVersion: '1.0.0',
      probeVersion: '0.1.0',
      identityKind: 'stable',
      capabilities: ['stable-identity'],
    });

    const again = await terminal.locatorForRef(approve.ref).resolve();
    expect(again.ref).toBe(approve.ref);

    await terminal.press('Tab');
    await expect
      .poll(() => terminal.semanticTree()?.revision ?? 0)
      .toBeGreaterThan(approve.revision);
    const afterFrame = await terminal.locatorForRef(approve.ref).resolve();
    expect(afterFrame.name).toBe('Approve');
    expect(afterFrame.revision).toBeGreaterThan(approve.revision);
  });

  it('refuses to re-resolve a ref the framework cannot keep', async () => {
    // Ratatui's case. Re-resolving here would answer "what holds that number
    // now?" rather than "did this node change?", and the difference is a test
    // that passes while asserting about a widget it never selected.
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { ...environment(), TERMWRIGHT_FIXTURE_PROBE: 'frame-local' },
    });
    const approve = await terminal.getByRole('button', { name: 'Approve' }).resolve();
    expect(approve.identity).toBe('frame-local');

    const error = await Promise.resolve()
      .then(() => terminal.locatorForRef(approve.ref))
      .catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('capability-unavailable');
    expect((error as TermwrightError).diagnostics.suggestion).toContain('testId');

    // Everything addressed by role, name or testId keeps working.
    expect((await terminal.getByTestId('approve').resolve()).name).toBe('Approve');
  });

  it('refuses to click geometry the probe cannot vouch for', async () => {
    // Geometry can be exact while pointer ownership is still unobservable.
    // Clicking anyway lands real input somewhere real and credits it to this
    // target — a green test that tested nothing.
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { ...environment(), TERMWRIGHT_FIXTURE_PROBE: 'stable' },
    });
    const approve = terminal.getByRole('button', { name: 'Approve' });
    expect((await approve.resolve()).occlusion).toBeUndefined();
    const geometry = await approve.geometry();
    expect(geometry.coordinateSpace).toMatchObject({ status: 'known', value: 'viewport-cells' });
    expect(geometry.visibleRect).toMatchObject({ status: 'known' });
    const hit = await approve.hitTest();
    expect(hit.point.status).toBe('known');
    expect(hit.receivesEvents).toMatchObject({ status: 'unsupported', capability: 'pointer-hit-grid' });
    expect(hit.recipient).toMatchObject({ status: 'unsupported', capability: 'pointer-hit-grid' });

    const error = await approve.click().catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('capability-unavailable');
    expect((error as TermwrightError).message).toContain(
      process.platform === 'win32' ? 'effective session contract' : 'authoritative pointer regions',
    );

    // The keyboard path is untouched: refusing the pointer is not refusing the
    // widget, and the suggestion says so.
    await terminal.press('Tab');
  });

  it('never turns framework-local geometry into physical pointer input', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: {
        ...environment(),
        TERMWRIGHT_FIXTURE_PROBE: 'stable',
        TERMWRIGHT_FIXTURE_RELATIVE_BOUNDS: '1',
      },
    });
    const approve = terminal.getByRole('button', { name: 'Approve' });
    expect((await approve.geometry()).visibleRect.status).not.toBe('known');
    expect(terminal.capabilities().capabilities).not.toContain('intended-geometry');

    const error = await approve.click().catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('capability-unavailable');
    expect((error as TermwrightError).message).toContain(
      process.platform === 'win32' ? 'effective session contract' : 'authoritative pointer regions',
    );
  });

  it('keeps an unrecognised widget selectable by its framework type', async () => {
    // The point of D1's generic role: the widget survives, and frameworkType
    // is what makes it addressable once it has.
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { ...environment(), TERMWRIGHT_FIXTURE_PROBE: 'stable' },
    });

    const scroller = await terminal
      .getByRole('generic', { frameworkType: 'ScrollView' })
      .resolve();
    expect(scroller.frameworkType).toBe('ScrollView');
    // Provenance travels with the target: a name that was guessed should not
    // look like one the author wrote.
    expect(scroller.provenance).toBe('heuristic');

    const missing = await terminal
      .getByRole('generic', { frameworkType: 'NoSuchWidget' })
      .count();
    expect(missing).toBe(0);
  });
});

describe.skipIf(!ptyAvailable())('a semantic session over a real PTY', { timeout: 20_000 }, () => {
  it('returns only after a required semantic capability is frozen as supported', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      requiredCapabilities: ['semantic-tree'],
    });
    expect(terminal.contract()?.capabilities['semantic-tree'].status).toBe('supported');
  });

  it('negotiates the tree, pairs revisions and resolves semantic locators', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('Permission required');

    const capabilities = terminal.capabilities();
    expect(capabilities.semanticTree).toBe(true);
    expect(capabilities.adapter?.name).toBe('fixture');
    expect(capabilities.probe).toBeUndefined();
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

  it('pairs the revision once the marker reaches the emulator', async () => {
    // Separates two failures that look identical from the outside: an adapter
    // that never committed, and a terminal that ate the commit. The receipt is
    // plain text, so it survives anything that strips escape sequences.
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_FIXTURE_MARK_PROBE: '1' },
    });
    await terminal.waitForText('MARKED 1');

    // Waited by hand rather than with expect.poll: a failing poll throws on its
    // own, before any assertion carrying the driver's account of what it saw —
    // and on a platform where this fails, that account is the whole point.
    const deadline = Date.now() + 3_000;
    while (terminal.semanticTree() === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const account = terminal
      .diagnostics()
      .map((entry) => `${entry.code}: ${entry.detail}`)
      .join(' | ');
    // Printed unconditionally so the evidence reaches the log even when a
    // later assertion is the one that fails.
    console.log(`[marker probe] tree=${terminal.semanticTree()?.revision ?? 'none'} diagnostics: ${account}`);

    expect(terminal.semanticTree()?.revision, account).toBe(1);
    expect(terminal.diagnostics().some((entry) => entry.code === 'marker-unverified'), account).toBe(false);
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

  it('supports Termwright semantic selectors, within() and testIds', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('Permission required');

    const reject = await terminal.locator('dialog button#reject').resolve();
    expect(reject.name).toBe('Reject');

    const scoped = terminal.getByRole('button', { name: 'Approve' }).within(terminal.locator('dialog'));
    expect((await scoped.resolve()).ref).toMatch(/^n2@/u);

    expect(await terminal.getByTestId('approve').textContent()).toBe('Approve');
    expect(await terminal.locator('button:focused').textContent()).toBe('Approve');
  });

  it('composes semantic locators lazily with descendants, filters, boolean algebra and positional selection', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    await terminal.waitForText('Permission required');

    const dialog = terminal.getByRole('dialog');
    const buttons = dialog.getByRole('button');
    expect(await buttons.count()).toBe(2);
    expect(await buttons.first().textContent()).toBe('Approve');
    expect(await buttons.last().textContent()).toBe('Reject');
    expect(await buttons.nth(1).textContent()).toBe('Reject');

    expect(await dialog.filter({ hasText: 'Reject' }).count()).toBe(1);
    expect(await dialog.filter({ has: terminal.getByRole('button', { name: 'Reject' }) }).count()).toBe(1);
    expect(await dialog.filter({ hasNot: terminal.getByRole('button', { name: 'Missing' }) }).count()).toBe(1);

    const approve = terminal.getByRole('button').and(terminal.getByTestId('approve'));
    expect(await approve.textContent()).toBe('Approve');
    const either = terminal.getByTestId('approve').or(terminal.getByTestId('reject'));
    expect(await either.count()).toBe(2);

    // Operator order is part of the lazy AST; selecting before filtering is
    // intentionally different from filtering before selecting.
    expect(await buttons.nth(0).filter({ hasText: 'Reject' }).count()).toBe(0);
    expect(await buttons.filter({ hasText: 'Reject' }).nth(0).textContent()).toBe('Reject');
    expect(await either.filter({ hasText: 'Reject' }).count()).toBe(1);

    const chained = terminal.getByTestId('approve')
      .and(terminal.getByRole('button'))
      .or(dialog.getByRole('button', { name: 'Reject' }));
    expect(await chained.count()).toBe(2);

    expect(() => terminal.getByRole('button').or(terminal.getByScreenText('Approve'))).toThrow(/cannot combine semantic and terminal-grid/u);
    expect(() => dialog.getByScreenText('Approve')).toThrow(/cannot combine semantic and terminal-grid/u);

    const sticky = dialog.filter({ hasText: /Reject/y });
    expect(await sticky.count()).toBe(1);
    expect(await sticky.count()).toBe(1);

    const other = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    expect(() => terminal.getByRole('button').within(other.getByRole('dialog'))).toThrow(/same terminal session/u);
  });

  it.skipIf(process.platform === 'win32')('clicks a semantic node through the PTY and observes the new revision', async () => {
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

  it.skipIf(process.platform === 'win32')('plans around a covered center cell using the authoritative hit region', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_FIXTURE_COVER_APPROVE_CENTER: '1' },
    });
    const input: Uint8Array[] = [];
    terminal.events.on('input', (event) => {
      if (event.kind === 'mouse') input.push(event.data);
    });
    const approve = terminal.getByTestId('approve');
    expect(await approve.actionability('click')).toMatchObject({ actionable: true, strategy: 'authoritative-pointer-region' });
    await approve.click();
    await terminal.waitForText('CLICKED approve');
    const wire = Buffer.concat(input.map((bytes) => Buffer.from(bytes))).toString('utf8');
    expect(wire).not.toContain(';7;2M');
  });


  it('does not mutate the contract for an adapter that misses the negotiation window', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 50,
      env: { TERMWRIGHT_FIXTURE_HELLO_DELAY: '400' },
    });
    const contract = await terminal.settled();
    expect(contract.capabilities['semantic-tree'].status).toBe('unsupported');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(terminal.contract()).toBe(contract);
    await expect(terminal.getByRole('button', { name: 'Reject' }).resolve({ timeout: 20 })).rejects.toMatchObject({ code: 'semantic-capability-unavailable' });
  });

  it('still refuses semantic locators once the session is generic for good', async () => {
    const terminal = await launch('echo-app.mjs', { semanticNegotiationMs: 30 });
    await terminal.waitForText('READY');

    // The negotiated answer is final; there is no hidden late-attach window.
    const early = await terminal
      .getByTestId('nothing')
      .resolve({ timeout: 50 })
      .catch((cause: unknown) => cause as TermwrightError);
    expect((early as TermwrightError).code).toBe('semantic-capability-unavailable');

    // Repeated calls keep the same contract and fail the same way.
    await expect
      .poll(
        () =>
          terminal
            .getByTestId('nothing')
            .resolve({ timeout: 50 })
            .then(() => 'resolved')
            .catch((cause: unknown) => (cause as TermwrightError).code),
        { timeout: 6_000 },
      )
      .toBe('semantic-capability-unavailable');
  });

  it('reports an empty published value as empty text, not as the label', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    const input = terminal.getByTestId('name-input');
    await input.resolve();

    // The textbox publishes value: '' — an empty input has no text, and
    // falling back to its label would make an empty-text assertion impossible.
    expect(await input.textContent()).toBe('');
    expect(await input.semanticValue()).toBe('');

    await terminal.press('a');
    await terminal.waitForText('name: [a]');
    await expect.poll(() => input.textContent()).toBe('a');
    await expect.poll(() => input.semanticValue()).toBe('a');

    // A node without a value still falls back to its name.
    expect(await terminal.getByTestId('approve').textContent()).toBe('Approve');
    expect(await terminal.getByTestId('approve').semanticValue()).toBeNull();
  });

  it('keeps working when the adapter publishes no bounds at all', async () => {
    // Legal baseline contract: this adapter permanently does not expose
    // geometry, so observations are unsupported rather than retryable.
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: {
        TERMWRIGHT_FIXTURE_NO_BOUNDS: '1',
        TERMWRIGHT_FIXTURE_STARTUP_REPUBLISH: '1',
        ...(process.platform === 'win32' ? { TERMWRIGHT_FIXTURE_MOUSE_MODE: '0' } : {}),
      },
    });
    await terminal.waitForText('Permission required');
    await waitForPairedSemanticRevision(terminal, 2);

    const approve = terminal.getByRole('button', { name: 'Approve' });
    const target = await approve.resolve();
    expect(target.semantic).toBe(true);
    expect(target.rect).toBeNull();
    expect(await approve.count()).toBe(1);
    expect(await approve.textContent()).toBe('Approve');
    expect(await approve.semanticState()).toMatchObject({ focused: true });
    const visibility = await approve.visibility();
    expect(visibility.attached).toMatchObject({ status: 'known', value: true });
    expect(visibility.viewport).toEqual({ status: 'unsupported', capability: 'clipped-geometry', reason: 'framework-unobservable' });
    const geometry = await approve.geometry();
    expect(geometry.visibleRect).toEqual({ status: 'unsupported', capability: 'clipped-geometry', reason: 'framework-unobservable' });

    const error = await approve.click().catch((cause: unknown) => cause as TermwrightError);
    expect((error as TermwrightError).code).toBe('capability-unavailable');

    // Keyboard activation still reaches the focused node.
    const receipt = await approve.activate();
    expect(receipt.plan.strategy).toBe('focus-enter');
    await terminal.waitForText('ACTIVATED approve');
  });

  it('fails closed when the negotiated semantic provider disappears', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_FIXTURE_MOUSE_MODE: '0' },
    });
    await terminal.getByTestId('approve').resolve();
    const retained = terminal.semanticTree();
    await terminal.write('P');
    await terminal.waitForText('PROVIDER DISCONNECTED');
    await expect.poll(() => terminal.diagnostics().some((entry) => entry.code === 'adapter-disconnected')).toBe(true);
    expect(terminal.semanticTree()).toBe(retained);
    await expect(terminal.getByTestId('approve').resolve()).rejects.toMatchObject({ code: 'capability-provider-lost' });
  });

  it('rejects stale application evidence sent by a real adapter process', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_FIXTURE_STALE_PROVIDER: '1' },
    });
    await terminal.settled();
    await terminal.write('a');
    await terminal.waitForText('name: [a]');
    await expect(terminal.getByTestId('approve').click()).rejects.toMatchObject({
      code: 'capability-provider-violation',
      message: expect.stringContaining('evidence revision 1 does not match snapshot revision 2'),
    });
  });

  it('fails closed when a frozen geometry guarantee degrades', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: {
        TERMWRIGHT_FIXTURE_NO_BOUNDS: '1',
        TERMWRIGHT_FIXTURE_BROKEN_GEOMETRY_GUARANTEE: '1',
      },
    });
    await expect(terminal.settled()).rejects.toMatchObject({ code: 'adapter-guarantee-violation' });
    await expect(terminal.getByRole('button', { name: 'Approve' }).resolve()).rejects.toMatchObject({
      code: 'adapter-guarantee-violation',
    });
  });

  it('surfaces duplicate explicit identity as a typed fatal session error', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_FIXTURE_DUPLICATE_KEY: '1' },
    });
    await expect(terminal.settled()).rejects.toMatchObject({ code: 'duplicate-semantic-key' });
    await expect(terminal.getByRole('button', { name: 'Approve' }).resolve()).rejects.toMatchObject({
      code: 'duplicate-semantic-key',
    });
  });

  it('rejects retryable unknown evidence when its revision becomes committed', async () => {
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: {
        TERMWRIGHT_FIXTURE_NO_BOUNDS: '1',
        TERMWRIGHT_FIXTURE_BROKEN_GEOMETRY_GUARANTEE: '1',
        TERMWRIGHT_FIXTURE_COMMITTED_UNKNOWN: '1',
      },
    });
    await expect(terminal.settled()).rejects.toMatchObject({ code: 'adapter-guarantee-violation' });
    expect(terminal.diagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining('transient unknown evidence') }),
    ]));
  });

  it('activates the focused node with the keyboard and reports the strategy', async () => {
    // This is a keyboard strategy test. Keeping the unrelated mouse DECSET out
    // also prevents ConPTY's delayed mode traffic from creating a newer,
    // deliberately unpaired terminal observation after the render marker.
    const terminal = await launch('semantic-app.mjs', {
      semanticNegotiationMs: 5_000,
      env: {
        TERMWRIGHT_FIXTURE_MOUSE_MODE: '0',
        TERMWRIGHT_FIXTURE_STARTUP_REPUBLISH: '1',
      },
    });
    await terminal.waitForText('Permission required');
    await waitForPairedSemanticRevision(terminal, 2);

    const receipt = await terminal.getByTestId('approve').activate();
    expect(receipt.plan.strategy).toBe('focus-enter');
    await terminal.waitForText('ACTIVATED approve');
  });

  it('replans a keyboard action after a torn render without sending stale input', async () => {
    const terminal = await launch('semantic-app.mjs', { semanticNegotiationMs: 5_000 });
    const approve = terminal.getByTestId('approve');
    await approve.resolve();
    const keyboardInput: Uint8Array[] = [];
    terminal.events.on('input', ({ kind, data }) => {
      if (kind === 'key') keyboardInput.push(data);
    });

    await terminal.write('U');
    await terminal.waitForText('UNPAIRED SCREEN UPDATE');
    const receipt = await approve.activate({ timeout: 2_000 });

    expect(receipt.before.pairedScreenRevision).toBe(receipt.before.screenRevision);
    expect(receipt.plan.strategy).toBe('focus-enter');
    expect(keyboardInput).toHaveLength(1);
    await terminal.waitForText('ACTIVATED approve');
  });
});
