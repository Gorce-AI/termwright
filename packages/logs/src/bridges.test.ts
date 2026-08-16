/**
 * Bridge tests run against the REAL logger libraries, not doubles.
 *
 * A double proves only that the bridge agrees with our reading of the docs;
 * these prove it agrees with what the library actually emits, which is the
 * thing that breaks on a major version bump.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, validateLogRecord, type LogRecord } from '@termwright/protocol';
import { resetLogSequence, subscribeToLogs } from './channel.js';
import { termwrightDestination } from './pino.js';
import { createWinstonTransport } from './winston.js';
import { termwrightReporter } from './consola.js';
import { TermwrightLogRecordProcessor, severityToLevel } from './otel.js';

const cleanup: Array<() => void> = [];

function collect(): LogRecord[] {
  const records: LogRecord[] = [];
  cleanup.push(subscribeToLogs((record) => records.push(record)));
  return records;
}

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
  resetLogSequence();
});

describe('pino bridge', () => {
  it('captures records from a real pino logger', async () => {
    const { default: pino } = await import('pino');
    const records = collect();

    const logger = pino({ level: 'trace' }, termwrightDestination());
    logger.info({ requestId: 'r-1' }, 'request handled');
    logger.error('boom');
    logger.trace('noisy');

    expect(records).toHaveLength(3);
    expect(records[0]!.level).toBe('info');
    expect(records[0]!.message).toBe('request handled');
    expect(records[0]!.attrs?.['requestId']).toBe('r-1');
    expect(records[1]!.level).toBe('error');
    expect(records[2]!.level).toBe('trace');
    expect(records.every((r) => validateLogRecord(r, DEFAULT_LIMITS).ok)).toBe(true);
  });

  it('carries a pino child logger name through as the logger', async () => {
    const { default: pino } = await import('pino');
    const records = collect();

    const logger = pino({ level: 'info' }, termwrightDestination());
    logger.child({ name: 'db' }).warn('slow query');

    expect(records[0]!.logger).toBe('db');
    expect(records[0]!.level).toBe('warn');
  });

  it('uses pino own timestamp rather than the receive time', async () => {
    const { default: pino } = await import('pino');
    const records = collect();
    const before = Date.now();

    pino({ level: 'info' }, termwrightDestination()).info('timed');

    expect(records[0]!.ts).toBeGreaterThanOrEqual(before - 1000);
    expect(records[0]!.ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('can drop pid/hostname bindings', async () => {
    const { default: pino } = await import('pino');
    const records = collect();

    pino({ level: 'info' }, termwrightDestination({ includeProcessBindings: false })).info('x');

    expect(records[0]!.attrs?.['pid']).toBeUndefined();
    expect(records[0]!.attrs?.['hostname']).toBeUndefined();
  });

  it('redacts a secret logged through pino', async () => {
    const { default: pino } = await import('pino');
    const records = collect();

    pino({ level: 'info' }, termwrightDestination()).info(
      { authorization: 'Bearer abcdef1234567890abcdef' },
      'calling upstream',
    );

    expect(records[0]!.attrs?.['authorization']).toBe('[redacted]');
  });

  it('survives a line that is not pino NDJSON', () => {
    const unparsable: string[] = [];
    const records = collect();
    const destination = termwrightDestination({ onUnparsable: (line) => unparsable.push(line) });

    destination.write('not json\n');
    destination.write('{"level":30,"msg":"fine"}\n');

    expect(unparsable).toEqual(['not json']);
    expect(records).toHaveLength(1);
  });

  it('handles several records arriving in one chunk', () => {
    const records = collect();
    termwrightDestination().write('{"level":30,"msg":"a"}\n{"level":40,"msg":"b"}\n');
    expect(records.map((r) => r.message)).toEqual(['a', 'b']);
  });
});

describe('winston bridge', () => {
  it('captures records from a real winston logger', async () => {
    const winston = (await import('winston')).default;
    const records = collect();

    const logger = winston.createLogger({
      level: 'silly',
      transports: [createWinstonTransport()],
    });
    logger.info('server started', { port: 8080 });
    logger.warn('cache miss');
    logger.silly('very verbose');

    await delay(20);

    expect(records.length).toBeGreaterThanOrEqual(3);
    const started = records.find((r) => r.message === 'server started');
    expect(started?.level).toBe('info');
    expect(started?.attrs?.['port']).toBe(8080);
    expect(records.find((r) => r.message === 'cache miss')?.level).toBe('warn');
    // winston's 'silly' has no protocol equivalent and maps onto trace.
    expect(records.find((r) => r.message === 'very verbose')?.level).toBe('trace');
    expect(records.every((r) => validateLogRecord(r, DEFAULT_LIMITS).ok)).toBe(true);
  });

  it('redacts a secret logged through winston', async () => {
    const winston = (await import('winston')).default;
    const records = collect();

    winston
      .createLogger({ level: 'info', transports: [createWinstonTransport()] })
      .info('login', { password: 'hunter2' });

    await delay(20);
    expect(records[0]!.attrs?.['password']).toBe('[redacted]');
  });

  it('exposes the level winston filters on', () => {
    const transport = createWinstonTransport({ level: 'warn' });
    expect((transport as unknown as { level: string }).level).toBe('warn');
  });
});

describe('consola bridge', () => {
  it('captures records from a real consola instance', async () => {
    const { createConsola } = await import('consola');
    const records = collect();

    // Only our reporter, so the suite does not print to stdout.
    const logger = createConsola({ level: 5, reporters: [termwrightReporter()] });
    logger.info('starting up');
    logger.warn('deprecated flag');
    logger.error('request failed');
    logger.debug('internal state');

    expect(records.map((r) => r.level)).toEqual(['info', 'warn', 'error', 'debug']);
    expect(records[0]!.message).toBe('starting up');
    expect(records.every((r) => validateLogRecord(r, DEFAULT_LIMITS).ok)).toBe(true);
  });

  it('maps consola-specific types onto the protocol ladder', async () => {
    const { createConsola } = await import('consola');
    const records = collect();

    const logger = createConsola({ level: 5, reporters: [termwrightReporter()] });
    logger.success('done');
    logger.fail('nope');
    logger.ready('listening');

    expect(records.map((r) => r.level)).toEqual(['info', 'error', 'info']);
  });

  it('carries a consola tag through as the logger', async () => {
    const { createConsola } = await import('consola');
    const records = collect();

    createConsola({ level: 5, reporters: [termwrightReporter()] })
      .withTag('worker')
      .info('tagged');

    expect(records[0]!.logger).toBe('worker');
  });

  it('keeps extra consola arguments as context', async () => {
    const { createConsola } = await import('consola');
    const records = collect();

    createConsola({ level: 5, reporters: [termwrightReporter()] }).info('with context', {
      attempt: 2,
    });

    expect(records[0]!.message).toBe('with context');
    expect(String(records[0]!.attrs?.['args'])).toContain('attempt');
  });
});

describe('OpenTelemetry bridge', () => {
  it('maps every OTel severity range onto the protocol ladder', () => {
    expect(severityToLevel(1)).toBe('trace');
    expect(severityToLevel(5)).toBe('debug');
    expect(severityToLevel(9)).toBe('info');
    expect(severityToLevel(13)).toBe('warn');
    expect(severityToLevel(17)).toBe('error');
    expect(severityToLevel(21)).toBe('fatal');
    expect(severityToLevel(undefined, 'WARNING')).toBe('warn');
    expect(severityToLevel(undefined, undefined)).toBe('info');
  });

  it('captures records emitted through a real LoggerProvider', async () => {
    const { LoggerProvider } = await import('@opentelemetry/sdk-logs');
    const { SeverityNumber } = await import('@opentelemetry/api-logs');
    const records = collect();

    const provider = new LoggerProvider({
      processors: [new TermwrightLogRecordProcessor()],
    });
    const logger = provider.getLogger('checkout');
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      body: 'payment declined',
      attributes: { orderId: 'o-99' },
    });

    await provider.shutdown();

    expect(records).toHaveLength(1);
    expect(records[0]!.level).toBe('error');
    expect(records[0]!.message).toBe('payment declined');
    expect(records[0]!.attrs?.['orderId']).toBe('o-99');
    expect(records[0]!.logger).toBe('checkout');
    expect(validateLogRecord(records[0]!, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('stops accepting records after shutdown', async () => {
    const records = collect();
    const processor = new TermwrightLogRecordProcessor();

    await processor.shutdown();
    processor.onEmit({ body: 'after shutdown', severityNumber: 9 });

    expect(records).toHaveLength(0);
  });

  it('has nothing to flush', async () => {
    await expect(new TermwrightLogRecordProcessor().forceFlush()).resolves.toBeUndefined();
  });
});
