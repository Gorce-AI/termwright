/**
 * Readiness and the child's environment.
 *
 * Prompt readiness and quiet-screen heuristics are deliberately separate.
 * `waitForShellPrompt` proves OSC 133; `waitForQuiet` only proves silence.
 *
 * `envMode` is next to it because both are launch-time contracts about what the
 * child is handed before it can be ready at all.
 */
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import type { DiagnosticCode, TerminalHarness } from '@termwright/driver';
import { TermwrightError } from '@termwright/driver';
import {
  CONFORMANCE_FIXTURES,
  createSessionPool,
  ptyAvailable,
  rejection,
} from '../support/pty.js';

const sessions = createSessionPool();
const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });

/** Readiness decisions the session recorded, in order. */
function strategies(terminal: TerminalHarness): readonly DiagnosticCode[] {
  return terminal
    .diagnostics()
    .map((entry) => entry.code)
    .filter((code) => code === 'ready-shell-integration');
}

const prompt = (args: readonly string[] = []) =>
  sessions.launch(CONFORMANCE_FIXTURES.prompt(), { columns: 60, rows: 12, args });

afterEach(sessions.closeAll);

describe.skipIf(!ptyAvailable())('waiting for readiness', () => {
  it('prefers OSC 133 marks when the program emits them', async () => {
    const terminal = await prompt();
    await terminal.waitForShellPrompt();

    expect(terminal.screen().text()).toContain('PROMPT APP');
    // A fact and a guess are different outcomes and carry different codes, so
    // "which strategy decided this" is assertable without matching prose.
    expect(strategies(terminal)).toEqual(['ready-shell-integration']);
  });

  it('waits out a running command instead of returning between marks', async () => {
    const terminal = await prompt(['--work=400']);
    await terminal.waitForShellPrompt();

    await terminal.type('hello');
    await terminal.press('Enter');
    await terminal.waitForText('RUNNING hello');

    // The command is running now: OSC 133 C was emitted and D has not been.
    // Readiness must mean the next prompt, not the moment the keystroke landed.
    await terminal.waitForShellPrompt();
    expect(terminal.screen().text()).toContain('ran hello');

    expect(strategies(terminal)).toEqual(['ready-shell-integration', 'ready-shell-integration']);
  });

  it('reports a command that never finished as a timeout, not as readiness', async () => {
    const terminal = await prompt();
    await terminal.waitForShellPrompt();

    await terminal.type('hang');
    await terminal.press('Enter');
    await terminal.waitForText('HANGING');

    const error = (await rejection(
      terminal.waitForShellPrompt({ timeout: 600 }),
    )) as TermwrightError;
    expect(error.code).toBe('timeout');
    expect(error.diagnostics.screenExcerpt).toContain('HANGING');
    // Structural rather than textual: the wait must not have concluded
    // readiness by either strategy. Matching the message would pin the driver's
    // prose, which is exactly what the diagnostic codes exist to avoid.
    expect(strategies(terminal)).toEqual(['ready-shell-integration']);
  });

  it('refuses to call silence a shell prompt when marks are absent', async () => {
    // Same fixture, same output, marks suppressed: the only difference is
    // whether the program tells the terminal where its prompt is.
    const terminal = await prompt(['--marks=off']);
    await terminal.waitForText('PROMPT APP');
    await terminal.waitForQuiet({ quietMs: 150 });

    expect(terminal.screen().text()).toContain('PROMPT APP');
    const error = (await rejection(
      terminal.waitForShellPrompt({ timeout: 100 }),
    )) as TermwrightError;
    expect(error.code).toBe('capability-unavailable');
    expect(strategies(terminal)).toEqual([]);
  });

  it('is available to an uninstrumented program with no prompt at all', async () => {
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.generic(), {
      columns: 60,
      rows: 20,
    });
    await terminal.waitForText('GENERIC READY');
    await terminal.waitForQuiet();

    expect(terminal.screen().text()).toContain('GENERIC READY');
    expect(strategies(terminal)).toEqual([]);
  });

  it('refuses to call a dead program ready, even with a prompt still on screen', async () => {
    const terminal = await prompt();
    await terminal.waitForShellPrompt();
    await terminal.type('quit');
    await terminal.press('Enter');
    await terminal.waitForExit();

    // The last OSC 133 mark still says a prompt is waiting, and the prompt is
    // still on the grid — but readiness is a claim about the *future*: that the
    // program will accept input. A dead one will not, so this must fail rather
    // than hand back a promise the next press() would break.
    const error = (await rejection(
      terminal.waitForShellPrompt({ timeout: 500 }),
    )) as TermwrightError;
    expect(error.code).toBe('process-exited');

    // The waits that assert an *observation* keep working after exit, on
    // purpose: what was printed stays printed. The split is deliberate.
    await terminal.waitForText('PROMPT APP');
  });
});

describe.skipIf(!ptyAvailable())("the child's environment", () => {
  it("does not hand the runner's environment to the child by default", async () => {
    process.env['CONFORMANCE_ECHO'] = 'leaked';
    try {
      const terminal = await sessions.launch(CONFORMANCE_FIXTURES.generic(), {
        columns: 60,
        rows: 20,
      });
      await terminal.waitForText('env: unset');
      expect(terminal.screen().text()).not.toContain('env: leaked');
    } finally {
      delete process.env['CONFORMANCE_ECHO'];
    }
  });

  it('hands the child the documented allowlist and nothing more', async () => {
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.generic(), {
      columns: 60,
      rows: 20,
    });

    // Withholding secrets must not cost the child the variables it genuinely
    // needs: a program that lost PATH or TERM fails much later, in ways that
    // look like a driver bug rather than a missing environment.
    //
    // The allowlist is per platform by design — a Windows child started
    // without `SystemRoot` aborts, and there is no `HOME` there to forward —
    // so the home variable asserted here is the one that platform's list
    // actually names. Conditioning on what *this* process happens to have was
    // the wrong question: a Windows runner does have `HOME` (bash sets it) and
    // the driver still, correctly, does not forward it.
    await terminal.waitForText('allow: PATH=yes');
    const line =
      terminal
        .screen()
        .text()
        .split('\n')
        .find((row) => row.startsWith('allow: ')) ?? '';
    expect(line).toContain(`${process.platform === 'win32' ? 'USERPROFILE' : 'HOME'}=yes`);

    // `TERM` and `COLORTERM` are not forwarded but *set*: the child's terminal
    // is the driver's emulator, whose capabilities are known exactly. So the
    // assertion is on the values, on every platform — a Windows runner has no
    // `TERM` of its own to inherit, and the child must still be told.
    const term =
      terminal
        .screen()
        .text()
        .split('\n')
        .find((row) => row.startsWith('term: ')) ?? '';
    expect(term.trim()).toBe('term: xterm-256color/truecolor');
    expect(terminal.screen().text()).toContain('env: unset');
  });

  resourceAwareIt.resources({ terminals: 2, traceWriters: 0 })(
    'passes what the caller declares, in either mode',
    async () => {
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
    },
  );

  it('still instruments the child in the secret-safe mode', async () => {
    // The allowlist must not cost the handshake: a semantic session has to work
    // without the caller forwarding anything.
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.inkProbe(), {
      columns: 80,
      rows: 24,
      semanticNegotiationMs: 5_000,
      probe: 'ink',
    });
    await terminal.waitForText('Termwright Conformance');
    await terminal.getByTestId('status').resolve();

    expect(terminal.contract()?.capabilities['semantic-tree'].status).toBe('supported');
    expect(terminal.diagnostics().map((entry) => entry.code)).toContain('adapter-attached');
  });
});
