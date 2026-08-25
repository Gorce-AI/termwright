import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  certifyLocalMarkerFeed,
  createMarkerSink,
  MARKER_SINK_FEED_WRITE_SYMBOL,
} from './sink.js';

describe('OpenTUI local marker feed certification', () => {
  it('retains the native feed while restoring local stdout lifecycle semantics', () => {
    const target = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream, 'test-token');
    const renderer = { stdout: target, _feed: {}, _usesProcessStdout: true };

    certifyLocalMarkerFeed(renderer, sink, 'test-token');

    expect(renderer._feed).toEqual({});
    expect(renderer._usesProcessStdout).toBe(true);
  });

  it.each([
    ['different stdout', { stdout: new PassThrough(), _feed: {}, _usesProcessStdout: false }],
    ['missing feed', { stdout: undefined, _feed: null, _usesProcessStdout: false }],
    ['unexpected lifecycle mode', { stdout: undefined, _feed: {}, _usesProcessStdout: false }],
  ])('fails closed for %s', (_label, partial) => {
    const target = new PassThrough();
    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream, 'test-token');
    const renderer = { ...partial, stdout: partial.stdout ?? sink };

    expect(() => certifyLocalMarkerFeed(renderer, sink, 'test-token')).toThrow(/OpenTUI/);
  });

  it('serializes native-feed bytes and markers through one target queue', async () => {
    const seen: string[] = [];
    const pending: Array<() => void> = [];
    const target = new Writable({
      write(chunk, _encoding, callback) {
        seen.push(chunk.toString('utf8'));
        pending.push(callback);
      },
    });
    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream, 'test-token');

    sink[MARKER_SINK_FEED_WRITE_SYMBOL](Buffer.from('FRAME'), () => undefined);
    sink.writeMarker('MARKER');

    expect(seen).toEqual(['FRAME']);
    pending.shift()?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(seen).toEqual(['FRAME', 'MARKER']);
    pending.shift()?.();
  });

  it('observes failures from construction onward and releases the target listener after queued use', async () => {
    const target = new PassThrough();
    const baseline = target.listenerCount('error');
    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream, 'test-token');
    const seen: Error[] = [];
    sink.onFailure((error) => seen.push(error));

    expect(target.listenerCount('error')).toBe(baseline + 1);
    const failure = new Error('constructor setup failed');
    expect(() => target.emit('error', failure)).not.toThrow();
    expect(seen).toEqual([failure]);

    sink.releaseAfterUse();
    sink.releaseAfterUse();
    await new Promise<void>((resolve) => sink.writableFinished ? resolve() : sink.once('finish', resolve));
    expect(target.listenerCount('error')).toBe(baseline);
  });

  it('shares one target error guard across concurrent renderer sinks', async () => {
    const target = new PassThrough();
    const baseline = target.listenerCount('error');
    const first = createMarkerSink(target as unknown as NodeJS.WriteStream, 'first');
    const second = createMarkerSink(target as unknown as NodeJS.WriteStream, 'second');

    expect(target.listenerCount('error')).toBe(baseline + 1);
    first.releaseAfterUse();
    await new Promise<void>((resolve) => first.once('finish', resolve));
    expect(target.listenerCount('error')).toBe(baseline + 1);
    second.releaseAfterUse();
    await new Promise<void>((resolve) => second.once('finish', resolve));
    expect(target.listenerCount('error')).toBe(baseline);
  });

  it('releases the shared target guard after a failed sink closes', async () => {
    const target = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('target write failed'));
      },
    });
    const baseline = target.listenerCount('error');
    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream, 'test-token');
    sink.onFailure(() => undefined);
    const closed = new Promise<void>((resolve) => sink.once('close', resolve));

    sink.write('FRAME');
    await closed;

    expect(target.listenerCount('error')).toBe(baseline);
  });

  it('fails an active sink when its output target closes without an error', async () => {
    const target = new PassThrough();
    const baseline = target.listenerCount('error');
    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream, 'test-token');
    const failures: Error[] = [];
    sink.onFailure((error) => failures.push(error));
    const closed = new Promise<void>((resolve) => target.once('close', resolve));

    target.destroy();
    await closed;

    expect(failures.map((error) => error.message)).toEqual([
      'OpenTUI output target closed before renderer release',
    ]);
    expect(target.listenerCount('error')).toBe(baseline);
  });

  it('does not report target close after the renderer released its sink', async () => {
    const target = new PassThrough();
    const sink = createMarkerSink(target as unknown as NodeJS.WriteStream, 'test-token');
    const failures: Error[] = [];
    sink.onFailure((error) => failures.push(error));
    sink.releaseAfterUse();
    await new Promise<void>((resolve) => sink.once('finish', resolve));

    const closed = new Promise<void>((resolve) => target.once('close', resolve));
    target.destroy();
    await closed;

    expect(failures).toEqual([]);
  });
});
