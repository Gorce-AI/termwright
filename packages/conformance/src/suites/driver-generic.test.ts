/**
 * Generic-session conformance — origin spec §20.1.
 *
 * Everything here runs against an uninstrumented fixture, so it pins the
 * contract the driver owes to the programs it was *not* designed with: a prompt
 * fallback, grid locators, real PTY bytes for every input, no invented roles,
 * and exact exit/close semantics.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SemanticCapabilityUnavailableError, TermwrightError, type AnyLocator } from '@termwright/driver';
import type { Rect } from '@termwright/protocol';
import {
  CONFORMANCE_FIXTURES,
  createSessionPool,
  enableFocusReporting,
  enableMouseReporting,
  ptyAvailable,
  rejection,
} from '../support/pty.js';

const sessions = createSessionPool();

async function intendedRect(locator: AnyLocator): Promise<Rect | null> {
  const observation = (await locator.geometry()).intendedRect;
  return observation.status === 'known' ? observation.value : null;
}
const launch = async (options = {}) => {
  const terminal = await sessions.launch(CONFORMANCE_FIXTURES.generic(), {
    columns: 60,
    rows: 20,
    // The LAST line the fixture draws, not the banner. Its frame is 14 rows;
    // a suite that asks for fewer (the scrollback test uses 10) pushes the
    // banner off the top before anyone looks, and waiting for it then depends
    // on how the pty happened to split the write.
    ready: 'allow: PATH=',
    ...options,
  });
  return terminal;
};

afterEach(sessions.closeAll);

describe.skipIf(!ptyAvailable())('a generic session', () => {
  it('freezes the generic contract, then refuses semantic locators', async () => {
    const started = Date.now();
    const terminal = await launch({ semanticNegotiationMs: 250 });

    // Negotiation produces one immutable contract. Semantic queries do not
    // keep an implicit compatibility window open after that decision.
    await expect
      .poll(async () => (await rejection(terminal.getByRole('button').count())) instanceof SemanticCapabilityUnavailableError, {
        timeout: 15_000,
      })
      .toBe(true);

    const contract = await terminal.settled();
    expect(contract.capabilities['semantic-tree'].status).toBe('unsupported');
    expect(contract.framework).toBeNull();
    expect(terminal.semanticTree()).toBeNull();
    expect(Date.now() - started).toBeLessThan(15_000);

    // The generic frozen contract is a decision, and the session records it.
    expect(terminal.diagnostics().map((entry) => entry.code)).toContain('negotiation-timeout');
    expect(terminal.diagnostics().map((entry) => entry.code)).not.toContain('adapter-attached');
  });

  it('never invents a role for a grid match', async () => {
    const terminal = await launch();

    const target = await terminal.getByScreenText('Alpha').resolve();
    expect(target.semantic).toBe(false);
    expect(target.role).toBeUndefined();
    expect(target.name).toBeUndefined();
    expect(target.ref).toMatch(/^screen:/u);
  });

  it('resolves text, regex, occurrence, style and cell locators', async () => {
    const terminal = await launch();

    expect(await intendedRect(terminal.getByScreenText('Alpha'))).toEqual({
      row: 1,
      column: 2,
      width: 5,
      height: 1,
    });
    expect(await terminal.getByScreenText(/G[a-z]+ma/u).textContent()).toBe('Gamma');
    expect(await terminal.getByScreenText(/ev: /u).count()).toBe(4);
    expect(await intendedRect(terminal.getByScreenText(/ev: /u, { occurrence: 1 }))).toMatchObject({ row: 8 });

    // The selected row is the only bold green one, so a style predicate is what
    // separates it from the two plain rows.
    expect(await terminal.getByScreenText('Alpha', { fg: 'green', attributes: { bold: true } }).count()).toBe(1);
    expect(await terminal.getByScreenText('Beta', { fg: 'green' }).count()).toBe(0);
    expect(await terminal.getByScreenText('RED', { fg: 'red' }).count()).toBe(1);
    expect(await terminal.getByScreenText('ONBLUE', { bg: 'blue' }).count()).toBe(1);
    expect(await terminal.getByScreenText('UNDER', { attributes: { underline: true } }).count()).toBe(1);

    const cell = terminal.cell({ row: 4, column: 0 });
    expect(cell.char).toBe('R');
    expect(cell.fg).toEqual({ kind: 'palette', index: 1 });
    expect(cell.attributes.bold).toBe(false);
  });

  it('delivers keystrokes as the exact bytes a terminal sends', async () => {
    const terminal = await launch();

    await terminal.press('Control+A');
    await terminal.waitForText('ev: KEY:01');
    await terminal.press('ArrowDown');
    await terminal.waitForText('> Beta');
    await terminal.press('Enter');
    await terminal.waitForText('activated: Beta');
    await terminal.type('hi');
    await terminal.waitForText('ev: KEY:69');
    await terminal.press('F5');
    await terminal.waitForText('ev: KEY:1b 5b 31 35 7e');
  });

  it('distinguishes bracketed paste from an ordinary one', async () => {
    const terminal = await launch();

    // Without CSI ? 2004 h a paste is indistinguishable from typing.
    await terminal.paste('zz');
    await terminal.waitForText('ev: KEY:7a');
    expect(terminal.screen().text()).not.toContain('PASTE:');

    await terminal.press('b');
    await expect.poll(() => terminal.screen().modes.bracketedPaste).toBe(true);
    await terminal.paste('pasted text');
    await terminal.waitForText('ev: PASTE:pasted text');
  });

  it('resizes the pty, the emulator and the child together', async () => {
    const terminal = await launch();
    await terminal.waitForText('size: 60x20');

    await terminal.resize({ columns: 40, rows: 12 });
    await terminal.waitForText('size: 40x12');
    expect(terminal.screen().columns).toBe(40);
    expect(terminal.screen().rows).toBe(12);
    await terminal.waitForText('ev: RESIZE:40x12');
  });

  it('sends mouse reports only after the child asks for them', async () => {
    const terminal = await launch();

    const refused = await rejection(terminal.getByScreenText('Alpha').click());
    expect((refused as TermwrightError).code).toBe('input-mode-disabled');

    await enableMouseReporting(terminal, 'click');
    expect(terminal.screen().modes.mouseEncoding).toBe('sgr');

    // 'Alpha' sits at row 1, columns 2..6; its centre is cell (1, 4), which SGR
    // reports one-based. A wrong aim would report different coordinates rather
    // than fail, so the assertion is on the numbers.
    await terminal.getByScreenText('Alpha').click();
    await terminal.waitForText('ev: MOUSE press b=0 c=5 r=2');
    await terminal.waitForText('ev: MOUSE release b=0 c=5 r=2');

    await terminal.getByScreenText('Gamma').wheel({ deltaY: -1 });
    await terminal.waitForText('ev: MOUSE wheel b=64');
    await terminal.getByScreenText('Gamma').wheel({ deltaY: 1 });
    await terminal.waitForText('ev: MOUSE wheel b=65');

    await terminal.getByScreenText('Alpha').click({ button: 'right' });
    await terminal.waitForText('ev: MOUSE press b=2');

    const unverifiable = terminal
      .diagnostics()
      .filter((entry) => entry.code === 'mode-unverifiable' && entry.mode === 'mouse');
    expect(unverifiable).toHaveLength(0);
  });

  it('refuses focus reports and drags the child never enabled', async () => {
    const terminal = await launch();

    const noFocus = (await rejection(terminal.window.focus())) as TermwrightError;
    expect(noFocus.code).toBe('input-mode-disabled');
    expect(noFocus.diagnostics.suggestion).toContain('1004');

    await enableMouseReporting(terminal, 'click'); // clicks only: no motion
    const drag = terminal.mouse.drag({ from: { row: 1, column: 2 }, to: { row: 3, column: 2 } });
    const noDrag = await rejection(drag);
    expect((noDrag as TermwrightError).diagnostics.suggestion).toContain('1002');

    await enableFocusReporting(terminal);
    expect(terminal.screen().modes.focusReporting).toBe('on');
    await terminal.window.focus();
    await terminal.waitForText('ev: FOCUS:in');
    await terminal.window.blur();
    await terminal.waitForText('ev: FOCUS:out');
  });

  it('reports exit status and close exactly', async () => {
    const terminal = await launch();

    await terminal.press('x'); // the fixture exits 7
    const status = await terminal.waitForExit();
    expect(status).toEqual({ code: 7, signal: null });
    expect(await terminal.exit).toEqual(status);

    const afterExit = await rejection(terminal.press('a'));
    expect((afterExit as TermwrightError).code).toBe('process-exited');

    await terminal.close();
    await terminal.close(); // idempotent
    const afterClose = await rejection(terminal.press('a'));
    expect((afterClose as TermwrightError).code).toBe('session-closed');
  });

  it('reports a typed timeout carrying the screen the program actually drew', async () => {
    const terminal = await launch();

    const error = (await rejection(terminal.waitForText('never printed', { timeout: 300 }))) as TermwrightError;
    expect(error.code).toBe('timeout');
    expect(error.diagnostics.semanticTree).toBe(false);
    expect(error.diagnostics.screenExcerpt).toContain('GENERIC READY');
  });
});
