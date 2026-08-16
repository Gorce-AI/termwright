import { channel } from 'node:diagnostics_channel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, validateLogRecord, type LogRecord } from '@termwright/protocol';
import {
  LOG_CHANNEL_NAME,
  hasLogSubscribers,
  publishLog,
  resetLogSequence,
  subscribeToLogs,
} from './channel.js';

const cleanup: Array<() => void> = [];

function collect(options?: Parameters<typeof subscribeToLogs>[1]): LogRecord[] {
  const records: LogRecord[] = [];
  const stop = subscribeToLogs((record) => records.push(record), options);
  cleanup.push(stop);
  return records;
}

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
  resetLogSequence();
});

describe('zero cost without a subscriber', () => {
  it('reports no subscribers and publishes nothing', () => {
    expect(hasLogSubscribers()).toBe(false);
    expect(publishLog({ level: 'info', message: 'nobody home' })).toBe(false);
  });

  it('never invokes the thunk when nobody is listening', () => {
    const build = vi.fn(() => ({ level: 'info' as const, message: 'expensive' }));
    expect(publishLog(build)).toBe(false);
    expect(build).not.toHaveBeenCalled();

    collect();
    expect(publishLog(build)).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('does not even read the input object when nobody is listening', () => {
    let read = false;
    const input = {
      level: 'info' as const,
      get message(): string {
        read = true;
        return 'x';
      },
    };
    expect(publishLog(input)).toBe(false);
    expect(read).toBe(false);
  });

  it('stops publishing again once the last subscriber leaves', () => {
    const stop = subscribeToLogs(() => {});
    expect(hasLogSubscribers()).toBe(true);
    stop();
    expect(hasLogSubscribers()).toBe(false);
    expect(publishLog({ message: 'after' })).toBe(false);
  });

  it('tolerates unsubscribing twice', () => {
    const stop = subscribeToLogs(() => {});
    stop();
    expect(() => stop()).not.toThrow();
  });
});

describe('publish and subscribe', () => {
  it('delivers a normalized, protocol-valid record', () => {
    const records = collect();
    publishLog({ level: 'warn', message: 'disk almost full', logger: 'storage' });

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.level).toBe('warn');
    expect(record.message).toBe('disk almost full');
    expect(record.logger).toBe('storage');
    expect(validateLogRecord(record, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('assigns monotonically increasing sequence numbers', () => {
    const records = collect();
    publishLog({ message: 'one' });
    publishLog({ message: 'two' });
    publishLog({ message: 'three' });

    expect(records.map((r) => r.seq)).toEqual([0, 1, 2]);
  });

  it('preserves the publisher sequence rather than renumbering on receive', () => {
    const records = collect();
    publishLog({ message: 'a' });
    publishLog({ message: 'b' });
    // A gap must mean "records were dropped upstream", so the receive side
    // must not invent its own numbering.
    expect(records.map((r) => r.seq)).toEqual([0, 1]);
  });

  it('reaches every subscriber', () => {
    const first = collect();
    const second = collect();
    publishLog({ message: 'broadcast' });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('isolates a throwing handler from the publisher', () => {
    const errors: unknown[] = [];
    const stop = subscribeToLogs(
      () => {
        throw new Error('handler blew up');
      },
      { onError: (error) => errors.push(error) },
    );
    cleanup.push(stop);
    const good = collect();

    expect(() => publishLog({ message: 'still delivered' })).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(good).toHaveLength(1);
  });
});

describe('the channel is a public contract', () => {
  it('accepts a raw publish from code that never imported termwright', () => {
    const records = collect();
    // Exactly what an application would write, with no dependency on us.
    channel(LOG_CHANNEL_NAME).publish({ level: 'error', message: 'payment failed' });

    expect(records).toHaveLength(1);
    expect(records[0]!.level).toBe('error');
    expect(records[0]!.message).toBe('payment failed');
  });

  it('normalizes a foreign shape rather than rejecting it', () => {
    const records = collect();
    channel(LOG_CHANNEL_NAME).publish({ msg: 'pino style', level: 50, name: 'http' });

    expect(records[0]!.level).toBe('error');
    expect(records[0]!.message).toBe('pino style');
    expect(records[0]!.logger).toBe('http');
  });

  it('redacts a secret published directly by a third party', () => {
    const records = collect();
    channel(LOG_CHANNEL_NAME).publish({
      message: 'auth header Bearer abcdef1234567890abcdef',
      attrs: { password: 'hunter2' },
    });

    expect(records[0]!.message).not.toContain('abcdef1234567890');
    expect(records[0]!.attrs?.['password']).toBe('[redacted]');
  });

  it('routes unusable messages to onInvalid instead of the handler', () => {
    const invalid: string[] = [];
    const records = collect({ onInvalid: (detail) => invalid.push(detail) });
    channel(LOG_CHANNEL_NAME).publish('just a string');
    channel(LOG_CHANNEL_NAME).publish(42);

    expect(records).toHaveLength(0);
    expect(invalid).toHaveLength(2);
  });

  it('survives a hostile publish without throwing into the publisher', () => {
    const records = collect({ onInvalid: () => {} });
    const cyclic: Record<string, unknown> = { message: 'loop' };
    cyclic['self'] = cyclic;

    expect(() => channel(LOG_CHANNEL_NAME).publish(cyclic)).not.toThrow();
    expect(records.every((r) => validateLogRecord(r, DEFAULT_LIMITS).ok)).toBe(true);
  });
});
