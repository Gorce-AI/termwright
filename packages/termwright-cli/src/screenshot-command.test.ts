import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createTraceWriter } from '@termwright/trace';
import type { SessionEventMap, SessionEventRecord, SessionEvents } from '@termwright/driver';
import type { PngOptions, ScreenFrame, ScreenshotPng } from '@termwright/screenshot';
import { captureScreenshot, checkRequest } from './screenshot-command.js';

type Listener = (payload: never) => void;

const renderPngMock = vi.hoisted(() =>
  vi.fn<(frame: ScreenFrame, options?: PngOptions) => ScreenshotPng>(),
);

vi.mock('@termwright/screenshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@termwright/screenshot')>();
  renderPngMock.mockImplementation(actual.renderPng);
  return { ...actual, renderPng: renderPngMock };
});

/** The smallest thing the trace writer will record: output, a step, an exit. */
class Recorded {
  readonly sessionId = 'shot-session';
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
  readonly #journalListeners = new Set<(record: SessionEventRecord) => void>();
  readonly #journal: SessionEventRecord[] = [];
  #sequence = 0;
  clock = 0;

  readonly now = (): number => this.clock;

  readonly events: SessionEvents = {
    on: <E extends keyof SessionEventMap>(
      event: E,
      callback: (payload: SessionEventMap[E]) => void,
    ): (() => void) => {
      const set = this.#listeners.get(event) ?? new Set<Listener>();
      set.add(callback as Listener);
      this.#listeners.set(event, set);
      return () => {
        set.delete(callback as Listener);
      };
    },
    checkpoint: () => this.#sequence,
    subscribe: (options, callback) => {
      for (const record of this.#journal) {
        if (record.sequence >= options.fromSequence) callback(record);
      }
      this.#journalListeners.add(callback);
      return () => this.#journalListeners.delete(callback);
    },
  };

  semanticTree(): null {
    return null;
  }

  emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    const record = { sequence: ++this.#sequence, type: event, payload } as SessionEventRecord;
    this.#journal.push(record);
    for (const listener of this.#journalListeners) listener(record);
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (value: SessionEventMap[E]) => void)(payload);
    }
  }
}

/** Writes a real archive, so this exercises the format rather than a stand-in. */
async function buildTrace(text = 'first screen'): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'tw-shot-')), 'login.twtrace');
  const session = new Recorded();
  const writer = createTraceWriter(session, {
    dir,
    command: ['node', 'agent.js'],
    columns: 40,
    rows: 8,
    now: session.now,
  });

  session.emit('output', { data: new TextEncoder().encode(`${text}\r\n`), timeMs: 0 });
  session.clock = 1_000;
  const step = writer.addStep('approve');
  session.emit('output', { data: new TextEncoder().encode('second screen\r\n'), timeMs: 1_000 });
  session.clock = 1_500;
  step.end('passed');
  session.clock = 2_000;
  session.emit('exit', { code: 0, signal: null, timeMs: 2_000 });
  await writer.finalize();
  return dir;
}

describe('the request, before anything is read', () => {
  it('refuses two ways of naming one moment', () => {
    expect(() => checkRequest({ trace: 't', atMs: 10, step: 1 })).toThrow(/pass one/);
  });

  it('refuses a step number that is not one', () => {
    // Steps are listed from 1, so `--step 0` is a misread list, not the first.
    expect(() => checkRequest({ trace: 't', step: 0 })).toThrow(/from 1/);
    expect(() => checkRequest({ trace: 't', step: 1.5 })).toThrow(/from 1/);
  });

  it('refuses a scale that would render nothing', () => {
    expect(() => checkRequest({ trace: 't', scale: 0 })).toThrow(/positive number/);
    expect(() => checkRequest({ trace: 't', scale: Number.NaN })).toThrow(/positive number/);
  });

  it('accepts a request that names one moment, or none', () => {
    expect(() => checkRequest({ trace: 't' })).not.toThrow();
    expect(() => checkRequest({ trace: 't', atMs: 0 })).not.toThrow();
    expect(() => checkRequest({ trace: 't', step: 2, scale: 2 })).not.toThrow();
  });
});

