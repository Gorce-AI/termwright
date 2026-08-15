/**
 * Readiness and the child's environment.
 *
 * `waitForReady` is the one wait that is allowed to be a heuristic, so what is
 * certified here is not just that it returns but that it is *honest about how*
 * it decided: shell-integration marks when the program emits them, a
 * settled-screen guess when it does not, and a `ready-strategy` diagnostic
 * naming which of the two happened.
 *
 * `envMode` is next to it because both are launch-time contracts about what the
 * child is handed before it can be ready at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionDiagnostic, TerminalHarness } from '@termwright/driver';
import { TermwrightError } from '@termwright/driver';
import { CONFORMANCE_FIXTURES, createSessionPool, ptyAvailable, rejection } from '../support/pty.js';

const sessions = createSessionPool();

/** The last readiness decision the session recorded. */
function lastStrategy(terminal: TerminalHarness): SessionDiagnostic | undefined {
  return terminal.diagnostics().findLast((entry) => entry.code === 'ready-strategy');
}

const prompt = (args: readonly string[] = []) =>
  sessions.launch(CONFORMANCE_FIXTURES.prompt(), { columns: 60, rows: 12, args });

afterEach(sessions.closeAll);

describe.skipIf(!ptyAvailable())('waiting for readiness', () => {
  it('prefers OSC 133 marks when the program emits them', async () => {
    const terminal = await prompt();
    await terminal.waitForReady();

    expect(terminal.screen().text()).toContain('PROMPT APP');
    const strategy = lastStrategy(terminal);
    expect(strategy?.detail).toContain('shell integration');
    // `B` is input-start: the prompt is drawn and waiting, which is what
    // "ready" has to mean for a program that says so itself.
    expect(strategy?.detail).toContain('B');
  });

  it('waits out a running command instead of returning between marks', async () => {
    const terminal = await prompt(['--work=400']);
    await terminal.waitForReady();

    await terminal.type('hello');
    await terminal.press('Enter');
    await terminal.waitForText('RUNNING hello');

    // The command is running now: OSC 133 C was emitted and D has not been.
    // Readiness must mean the next prompt, not the moment the keystroke landed.
    await terminal.waitForReady();
    expect(terminal.screen().text()).toContain('ran hello');

    const strategies = terminal.diagnostics().filter((entry) => entry.code === 'ready-strategy');
    expect(strategies).toHaveLength(2);
    expect(strategies.every((entry) => entry.detail.includes('shell integration'))).toBe(true);
  });

  it('reports a command that never finished as a timeout, not as readiness', async () => {
    const terminal = await prompt();
    await terminal.waitForReady();

    await terminal.type('hang');
    await terminal.press('Enter');
    await terminal.waitForText('HANGING');

    const error = (await rejection(terminal.waitForReady({ timeout: 600 }))) as TermwrightError;
    expect(error.code).toBe('timeout');
    expect(error.message).toContain('running command');
    expect(error.diagnostics.screenExcerpt).toContain('HANGING');
  });

  it('falls back to a settled screen, and says that is what it did', async () => {
    // Same fixture, same output, marks suppressed: the only difference is
    // whether the program tells the terminal where its prompt is.
    const terminal = await prompt(['--marks=off']);
    await terminal.waitForReady();

    expect(terminal.screen().text()).toContain('PROMPT APP');
    const strategy = lastStrategy(terminal);
    expect(strategy?.detail).toContain('settled-screen heuristic');
    expect(strategy?.detail).not.toContain('shell integration');
  });

  it('is available to an uninstrumented program with no prompt at all', async () => {
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.generic(), { columns: 60, rows: 20 });
    await terminal.waitForReady();

    expect(terminal.screen().text()).toContain('GENERIC READY');
    expect(lastStrategy(terminal)?.detail).toContain('settled-screen heuristic');
  });

  it('still reports readiness from the last prompt of an exited program', async () => {
    const terminal = await prompt();
    await terminal.waitForReady();
    await terminal.type('quit');
    await terminal.press('Enter');
    await terminal.waitForExit();

    // Pinned as observed, not as desired. The last OSC 133 mark still says a
    // prompt is waiting, so `waitForReady` resolves for a process that can no
    // longer take input — while `waitForText` on the same session throws
    // `process-exited`. Reported to the driver as an inconsistency between the
    // waits; this expectation flips when they align.
    await terminal.waitForReady();
    expect(lastStrategy(terminal)?.detail).toContain('shell integration');

    const error = (await rejection(terminal.waitForText('never printed', { timeout: 200 }))) as TermwrightError;
    expect(error.code).toBe('process-exited');
  });
});

describe.skipIf(!ptyAvailable())("the child's environment", () => {
  it("does not hand the runner's environment to the child by default", async () => {
    process.env['CONFORMANCE_ECHO'] = 'leaked';
    try {
      const terminal = await sessions.launch(CONFORMANCE_FIXTURES.generic(), { columns: 60, rows: 20 });
      await terminal.waitForText('env: unset');
      expect(terminal.screen().text()).not.toContain('env: leaked');
    } finally {
      delete process.env['CONFORMANCE_ECHO'];
    }
  });

  it('passes what the caller declares, in either mode', async () => {
    const replaced = await sessions.launch(CONFORMANCE_FIXTURES.generic(), {
      columns: 60,
      rows: 20,
      env: { CONFORMANCE_ECHO: 'declared' },
    });
    await replaced.waitForText('env: declared');

    process.env['CONFORMANCE_ECHO'] = 'inherited';
    try {
      const inherited = await sessions.launch(CONFORMANCE_FIXTURES.generic(), {
        columns: 60,
        rows: 20,
        envMode: 'inherit',
      });
      await inherited.waitForText('env: inherited');
    } finally {
      delete process.env['CONFORMANCE_ECHO'];
    }
  });

  it('still instruments the child in the secret-safe mode', async () => {
    // The allowlist must not cost the handshake: a semantic session has to work
    // without the caller forwarding anything.
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.semanticInk(), {
      columns: 80,
      rows: 24,
      semanticNegotiationMs: 5_000,
    });
    await terminal.waitForText('Termwright Conformance');
    await terminal.getByTestId('status').resolve();

    expect(terminal.capabilities().semanticTree).toBe(true);
    expect(terminal.diagnostics().map((entry) => entry.code)).toContain('adapter-attached');
  });
});
