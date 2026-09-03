/**
 * Interaction conformance — origin spec §20.4.
 *
 * The scenarios a terminal driver is actually judged on: pointer input with
 * coordinates that have to be right, the two selection models, scrollback that
 * belongs to the emulator rather than the child, paste and focus protocols,
 * reflow, mouse-mode transitions, Unicode width, the alternate screen, and
 * session ownership when more than one is open.
 */
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/test';
import type { AnyLocator, TerminalHarness } from '@termwright/driver';
import type { Rect } from '@termwright/protocol';
import { TermwrightError } from '@termwright/driver';
import {
  CONFORMANCE_FIXTURES,
  createSessionPool,
  disableFocusReporting,
  disableMouseReporting,
  enableFocusReporting,
  enableMouseReporting,
  ptyAvailable,
  rejection,
} from '../support/pty.js';

const sessions = createSessionPool();
const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });

async function intendedRect(locator: AnyLocator): Promise<Rect | null> {
  const observation = (await locator.geometry()).intendedRect;
  return observation.status === 'known' ? observation.value : null;
}

async function generic(options = {}): Promise<TerminalHarness> {
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
}

/**
 * Turns on the child's mouse reporting.
 *
 * Every certified backend exposes the resulting DECSET transition.
 */
async function enableMouse(terminal: TerminalHarness, mode: 'click' | 'drag'): Promise<void> {
  return enableMouseReporting(terminal, mode);
}

afterEach(sessions.closeAll);

describe.skipIf(!ptyAvailable())('pointer interaction', () => {
  it('clicks, double-clicks and misses', async () => {
    const terminal = await generic();
    await enableMouse(terminal, 'click');

    await terminal.getByScreenText('Beta').click();
    await terminal.waitForText('ev: MOUSE press b=0 c=4 r=3');

    // The fixture reports the double click as its own event, so this waits for
    // the pair to complete rather than counting two identical lines — a count
    // is already satisfied by the first press when the pair arrives in two
    // chunks, which a loaded machine does regularly.
    await terminal.getByScreenText('Gamma').doubleClick();
    await terminal.waitForText('ev: MOUSE dblclick c=5 r=4');

    // Device-level input can deliberately aim outside every locator region.
    // Locator offsets remain constrained to the target's PhysicalRegion.
    await terminal.mouse.click({ row: 11, column: 42 });
    await terminal.waitForText('ev: MOUSE press b=0 c=43 r=12');
  });

  it('drags and lets the application own the selection', async () => {
    const terminal = await generic();
    await enableMouse(terminal, 'drag');

    await terminal.mouse.drag({ from: { row: 1, column: 2 }, to: { row: 3, column: 6 }, steps: 1 });

    // Press at the origin, motion with the drag bit set, release at the target.
    await terminal.waitForText('ev: MOUSE press b=0 c=3 r=2');
    await terminal.waitForText('ev: MOUSE press b=32 c=7 r=4');
    await terminal.waitForText('ev: MOUSE release b=0 c=7 r=4');
  });

  it('copies an emulator-side selection without sending any input', async () => {
    const terminal = await generic();
    const inputs: string[] = [];
    terminal.events.on('input', ({ kind }) => inputs.push(kind));

    terminal.selection.selectCells({ start: { row: 1, column: 2 }, end: { row: 1, column: 6 } });
    expect(terminal.selection.copy()).toBe('Alpha');

    terminal.selection.selectCells({ start: { row: 1, column: 0 }, end: { row: 3, column: 6 } });
    // A cell selection is rectangular, so the short row keeps its padding.
    expect(terminal.selection.copy().split('\n')).toEqual(['> Alpha', '  Beta ', '  Gamma']);

    terminal.selection.clear();
    expect(terminal.selection.copy()).toBe('');
    // The child must not have observed the selection at all.
    expect(inputs).toEqual([]);
    expect(terminal.screen().text()).toContain('ev: none');
  });
});

