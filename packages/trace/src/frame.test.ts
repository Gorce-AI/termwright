import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { frameAt, frameFromAnsi } from './frame.js';
import { openTrace } from './reader.js';
import { createTraceWriter } from './writer.js';

const ESC = '\u001b';
const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'twtrace-frame-'));
  temporaries.push(dir);
  return dir;
}

describe('frameFromAnsi', () => {
  it('exposes the grid as driver-shaped cells', async () => {
    const frame = await frameFromAnsi('hi', { columns: 6, rows: 2 });
    expect(frame.columns).toBe(6);
    expect(frame.rows).toBe(2);
    expect(frame.cell(0, 0)).toMatchObject({ char: 'h', width: 1 });
    expect(frame.cell(0, 2)).toMatchObject({ char: ' ', width: 1 });
    expect(frame.text().split('\n')).toEqual(['hi', '']);
    expect(frame.line(0)).toBe('hi');
  });

  it('reports palette and rgb colours the way the driver does', async () => {
    const frame = await frameFromAnsi(`${ESC}[31mr${ESC}[38;2;18;52;86mx`, {
      columns: 4,
      rows: 1,
    });
    expect(frame.cell(0, 0).fg).toEqual({ kind: 'palette', index: 1 });
    expect(frame.cell(0, 1).fg).toEqual({ kind: 'rgb', r: 18, g: 52, b: 86 });
    expect(frame.cell(0, 0).bg).toEqual({ kind: 'default' });
  });

  it('reports attributes', async () => {
    const frame = await frameFromAnsi(`${ESC}[1;3;4;7;9;2mx`, { columns: 3, rows: 1 });
    expect(frame.cell(0, 0).attributes).toEqual({
      bold: true,
      dim: true,
      italic: true,
      underline: true,
      inverse: true,
      strikethrough: true,
    });
  });

  it('marks the continuation cell of a wide character', async () => {
    const frame = await frameFromAnsi('漢a', { columns: 6, rows: 1 });
    expect(frame.cell(0, 0)).toMatchObject({ char: '漢', width: 2 });
    expect(frame.cell(0, 1).width).toBe(0);
    expect(frame.cell(0, 2)).toMatchObject({ char: 'a', width: 1 });
  });

  it('returns a blank cell outside the grid instead of throwing', async () => {
    const frame = await frameFromAnsi('x', { columns: 2, rows: 1 });
    expect(frame.cell(9, 9)).toMatchObject({ char: ' ', width: 1 });
    expect(frame.line(9)).toBe('');
  });

  it('places the cursor where the emulator left it', async () => {
    const frame = await frameFromAnsi(`${ESC}[2;3H`, { columns: 10, rows: 3 });
    expect(frame.cursor).toMatchObject({ row: 1, column: 2, visible: true });
  });
});

describe('frameAt', () => {
  it('reconstructs the screen and the tree at a point on the cast timeline', async () => {
    const root = await workspace();
    const dir = join(root, 'frames.twtrace');
    const session = new FakeSession('sess-frame');
    const writer = createTraceWriter(session, {
      dir,
      columns: 12,
      rows: 2,
      now: session.now,
    });

    session.semantic(snapshot(1, [node({ id: 'n1', role: 'button', name: 'Run' })], 'sess-frame'));
    session.output('first');
    session.tick(1_000);
    session.output(`${ESC}[2J${ESC}[Hsecond`);
    session.semantic(
      snapshot(
        4,
        [node({ id: 'n1', role: 'button', name: 'Run', state: { disabled: true } })],
        'sess-frame',
      ),
    );
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      const early = await frameAt(trace, 0);
      expect(early.line(0)).toBe('first');
      expect(early.semanticRevision).toBe(1);
      expect(early.timeMs).toBe(0);

      const late = await frameAt(trace, 1_000);
      expect(late.line(0)).toBe('second');
      expect(late.semanticRevision).toBe(4);
      expect(late.columns).toBe(12);
      expect(late.rows).toBe(2);
    } finally {
      await trace.close();
    }
  });

  it('follows resizes recorded in the cast', async () => {
    const root = await workspace();
    const dir = join(root, 'resized.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, columns: 10, rows: 2, now: session.now });

    session.output('x');
    session.tick(100);
    session.resize(30, 4);
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      expect(await frameAt(trace, 0)).toMatchObject({ columns: 10, rows: 2 });
      expect(await frameAt(trace, 100)).toMatchObject({ columns: 30, rows: 4 });
    } finally {
      await trace.close();
    }
  });
});

describe('terminal profile', () => {
  it('measures emoji the way the live session does', async () => {
    // The bug this replaces: the driver activated Unicode 11 and the replay did
    // not, so a rocket was two columns live and one on replay.
    const frame = await frameFromAnsi('🚀a', { columns: 6, rows: 1 });
    expect(frame.cell(0, 0)).toMatchObject({ char: '🚀', width: 2 });
    expect(frame.cell(0, 1).width).toBe(0);
    expect(frame.cell(0, 2)).toMatchObject({ char: 'a', width: 1 });
  });

  it('honours a profile that widens ambiguous characters', async () => {
    const narrow = await frameFromAnsi('±a', { columns: 6, rows: 1 });
    const wide = await frameFromAnsi('±a', {
      columns: 6,
      rows: 1,
      profile: 'iterm2-ambiguous-wide',
    });
    expect(narrow.cell(0, 1)).toMatchObject({ char: 'a' });
    expect(wide.cell(0, 1).width).toBe(0);
    expect(wide.cell(0, 2)).toMatchObject({ char: 'a' });
  });

  it('rejects a recording asking for a profile this build lacks', async () => {
    await expect(
      frameFromAnsi('x', { columns: 4, rows: 1, profile: 'ghostty-2031' }),
    ).rejects.toThrow(/does not know/);
  });

  it('does not treat an inherited object key as a profile', async () => {
    // The profile is a string read off disk, so a prototype key must not
    // resolve to anything — `resolveProfileId` checks own properties.
    for (const hostile of ['__proto__', 'constructor', 'toString']) {
      await expect(frameFromAnsi('x', { columns: 4, rows: 1, profile: hostile })).rejects.toThrow(
        /does not know/,
      );
    }
  });

  it('replays with the profile stored in the archive', async () => {
    const root = await workspace();
    const dir = join(root, 'profile.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, {
      dir,
      columns: 8,
      rows: 1,
      now: session.now,
      terminalProfile: 'iterm2-ambiguous-wide',
    });
    session.output('±a');
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      expect(trace.meta.terminalProfile).toBe('iterm2-ambiguous-wide');
      const frame = await frameAt(trace, 0);
      // Ambiguous-wide: the sign takes two columns, so 'a' lands in column 2.
      expect(frame.cell(0, 2)).toMatchObject({ char: 'a' });
    } finally {
      await trace.close();
    }
  });

  it('replays an archive without a profile as default', async () => {
    const root = await workspace();
    const dir = join(root, 'noprofile.twtrace');
    const session = new FakeSession();
    const writer = createTraceWriter(session, { dir, columns: 8, rows: 1, now: session.now });
    session.output('±a');
    await writer.finalize();

    const trace = await openTrace(dir);
    try {
      expect(trace.meta.terminalProfile).toBeUndefined();
      expect((await frameAt(trace, 0)).cell(0, 1)).toMatchObject({ char: 'a' });
    } finally {
      await trace.close();
    }
  });
});
