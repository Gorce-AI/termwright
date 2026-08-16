import { describe, expect, it } from 'vitest';
import type { AppLogEvent } from '@termwright/driver';
import { LogBuffer, renderLogs } from './logs.js';

function line(text: string, timeMs = 0): AppLogEvent {
  return { source: 'file', label: 'app.log', line: text, timeMs };
}

function record(message: string, level: 'info' | 'error', timeMs = 0): AppLogEvent {
  return {
    source: 'adapter',
    timeMs,
    record: { ts: 1_700_000_000_000 + timeMs, level, message, seq: timeMs, logger: 'http' },
  };
}

describe('the log buffer', () => {
  it('hands back everything after a cursor, and a cursor to resume from', () => {
    const buffer = new LogBuffer();
    buffer.append(line('first'));
    buffer.append(line('second'));

    const all = buffer.since(0);
    expect(all.entries.map((entry) => entry.message)).toEqual(['first', 'second']);
    expect(all.omitted).toBe(0);
    expect(all.cursor).toBe(2);

    buffer.append(line('third'));
    const rest = buffer.since(all.cursor);
    expect(rest.entries.map((entry) => entry.message)).toEqual(['third']);
    expect(rest.cursor).toBe(3);
  });

  it('counts what fell out of the buffer, computed when the read happens', () => {
    const buffer = new LogBuffer(2);
    for (const text of ['a', 'b', 'c', 'd']) buffer.append(line(text));

    // Reading from the very beginning: 'a' and 'b' were evicted.
    const window = buffer.since(0);
    expect(window.entries.map((entry) => entry.message)).toEqual(['c', 'd']);
    expect(window.omitted).toBe(2);
  });

  it('reports the final window of drops even when nothing arrives afterwards', () => {
    const buffer = new LogBuffer(2);
    for (const text of ['a', 'b', 'c']) buffer.append(line(text));

    // A counter published "with the next event" would report zero here, because
    // there is no next event — a program that went quiet is exactly the case
    // where the number matters.
    expect(buffer.since(0).omitted).toBe(1);
    expect(buffer.since(0).omitted).toBe(1);
  });

  it('trims an oversized window and counts the trim as omitted', () => {
    const buffer = new LogBuffer();
    for (let index = 0; index < 10; index += 1) buffer.append(line(`line ${index}`));

    const window = buffer.since(0, 4);
    expect(window.entries).toHaveLength(4);
    // Newest kept: an agent chasing a failure wants the end, not the start.
    expect(window.entries[3]?.message).toBe('line 9');
    expect(window.omitted).toBe(6);
  });

  it('keeps a structured record’s level, logger and message', () => {
    const buffer = new LogBuffer();
    buffer.append(record('pool exhausted', 'error', 120));
    const entry = buffer.since(0).entries[0];
    expect(entry?.level).toBe('error');
    expect(entry?.logger).toBe('http');
    expect(entry?.message).toBe('pool exhausted');
    expect(entry?.source).toBe('adapter');
  });

  it('bounds a pathological line rather than passing it through', () => {
    const buffer = new LogBuffer();
    buffer.append(line('x'.repeat(10_000)));
    expect((buffer.since(0).entries[0]?.message ?? '').length).toBeLessThan(2_100);
  });
});

describe('rendering logs', () => {
  it('says so plainly when there is nothing', () => {
    expect(renderLogs(new LogBuffer().since(0))).toBe('logs: none');
  });

  it('flags omissions where an agent will read them', () => {
    const buffer = new LogBuffer(1);
    buffer.append(line('gone'));
    buffer.append(line('kept', 5));
    const text = renderLogs(buffer.since(0));
    expect(text).toContain('1 omitted');
    expect(text).toContain('5ms');
    expect(text).toContain('kept');
  });

  it('shows level and logger for structured records', () => {
    const buffer = new LogBuffer();
    buffer.append(record('boom', 'error', 7));
    expect(renderLogs(buffer.since(0))).toContain('7ms ERROR http: boom');
  });
});
