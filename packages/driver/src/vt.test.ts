import { afterEach, describe, expect, it } from 'vitest';
import { encodeMarker, verifyMarkerPayload } from '@termwright/protocol';
import { captureScreen, captureRows } from './screen.js';
import { matchGrid } from './matching.js';
import { textMatcher } from './selectors.js';
import { VtScreen, type MarkerSighting } from './vt.js';

let vt: VtScreen | null = null;

function createVt(columns = 40, rows = 6): VtScreen {
  // Mouse modes are forced observable: these tests drive the emulator directly,
  // so they are about what it tracks, not about what a pty hides. The hidden
  // case has its own tests, which pass the flag the other way.
  vt = new VtScreen({ columns, rows, scrollbackLines: 20, modesObservable: true });
  return vt;
}

afterEach(() => {
  vt?.dispose();
  vt = null;
});

describe('VtScreen', () => {
  it('increments a revision per parsed write', async () => {
    const screen = createVt();
    expect(screen.revision).toBe(0);
    await screen.write('hello');
    expect(screen.revision).toBe(1);
    await screen.write(' world');
    expect(screen.revision).toBe(2);
  });

  it('serializes writes issued without awaiting', async () => {
    const screen = createVt();
    const writes = [screen.write('a'), screen.write('b'), screen.write('c')];
    await Promise.all(writes);
    expect(screen.revision).toBe(3);
    expect(captureRows(screen)[0]?.text).toBe('abc');
  });

  it('applies Unicode 11 widths', async () => {
    const screen = createVt();
    await screen.write('😀x');
    const snapshot = captureScreen(screen);
    expect(snapshot.cell(0, 0).char).toBe('😀');
    expect(snapshot.cell(0, 0).width).toBe(2);
    expect(snapshot.cell(0, 1).width).toBe(0);
    expect(snapshot.cell(0, 2).char).toBe('x');
  });

  it('consumes the render marker without touching the grid', async () => {
    const screen = createVt();
    const seen: MarkerSighting[] = [];
    screen.onMarker((marker) => seen.push(marker));

    await screen.write('before');
    await screen.write(`${encodeMarker('token', 'session', 3)}after`);

    expect(seen).toHaveLength(1);
    // The payload is handed on verbatim: what the handler receives must be
    // exactly what the verifier expects, with no reassembly in between.
    expect(verifyMarkerPayload(seen[0]?.payload ?? '', 'token', 'session')?.revision).toBe(3);
    expect(seen[0]?.screenRevision).toBe(2);
    expect(captureRows(screen)[0]?.text).toBe('beforeafter');
  });

  it('sights a marker terminated by ST as well as by BEL', async () => {
    // Adapters emit BEL, but the encoding permits either terminator and a
    // parser consumes it before dispatch — so both must reach the same place.
    const screen = createVt();
    const seen: MarkerSighting[] = [];
    screen.onMarker((marker) => seen.push(marker));

    const bel = encodeMarker('token', 'session', 5);
    await screen.write(`${bel.slice(0, -1)}\x1b\\tail`);

    expect(seen).toHaveLength(1);
    expect(verifyMarkerPayload(seen[0]?.payload ?? '', 'token', 'session')?.revision).toBe(5);
    expect(captureRows(screen)[0]?.text).toBe('tail');
  });

  it('sees a marker that follows a synchronized-output block', async () => {
    // Byte order adapters actually emit (verified against @termwright/ink):
    // BSU, the frame, ESU, and only then the render-commit marker.
    const screen = createVt();
    const seen: MarkerSighting[] = [];
    screen.onMarker((marker) => seen.push(marker));

    await screen.write(`\x1b[?2026hframe body\x1b[?2026l${encodeMarker('token', 'session', 11)}`);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.screenRevision).toBe(1);
    expect(captureRows(screen)[0]?.text).toBe('frame body');
    expect(screen.modes().synchronizedOutput).toBe(false);
  });

  it('reports unknown mouse modes where the platform hides them', () => {
    // ConPTY consumes the child's mouse DECSET, so 'none' would be a claim the
    // driver cannot make — and it is that claim that makes pointer actions
    // refuse. Driven by the option rather than the platform so the Windows
    // behaviour is covered on every machine that runs the suite.
    vt = new VtScreen({ columns: 40, rows: 6, scrollbackLines: 0, modesObservable: false });

    expect(vt.modes().mouseTracking).toBe('unknown');
    expect(vt.modes().mouseEncoding).toBe('unknown');
  });

  it('keeps modes unknown when a mode arrives that says nothing about the mouse', async () => {
    vt = new VtScreen({ columns: 40, rows: 6, scrollbackLines: 0, modesObservable: false });

    await vt.write('\x1b[?2004h');

    expect(vt.modes().bracketedPaste).toBe(true);
    expect(vt.modes().mouseTracking).toBe('unknown');
  });

  it('stays unknown even if a mouse mode does arrive', async () => {
    // Deliberate: one request getting through proves only that one did.
    // Promoting that to "the modes are observable" would report a partial view
    // as a complete one, and a partial view is what makes a driver refuse a
    // click the child would have understood.
    vt = new VtScreen({ columns: 40, rows: 6, scrollbackLines: 0, modesObservable: false });

    await vt.write('\x1b[?1000h\x1b[?1006h');

    expect(vt.modes().mouseTracking).toBe('unknown');
    expect(vt.modes().mouseEncoding).toBe('unknown');
  });

  it('tracks mouse encoding, which Terminal.modes does not report', async () => {
    const screen = createVt();
    expect(screen.modes().mouseEncoding).toBe('default');
    expect(screen.modes().mouseTracking).toBe('none');

    await screen.write('\x1b[?1002h\x1b[?1006h');
    expect(screen.modes().mouseTracking).toBe('drag');
    expect(screen.modes().mouseEncoding).toBe('sgr');

    await screen.write('\x1b[?1006l');
    expect(screen.modes().mouseEncoding).toBe('default');
  });

  it('tracks bracketed paste, application cursor keys and focus reporting', async () => {
    const screen = createVt();
    await screen.write('\x1b[?2004h\x1b[?1h\x1b[?1004h');
    const modes = screen.modes();
    expect(modes.bracketedPaste).toBe(true);
    expect(modes.applicationCursorKeys).toBe(true);
    expect(modes.focusReporting).toBe('on');
  });

  it('reports focus reporting as unknown where the reading belongs to the host', async () => {
    // ConPTY reports it enabled whether or not the child asked, so a definite
    // value there would describe the terminal and be read as the program.
    vt = new VtScreen({ columns: 40, rows: 6, scrollbackLines: 0, modesObservable: false });
    expect(vt.modes().focusReporting).toBe('unknown');

    await vt.write('\x1b[?1004h');
    expect(vt.modes().focusReporting).toBe('unknown');
  });

  it('separates a program that never asked from one whose answer is hidden', async () => {
    const screen = createVt();
    expect(screen.modes().focusReporting).toBe('off');
  });

  it('tracks cursor visibility and shape', async () => {
    const screen = createVt();
    expect(screen.cursor().visible).toBe(true);
    await screen.write('\x1b[?25l');
    expect(screen.cursor().visible).toBe(false);
    await screen.write('\x1b[?25h\x1b[4 q');
    expect(screen.cursor().visible).toBe(true);
    expect(screen.cursor().shape).toBe('underline');
  });

  it('reports the title set through OSC 0 and OSC 2', async () => {
    const screen = createVt();
    await screen.write('\x1b]0;first\x07');
    expect(screen.title).toBe('first');
    await screen.write('\x1b]2;second\x1b\\');
    expect(screen.title).toBe('second');
  });

  it('reports the active buffer', async () => {
    const screen = createVt();
    expect(captureScreen(screen).buffer).toBe('normal');
    await screen.write('\x1b[?1049h');
    expect(captureScreen(screen).buffer).toBe('alternate');
  });
});

