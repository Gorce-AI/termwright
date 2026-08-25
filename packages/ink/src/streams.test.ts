/**
 * The wires, on their own: the line discipline and the tty surface Ink expects
 * to find. Both are the sort of detail whose absence shows up much later, as a
 * component that "renders wrong" or an app that throws on `setRawMode`.
 */

import { describe, expect, it } from 'vitest';
import { applyOnlcr, createHarnessStdin, createHarnessStdout } from './streams.js';

const decoder = new TextDecoder();

describe('applyOnlcr', () => {
  it('turns every newline into a carriage return plus newline', () => {
    expect(decoder.decode(applyOnlcr(new TextEncoder().encode('a\nb\n')))).toBe('a\r\nb\r\n');
  });

  it('leaves data without newlines untouched, by identity', () => {
    const data = new TextEncoder().encode('[?1049h');
    expect(applyOnlcr(data)).toBe(data);
  });

  it('translates unconditionally, exactly as the kernel does', () => {
    // `ONLCR` does not look at what precedes the newline; a doubled carriage
    // return is a move to column zero twice, which is no move at all.
    expect(decoder.decode(applyOnlcr(new TextEncoder().encode('a\r\n')))).toBe('a\r\r\n');
  });
});

describe('createHarnessStdout', () => {
  it('looks like a tty of the requested size', () => {
    const stdout = createHarnessStdout(40, 12, () => undefined);

    expect(stdout.isTTY).toBe(true);
    expect(stdout.columns).toBe(40);
    expect(stdout.rows).toBe(12);
  });

  it('hands every chunk on, in write order', () => {
    const seen: string[] = [];
    const stdout = createHarnessStdout(40, 12, (data) => seen.push(decoder.decode(data)));

    stdout.write('first');
    stdout.write('second');

    expect(seen).toEqual(['first', 'second']);
  });

  it('invokes the flush callback for a zero-length write', async () => {
    // Ink probes the stream this way to learn when a frame has been written;
    // a callback that never fires hangs the render, and the adapter's marker
    // with it.
    const seen: string[] = [];
    const stdout = createHarnessStdout(40, 12, (data) => seen.push(decoder.decode(data)));

    await new Promise<void>((resolve) => stdout.write('', () => resolve()));

    expect(seen).toEqual([]);
  });

  it('reports a resize the way a tty does', () => {
    const stdout = createHarnessStdout(40, 12, () => undefined);
    let resized = 0;
    stdout.on('resize', () => {
      resized += 1;
    });

    stdout.setSize(80, 24);

    expect(resized).toBe(1);
    expect(stdout.columns).toBe(80);
    expect(stdout.rows).toBe(24);
  });
});

describe('createHarnessStdin', () => {
  it('supports raw mode and reads in paused mode', () => {
    const stdin = createHarnessStdin();
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);

    expect(stdin.isTTY).toBe(true);
    expect(stdin.isRaw).toBe(true);

    stdin.deliver(new TextEncoder().encode('hi'));

    expect(stdin.read()).toBe('hi');
  });

  it('ignores input delivered after the stream finished', () => {
    const stdin = createHarnessStdin();
    stdin.finish();

    expect(() => stdin.deliver(new TextEncoder().encode('late'))).not.toThrow();
  });
});