describe('capturing a moment of a recording', () => {
  it('writes a PNG of the screen at the time asked for', async () => {
    const out = join(await mkdtemp(join(tmpdir(), 'tw-out-')), 'shot.png');
    const result = await captureScreenshot({ trace: await buildTrace(), atMs: 500, out });

    expect(result.path).toBe(out);
    expect(result.chosen).toBe('the moment given');
    // The screen is rebuilt as of the last event at or before the request, so
    // the moment reported is that one — never a time nothing was recorded at.
    expect(result.timeMs).toBeLessThanOrEqual(500);
    expect(result.width).toBeGreaterThan(0);
    // Plain ASCII is covered by the embedded glyphs, so this render neither
    // paid for the font scan nor depends on the fonts of the machine it ran on.
    expect(result.systemFontsLoaded).toBe(false);
    expect(result.fallbackCharacters).toEqual([]);

    const bytes = await readFile(out);
    // PNG signature: proof the file is an image, not an empty write.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.byteLength).toBe(result.bytes);
  });

  it('scales the image without changing what it shows', async () => {
    const trace = await buildTrace();
    const one = await captureScreenshot({
      trace,
      atMs: 0,
      out: join(await mkdtemp(join(tmpdir(), 'tw-1-')), 'a.png'),
    });
    const two = await captureScreenshot({
      trace,
      atMs: 0,
      scale: 2,
      out: join(await mkdtemp(join(tmpdir(), 'tw-2-')), 'b.png'),
    });
    // Not exactly double: the SVG width is fractional and the rasteriser
    // rounds to whole pixels, so this pins the scaling, not the arithmetic.
    expect(two.width).toBeGreaterThan(one.width * 1.9);
    expect(two.width).toBeLessThan(one.width * 2.1);
  });

  it('captures the end of the step named', async () => {
    const out = join(await mkdtemp(join(tmpdir(), 'tw-step-')), 'step.png');
    const result = await captureScreenshot({ trace: await buildTrace(), step: 1, out });
    expect(result.chosen).toBe('the step given');
    expect(result.timeMs).toBeGreaterThan(0);
  });

  it('says which step numbers exist instead of guessing a nearby one', async () => {
    // A neighbouring step is a picture of something else, so this stops.
    await expect(
      captureScreenshot({ trace: await buildTrace(), step: 9, out: 'unused.png' }),
    ).rejects.toThrow(/it has 1 step/);
  });

  it('falls back to the last step when no moment is named', async () => {
    const out = join(await mkdtemp(join(tmpdir(), 'tw-def-')), 'default.png');
    const result = await captureScreenshot({ trace: await buildTrace(), out });
    // Not the last byte of the recording: a program that left the alternate
    // screen ends on a blank one, and a screenshot of nothing helps nobody.
    expect(result.chosen).toBe('the last step');
  });

  it('reports the renderer fallback without repeating its system-font scan', async () => {
    const fallback = '\u{F0000}';
    let receivedFallbackFrame = false;
    renderPngMock.mockImplementationOnce((frame, options) => {
      receivedFallbackFrame = Array.from({ length: frame.rows }, (_, row) =>
        Array.from({ length: frame.columns }, (_, column) => frame.cell(row, column).char),
      )
        .flat()
        .includes(fallback);
      expect(options).toEqual({ scale: 1 });
      return {
        png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        width: 320,
        height: 128,
        selfContained: false,
        fallbackCharacters: [fallback],
        systemFontsLoaded: true,
      };
    });

    // Font discovery and coverage belong to @termwright/screenshot and are
    // integration-tested there. This command owns reconstruction and honest
    // propagation of the renderer's result, so its test uses that boundary
    // instead of making every CLI run enumerate a host-dependent font set.
    const out = join(await mkdtemp(join(tmpdir(), 'tw-pua-')), 'pua.png');
    const result = await captureScreenshot({
      trace: await buildTrace(`gap ${fallback} here`),
      out,
    });

    expect(receivedFallbackFrame).toBe(true);
    expect(result.fallbackCharacters).toEqual([fallback]);
    expect(result.systemFontsLoaded).toBe(true);
  });

  it('names the archive it could not read', async () => {
    await expect(captureScreenshot({ trace: '/nowhere.twtrace' })).rejects.toThrow(/nowhere/);
  });
});