describe('screen snapshots', () => {
  it('keeps describing the grid it was taken from', async () => {
    const screen = createVt();
    await screen.write('first');
    const snapshot = captureScreen(screen);
    await screen.write('\r\nsecond');
    expect(snapshot.line(0)).toBe('first');
    expect(snapshot.line(1)).toBe('');
    expect(snapshot.revision).toBe(1);
  });

  it('refuses to serialize a stale snapshot', async () => {
    const screen = createVt();
    await screen.write('first');
    const snapshot = captureScreen(screen);
    expect(snapshot.ansi()).toContain('first');
    await screen.write('!');
    expect(() => snapshot.ansi()).toThrowError(/stale|advanced/iu);
  });

  it('exposes colors and attributes per cell', async () => {
    const screen = createVt();
    await screen.write('\x1b[1;31mERROR\x1b[0m ok');
    const snapshot = captureScreen(screen);
    expect(snapshot.cell(0, 0).fg).toEqual({ kind: 'palette', index: 1 });
    expect(snapshot.cell(0, 0).attributes.bold).toBe(true);
    expect(snapshot.cell(0, 6).fg).toEqual({ kind: 'default' });
  });
});

describe('grid matching', () => {
  it('finds text and maps it back to cell coordinates', async () => {
    const screen = createVt();
    await screen.write('  Approve   Reject');
    const matches = matchGrid(captureRows(screen), {
      kind: 'generic',
      text: textMatcher('Reject'),
      description: 'test',
    });
    expect(matches).toEqual([{ row: 0, column: 12, width: 6, height: 1 }]);
  });

  it('accounts for wide characters when mapping columns', async () => {
    const screen = createVt();
    await screen.write('😀 tail');
    const matches = matchGrid(captureRows(screen), {
      kind: 'generic',
      text: textMatcher('tail'),
      description: 'test',
    });
    expect(matches[0]?.column).toBe(3);
  });

  it('filters by style predicates', async () => {
    const screen = createVt();
    await screen.write('\x1b[31mERROR\x1b[0m ERROR');
    const rows = captureRows(screen);
    const red = matchGrid(rows, {
      kind: 'generic',
      text: textMatcher('ERROR', true),
      style: { fg: 'red' },
      description: 'test',
    });
    expect(red).toHaveLength(1);
    expect(red[0]?.column).toBe(0);

    const all = matchGrid(rows, { kind: 'generic', text: textMatcher('ERROR', true), description: 'test' });
    expect(all).toHaveLength(2);
  });

  it('selects an occurrence', async () => {
    const screen = createVt();
    await screen.write('one two one');
    const second = matchGrid(captureRows(screen), {
      kind: 'generic',
      text: textMatcher('one', true),
      occurrence: 2,
      description: 'test',
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.column).toBe(8);
  });
});
