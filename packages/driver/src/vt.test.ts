import { afterEach, describe, expect, it } from 'vitest';
import { encodeMarker, verifyMarkerPayload } from '@termwright/protocol';
import { captureScreen, captureRows } from './screen.js';
import { matchGrid } from './matching.js';
import { textMatcher } from './selectors.js';
import { VtScreen, type MarkerSighting, type TerminalResponse } from './vt.js';

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
  it('answers DSR and deterministic colour queries without painting query bytes', async () => {
    const screen = createVt();
    const responses: TerminalResponse[] = [];
    screen.onResponse((response) => responses.push(response));

    await screen.write('\x1b[3;7H\x1b[6n\x1b]11;?\x1b\\');

    expect(responses).toEqual([
      { data: '\x1b[3;7R', kind: 'emulator' },
      { data: '\x1b]11;rgb:0000/0000/0000\x1b\\', kind: 'background-color' },
    ]);
    expect(captureRows(screen).every((row) => row.text === '')).toBe(true);
    expect(screen.cursor()).toMatchObject({ row: 2, column: 6 });
  });

  it('answers an addressed ConPTY host cursor request at its parser position', async () => {
    const screen = createVt();
    const responses: TerminalResponse[] = [];
    screen.onResponse((response) => responses.push(response));
    const token = '0123456789abcdef0123456789abcdef';

    await screen.write(`\x1b[3;7H\x1b]8488;twh-cpr-v1:q:${token}\x07after`);

    expect(responses).toEqual([
      {
        data: `\x1b]8488;twh-cpr-v1:r:${token}:3:7\x07`,
        kind: 'conpty-host-cursor',
      },
    ]);
    expect(captureRows(screen)[2]?.text).toBe('      after');
  });

  it('does not claim application-owned payloads that share OSC 8488', async () => {
    const screen = createVt();
    const responses: TerminalResponse[] = [];
    screen.onResponse((response) => responses.push(response));

    await screen.write('\x1b]8488;termwright-tview-fixture-sync:1:end\x07after');

    expect(responses).toEqual([]);
    expect(captureRows(screen)[0]?.text).toBe('after');
  });

  it('increments a revision per observable state change, not per transport chunk', async () => {
    const screen = createVt();
    expect(screen.revision).toBe(0);
    await screen.write('hello');
    expect(screen.revision).toBe(1);
    await screen.write(' world');
    expect(screen.revision).toBe(2);
    await screen.write('\x1b]11;?\x1b\\');
    expect(screen.revision).toBe(2);
  });

  it('serializes writes issued without awaiting', async () => {
    const screen = createVt();
    const writes = [screen.write('a'), screen.write('b'), screen.write('c')];
    await Promise.all(writes);
    expect(screen.revision).toBe(3);
    expect(captureRows(screen)[0]?.text).toBe('abc');
  });

  it('reports parser backlog synchronously for the complete queued write lifecycle', async () => {
    const screen = createVt();
    expect(screen.hasPendingWrite).toBe(false);
    expect(screen.isCaughtUp).toBe(true);

    const first = screen.write('a');
    const second = screen.write('b');
    expect(screen.hasPendingWrite).toBe(true);
    expect(screen.isCaughtUp).toBe(false);

    await first;
    expect(screen.hasPendingWrite).toBe(true);
    expect(screen.isCaughtUp).toBe(false);

    await second;
    expect(screen.hasPendingWrite).toBe(false);
    expect(screen.isCaughtUp).toBe(true);
  });

  it('tracks target-local damage independently from an animating status row', async () => {
    const screen = createVt(20, 6);
    await screen.write('\x1b[1;1HTARGET\x1b[6;1Hspin 0');
    const targetRevision = screen.revision;

    await screen.write('\x1b[6;1Hspin 1');
    expect(screen.regionUnchangedSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(true);
    expect(screen.regionUnchangedSince(targetRevision, [{ row: 5, from: 0, to: 6 }])).toBe(false);

    await screen.write('\x1b[1;1HCHANGED');
    expect(screen.regionUnchangedSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(false);
  });

  it('tells a recoloured region apart from one whose characters moved', async () => {
    const screen = createVt(20, 6);
    await screen.write('\x1b[1;1HTARGET');
    const targetRevision = screen.revision;

    // Same characters, different colour: a repaint or a focus highlight. The
    // region is not identical, and nothing a pointer aims at has moved.
    await screen.write('\x1b[1;1H\x1b[31mTARGET\x1b[m');
    expect(screen.regionChangeSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(
      'styling-changed',
    );

    await screen.write('\x1b[1;1HTARGEX');
    expect(screen.regionChangeSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(
      'glyphs-changed',
    );
  });

  it('reports an untouched region as unchanged whatever happened elsewhere', async () => {
    const screen = createVt(20, 6);
    await screen.write('\x1b[1;1HTARGET\x1b[6;1Hspin 0');
    const targetRevision = screen.revision;
    await screen.write('\x1b[6;1H\x1b[33mspin 1\x1b[m');
    expect(screen.regionChangeSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(
      'unchanged',
    );
  });

  it('names a coordinate move rather than blaming the region for it', async () => {
    const screen = createVt(20, 3);
    await screen.write('\x1b[1;1HTARGET');
    const targetRevision = screen.revision;
    // Scrolling moves every row, so no region's coordinates still mean what
    // they did. That is a different failure from the target changing, and a
    // caller that conflates them looks for the fault in the wrong place.
    await screen.write('\r\n\r\n\r\n\r\npushed');
    expect(screen.regionChangeSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(
      'coordinate-system-moved',
    );
  });

  it('keeps target-local proof across more status revisions than the former bounded history', async () => {
    const screen = createVt(20, 6);
    await screen.write('\x1b[1;1HTARGET');
    const targetRevision = screen.revision;

    for (let index = 0; index < 300; index += 1) {
      await screen.write(`\x1b[6;1Hspin ${String(index).padStart(3, '0')}`);
    }

    expect(screen.revision).toBeGreaterThan(targetRevision + 256);
    expect(screen.regionUnchangedSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(true);
    expect(screen.regionUnchangedSince(targetRevision, [{ row: 5, from: 0, to: 8 }])).toBe(false);
  });

  it('fails target-local stability closed across a coordinate-system change', async () => {
    const screen = createVt(20, 6);
    await screen.write('TARGET');
    const targetRevision = screen.revision;
    await screen.write('\x1b[?1049h');
    expect(screen.regionUnchangedSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(false);
  });

  it('publishes resize as a global coordinate-system revision without waiting for output', async () => {
    const screen = createVt(20, 6);
    await screen.write('TARGET');
    const targetRevision = screen.revision;

    screen.resize(10, 5);

    expect(screen.revision).toBe(targetRevision + 1);
    expect(screen.regionUnchangedSince(targetRevision, [{ row: 0, from: 0, to: 6 }])).toBe(false);
    expect(screen.regionUnchangedSince(screen.revision, [{ row: 0, from: 0, to: 6 }])).toBe(true);
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
    expect(seen[0]?.screenRevision).toBe(1);
    expect(screen.revision).toBe(2);
    expect(captureRows(screen)[0]?.text).toBe('beforeafter');
  });

  it('binds a marker-only transport chunk to the last observable screen revision', async () => {
    const screen = createVt();
    const seen: MarkerSighting[] = [];
    screen.onMarker((marker) => seen.push(marker));

    await screen.write('frame');
    await screen.write(encodeMarker('token', 'session', 4));

    expect(screen.revision).toBe(1);
    expect(seen).toEqual([expect.objectContaining({ screenRevision: 1 })]);
  });

  it('treats a marker in the middle of one transport chunk as an exact observation boundary', async () => {
    const screen = createVt();
    const seen: MarkerSighting[] = [];
    screen.onMarker((marker) => seen.push(marker));

    await screen.write(`\x1b[1;1HTARGET${encodeMarker('token', 'session', 4)}\x1b[1;1HCHANGED`);

    expect(screen.revision).toBe(2);
    expect(seen).toEqual([expect.objectContaining({ screenRevision: 1 })]);
    expect(screen.regionUnchangedSince(1, [{ row: 0, from: 0, to: 6 }])).toBe(false);
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
    // Byte order framework probes actually emit (verified against the Ink probe):
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
    // An embedding declared modes unobservable, so 'none' would be a claim the
    // driver cannot make. Certified PTY backends observe DECSET by default.
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
    // An embedding declared this reading unobservable, so a definite value
    // would describe its host rather than the program.
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

    const all = matchGrid(rows, {
      kind: 'generic',
      text: textMatcher('ERROR', true),
      description: 'test',
    });
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

describe('hyperlinks on the grid', () => {
  it('carries an OSC 8 link through to the cell snapshot', async () => {
    const screen = createVt();
    await screen.write('\x1b]8;id=save;https://example.com/save\x1b\\Go\x1b]8;;\x1b\\!');

    const row = captureRows(screen)[0];
    expect(row?.text).toBe('Go!');
    expect(row?.cells[0]?.link).toEqual({ uri: 'https://example.com/save', id: 'save' });
    expect(row?.cells[1]?.link?.uri).toBe('https://example.com/save');
    // The '!' is outside the link: a closer means closed.
    expect(row?.cells[2]?.link).toBeUndefined();
  });

  it('says so when a URI was cut rather than presenting a shorter address', async () => {
    // A truncated URI is a wrong URI. An assertion comparing against one has
    // to be able to tell that from a link that simply is that short.
    const screen = createVt();
    const long = `https://example.com/${'x'.repeat(20_000)}`;
    await screen.write(`\x1b]8;;${long}\x1b\\L\x1b]8;;\x1b\\`);

    const link = captureRows(screen)[0]?.cells[0]?.link;
    expect(link?.truncated).toBe(true);
    expect(link?.uri.length).toBeLessThan(long.length);
    expect(long.startsWith(link?.uri ?? '')).toBe(true);
  });

  it('leaves ordinary cells without a link field at all', async () => {
    const screen = createVt();
    await screen.write('plain');
    expect(captureRows(screen)[0]?.cells[0]).not.toHaveProperty('link');
  });
});