describe.skipIf(!ptyAvailable())('terminal-side interaction', () => {
  it('scrolls the scrollback without the child ever knowing', async () => {
    const terminal = await generic({ rows: 10, scrollbackLines: 200 });
    await terminal.press('s');
    await terminal.waitForText('SCROLL DONE');

    // Wait for the history itself, not for the program to fall silent.
    // `waitForQuiet` asks "has output stopped for 100 ms", which on a loaded
    // machine is a question about the scheduler: 120 lines arriving in bursts
    // keep resetting the quiet window, and the wait fails for a reason that has
    // nothing to do with scrollback. These two conditions are the state the
    // assertions below are about, and they only ever become true.
    await expect.poll(() => terminal.scrollback.length).toBeGreaterThan(50);
    await expect.poll(() => terminal.scrollback.search('line 55').length).toBe(1);

    const inputs: string[] = [];
    terminal.events.on('input', ({ kind }) => inputs.push(kind));

    const before = terminal.scrollback.position();
    terminal.scrollback.move({ lines: -20 });
    expect(terminal.scrollback.position()).toBeLessThan(before);
    terminal.scrollback.move({ lines: 20 });
    expect(terminal.scrollback.position()).toBe(before);

    // Scrolling is an emulator operation: no bytes reached the program.
    expect(inputs).toEqual([]);
  });

  it('reflows a long line on resize', async () => {
    const terminal = await generic({ columns: 60, rows: 20 });
    await terminal.press('w');
    await terminal.waitForText('W: 0123456789');

    const wrapped = await intendedRect(terminal.getByScreenText('END'));
    const start = await intendedRect(terminal.getByScreenText('W: 0123456789'));
    expect(wrapped?.row).toBeGreaterThan(start?.row ?? 0);

    await terminal.resize({ columns: 140, rows: 20 });
    await terminal.waitForText('size: 140x20');
    const wide = await intendedRect(terminal.getByScreenText('END'));
    const wideStart = await intendedRect(terminal.getByScreenText('W: 0123456789'));
    expect(wide?.row).toBe(wideStart?.row);
  });

  it('follows mouse mode on and off', async () => {
    const terminal = await generic();
    await enableMouse(terminal, 'click');
    await terminal.getByScreenText('Alpha').click();
    await terminal.waitForText('ev: MOUSE press b=0');

    await disableMouseReporting(terminal);
    const refused = (await rejection(terminal.getByScreenText('Alpha').click())) as TermwrightError;
    expect(refused.code).toBe('input-mode-disabled');

    await enableMouse(terminal, 'drag');
    await terminal.mouse.drag({ from: { row: 1, column: 2 }, to: { row: 2, column: 2 } });
    await terminal.waitForText('ev: MOUSE press b=32');
  });

  it('reports focus in and out only while the child asks for it', async () => {
    const terminal = await generic();
    const before = (await rejection(terminal.window.focus())) as TermwrightError;
    expect(before.code).toBe('input-mode-disabled');

    await enableFocusReporting(terminal);
    expect(terminal.screen().modes.focusReporting).toBe('on');

    await terminal.window.focus();
    await terminal.waitForText('ev: FOCUS:in');
    await terminal.window.blur();
    await terminal.waitForText('ev: FOCUS:out');

    await disableFocusReporting(terminal);
    expect(((await rejection(terminal.window.focus())) as TermwrightError).code).toBe(
      'input-mode-disabled',
    );
  });

  it('brackets a paste only when the child enabled bracketed paste', async () => {
    const terminal = await generic();
    await terminal.paste('zz');
    await terminal.waitForText('ev: KEY:7a');

    await terminal.press('b');
    await expect.poll(() => terminal.screen().modes.bracketedPaste).toBe(true);
    await terminal.paste('multi word paste');
    await terminal.waitForText('ev: PASTE:multi word paste');
  });

  it('measures Unicode the way the terminal does', async () => {
    const terminal = await generic();
    await terminal.press('u');
    await terminal.waitForText('日本語');

    const cjk = await intendedRect(terminal.getByScreenText('日本語'));
    expect(cjk).not.toBeNull();
    // Three CJK glyphs occupy six columns.
    expect(cjk?.width).toBe(6);
    const first = terminal.cell({ row: cjk?.row ?? 0, column: cjk?.column ?? 0 });
    expect(first.char).toBe('日');
    expect(first.width).toBe(2);
    // The continuation cell of a wide glyph carries no character of its own.
    expect(terminal.cell({ row: cjk?.row ?? 0, column: (cjk?.column ?? 0) + 1 }).width).toBe(0);

    // A combining mark belongs to the cell it modifies, not to one of its own.
    const combining = await intendedRect(terminal.getByScreenText('é'));
    expect(combining?.width).toBe(1);

    expect(await terminal.getByScreenText('\u{1F600}').count()).toBe(1);
    expect(await terminal.getByScreenText('ok').count()).toBe(1);
  });

  it('enters and leaves the alternate screen, restoring what was underneath', async () => {
    const terminal = await generic();
    await terminal.press('ArrowDown');
    await terminal.waitForText('> Beta');
    expect(terminal.screen().buffer).toBe('normal');

    await terminal.press('a');
    await terminal.waitForText('ALT SCREEN');
    expect(terminal.screen().buffer).toBe('alternate');

    await terminal.press('a');
    await expect.poll(() => terminal.screen().buffer).toBe('normal');
    // The normal buffer comes back as the terminal restored it — including the
    // selection the program had made before it left.
    const restored = terminal.screen().text();
    expect(restored).toContain('GENERIC READY');
    expect(restored).toContain('> Beta');
    expect(restored).not.toContain('ALT SCREEN');
  });
});

describe.skipIf(!ptyAvailable())('session ownership', () => {
  resourceAwareIt.resources({ terminals: 2, traceWriters: 0 })(
    'keeps concurrent sessions independent and closes exactly one',
    async () => {
      const first = await generic();
      const second = await generic();
      expect(first.sessionId).not.toBe(second.sessionId);

      await first.press('ArrowDown');
      await first.waitForText('> Beta');
      // The second session must be untouched by input sent to the first.
      expect(second.screen().text()).toContain('> Alpha');

      await first.close();
      expect(((await rejection(first.press('a'))) as TermwrightError).code).toBe('session-closed');

      await second.press('ArrowDown');
      await second.waitForText('> Beta');
      await second.press('q');
      expect(await second.waitForExit()).toEqual({ code: 0, signal: null });
    },
  );
});
