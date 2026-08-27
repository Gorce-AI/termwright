/**
 * Which marker route survives `useThread=true`, and what it costs.
 *
 * OpenTUI writes its frames from a Zig thread, so appending to
 * `process.stdout` cannot place a marker after a frame the way it does under
 * Ink. Three routes come out of the Phase 0 audit; this measures them against
 * each other rather than reasoning about them.
 *
 * Arms:
 *  - `native`      — untouched: the renderer owns the real stdout.
 *  - `feed`        — a custom stdout, which makes OpenTUI allocate a
 *                    NativeSpanFeed and hand the bytes back to JS; we forward
 *                    them and append the marker ourselves.
 *  - `postprocess` — `addPostProcessFn`, which runs after the tree walk but
 *                    BEFORE the native render call.
 *
 * Results go to a file: the renderer captures stdout, so anything printed is
 * swallowed.
 *
 * Run: `bun bench-marker.ts <arm> <outfile> [ms]`
 */

import { writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { createCliRenderer, BoxRenderable, TextRenderable } from '@opentui/core';

const arm = (process.argv[2] ?? 'native') as
  'native' | 'feed' | 'feed-quiet' | 'postprocess' | 'postprocess-real';
const outFile = process.argv[3] ?? '/tmp/bench.json';
const windowMs = Number(process.argv[4] ?? 2000);

const MARKER = ']8487;twm;';

interface Sink extends Writable {
  bytes: number;
  markerAfterFrame: boolean | null;
  sawFrameBytes: boolean;
}

/** A stdout stand-in that records ordering between frame bytes and markers. */
function makeSink(): Sink {
  const sink = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      sink.bytes += text.length;
      if (text.includes(MARKER)) {
        // A marker is correctly placed only if frame bytes preceded it.
        if (sink.markerAfterFrame === null) sink.markerAfterFrame = sink.sawFrameBytes;
      } else if (text.length > 0) {
        sink.sawFrameBytes = true;
      }
      cb();
    },
  }) as Sink;
  sink.bytes = 0;
  sink.markerAfterFrame = null;
  sink.sawFrameBytes = false;
  (sink as unknown as { isTTY: boolean }).isTTY = true;
  (sink as unknown as { columns: number }).columns = 80;
  (sink as unknown as { rows: number }).rows = 24;
  return sink;
}

// `native` is the only arm that leaves the real stdout in place. Everything
// else takes a custom stdout, which is what allocates the NativeSpanFeed —
// so the feed's cost has to be separated from the marker's, hence `feed-quiet`.
const sink = arm === 'native' || arm === 'postprocess-real' ? undefined : makeSink();

const renderer = (await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 240,
  ...(sink === undefined ? {} : { stdout: sink as unknown as NodeJS.WriteStream }),
})) as unknown as {
  root: { add(child: unknown): unknown };
  on(event: string, handler: (payload: unknown) => void): void;
  start(): void;
  destroy(): void;
  addPostProcessFn(fn: (buffer: unknown, delta: number) => void): void;
  useThread: boolean;
};

let markerWrites = 0;

// A subscriber must exist before the loop starts: OpenTUI only emits `frame`
// when someone is listening (audit §4).
let frames = 0;
renderer.on('frame', () => {
  frames += 1;
});

if (arm === 'postprocess') {
  renderer.addPostProcessFn(() => {
    sink?.write(`${MARKER}${frames};mac`);
    markerWrites += 1;
  });
}

if (arm === 'postprocess-real') {
  // The decisive variant: the renderer keeps the REAL stdout, so frames leave
  // from the Zig thread while the marker is written from JS. Ordering cannot be
  // observed from inside the process — the captured stream is read back after.
  renderer.addPostProcessFn(() => {
    process.stdout.write(MARKER + String(frames) + ';mac');
    markerWrites += 1;
  });
}

const box = new BoxRenderable(renderer as never, { id: 'root-box', border: true });
const text = new TextRenderable(renderer as never, { id: 'label', content: 'benchmark' });
box.add(text);
renderer.root.add(box);

// A static tree writes nothing after its first paint — OpenTUI skips redundant
// native renders — so ordering could not be observed at all. Changing the text
// every frame is what makes each frame produce bytes to order against.
let tick = 0;
renderer.setFrameCallback(async () => {
  tick += 1;
  (text as unknown as { content: string }).content = `benchmark ${tick}`;
});

if (arm === 'feed') {
  // The bytes reach JS here, so ordering is ours to choose: frame first, then
  // the marker, exactly as under Ink.
  renderer.on('frame', () => {
    sink?.write(`${MARKER}${frames};mac`);
    markerWrites += 1;
  });
}

const started = performance.now();
renderer.start();

setTimeout(() => {
  const elapsed = performance.now() - started;
  renderer.destroy();
  writeFileSync(
    outFile,
    JSON.stringify({
      arm,
      useThread: renderer.useThread,
      elapsedMs: Math.round(elapsed),
      frames,
      fps: Math.round((frames / elapsed) * 1000),
      bytesSeenInJs: sink?.bytes ?? 0,
      markerWrites,
      markerAfterFrame: sink?.markerAfterFrame ?? null,
    }),
    'utf8',
  );
  process.exit(0);
}, windowMs);
