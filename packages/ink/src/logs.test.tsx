import { Box, Text, type Instance } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasLogSubscribers, publishLog, resetLogSequence } from '@termwright/logs';
import { DEFAULT_LIMITS, type LogRecord } from '@termwright/protocol';
import { semanticRender } from './index.js';
import { captureConsole, startLogForwarder } from './logs.js';
import { startFakeDriver, type FakeDriver, type FakeDriverOptions } from './testing/fake-driver.js';
import { createFakeStdout } from './testing/fake-stdout.js';

const GENEROUS: FakeDriverOptions['logs'] = {
  enabled: true,
  maxRecordsPerSecond: 1_000,
  burst: 1_000,
};

function App(): React.ReactNode {
  return (
    <Box>
      <Text>ready</Text>
    </Box>
  );
}

describe('application logs', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];

  afterEach(async () => {
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
    resetLogSequence();
  });

  async function launch(
    options: { readonly logs?: FakeDriverOptions['logs']; readonly captureConsole?: boolean } = {},
  ): Promise<{ driver: FakeDriver; app: Instance }> {
    const driver = await startFakeDriver({
      ...(options.logs === undefined ? {} : { logs: options.logs }),
    });
    openDrivers.push(driver);
    const app = semanticRender(<App />, {
      stdout: createFakeStdout(),
      interactive: true,
      alternateScreen: true,
      patchConsole: false,
      semantics: {
        env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
        ...(options.captureConsole === undefined ? {} : { captureConsole: options.captureConsole }),
      },
    });
    openApps.push(app);
    await driver.waitForSnapshots(1);
    return { driver, app };
  }

  describe('dormant rule', () => {
    it('subscribes to nothing without instrumentation env', () => {
      const app = semanticRender(<App />, {
        stdout: createFakeStdout(),
        interactive: true,
        patchConsole: false,
        semantics: { env: {} },
      });
      openApps.push(app);

      expect(hasLogSubscribers()).toBe(false);
      expect(publishLog({ level: 'error', message: 'nobody home' })).toBe(false);
    });

    it('leaves console untouched in a dormant process', () => {
      const before = console.error;
      const app = semanticRender(<App />, {
        stdout: createFakeStdout(),
        interactive: true,
        patchConsole: false,
        semantics: { env: {} },
      });
      openApps.push(app);

      expect(console.error).toBe(before);
    });
  });

  describe('negotiation', () => {
    it('announces the logs capability under instrumentation', async () => {
      const { driver } = await launch({ logs: GENEROUS });
      expect((await driver.waitForHandshake()).capabilities).toContain('logs');
    });

    it('sends nothing when the driver did not enable the channel', async () => {
      const { driver } = await launch();

      publishLog({ level: 'error', message: 'should not travel' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(driver.logs).toHaveLength(0);
      expect(hasLogSubscribers()).toBe(false);
    });

    it('sends nothing when the driver disabled the channel explicitly', async () => {
      const { driver } = await launch({
        logs: { enabled: false, maxRecordsPerSecond: 100, burst: 10 },
      });

      publishLog({ level: 'error', message: 'still should not travel' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(driver.logs).toHaveLength(0);
    });
  });

  describe('forwarding', () => {
    it('carries a record end to end, through protocol validation', async () => {
      const { driver } = await launch({ logs: GENEROUS });

      publishLog({
        level: 'error',
        message: 'payment failed',
        logger: 'billing',
        attrs: { orderId: 42, retried: true },
      });
      const [record] = await driver.waitForLogs(1);

      expect(record?.level).toBe('error');
      expect(record?.message).toBe('payment failed');
      expect(record?.logger).toBe('billing');
      expect(record?.attrs).toEqual({ orderId: 42, retried: true });
      expect(record?.ts).toBeGreaterThan(0);
    });

    it('stamps the revision that was on screen', async () => {
      const { driver } = await launch({ logs: GENEROUS });

      publishLog({ level: 'info', message: 'after first frame' });
      const [record] = await driver.waitForLogs(1);

      expect(record?.revision).toBeGreaterThan(0);
    });

    it('keeps a revision the publisher set itself', async () => {
      const { driver } = await launch({ logs: GENEROUS });

      publishLog({ level: 'info', message: 'from the past', revision: 1 });
      const [record] = await driver.waitForLogs(1);

      expect(record?.revision).toBe(1);
    });

    it('keeps rendering when the channel dies mid-log', async () => {
      const { driver, app } = await launch({ logs: GENEROUS });
      driver.cutConnection();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(() => publishLog({ level: 'error', message: 'into the void' })).not.toThrow();
      expect(() => app.rerender(<App />)).not.toThrow();
    });
  });

  describe('rate limit', () => {
    it('drops over budget and leaves the gap in seq', async () => {
      const driver = await startFakeDriver({
        logs: { enabled: true, maxRecordsPerSecond: 20, burst: 3 },
      });
      openDrivers.push(driver);
      const app = semanticRender(<App />, {
        stdout: createFakeStdout(),
        interactive: true,
        patchConsole: false,
        semantics: {
          env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
          captureConsole: false,
        },
      });
      openApps.push(app);
      await driver.waitForSnapshots(1);

      for (let index = 0; index < 10; index += 1) {
        publishLog({ level: 'info', message: `record ${index}` });
      }
      await driver.waitForLogs(3);
      expect(driver.logs).toHaveLength(3);

      // Let the bucket refill, then publish once more. Only now can the driver
      // see the gap: a trailing drop is invisible until a later record lands.
      await new Promise((resolve) => setTimeout(resolve, 120));
      publishLog({ level: 'info', message: 'after the storm' });
      const records = await driver.waitForLogs(4);

      const seqs = records.map((record) => record.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

      const span = (seqs.at(-1) as number) - (seqs[0] as number) + 1;
      const missing = span - seqs.length;
      expect(missing).toBe(7);
      expect(missing).toBe(seqs.at(-1) as number - 3);
    });

    it('refills over time', () => {
      let clock = 0;
      const sent: LogRecord[] = [];
      const forwarder = startLogForwarder({
        channel: {
          isOpen: true,
          sendLog: (record: LogRecord) => sent.push(record),
        } as never,
        budget: { maxRecordsPerSecond: 10, burst: 2 },
        limits: DEFAULT_LIMITS,
        currentRevision: () => 0,
        now: () => clock,
      });
      expect(forwarder).not.toBeNull();

      for (let index = 0; index < 5; index += 1) {
        publishLog({ level: 'info', message: `burst ${index}` });
      }
      expect(sent).toHaveLength(2);
      expect(forwarder?.dropped).toBe(3);

      clock = 1_000; // one second buys ten more tokens, capped at the burst
      publishLog({ level: 'info', message: 'later' });
      expect(sent).toHaveLength(3);

      forwarder?.dispose();
    });

    it('refuses to subscribe on a budget it cannot honour', () => {
      const forwarder = startLogForwarder({
        channel: { isOpen: true, sendLog: () => undefined } as never,
        budget: { maxRecordsPerSecond: 0, burst: 0 },
        limits: DEFAULT_LIMITS,
        currentRevision: () => 0,
      });

      expect(forwarder).toBeNull();
      expect(hasLogSubscribers()).toBe(false);
    });
  });

  describe('console capture', () => {
    it('turns console calls into records with the right level', async () => {
      const { driver } = await launch({ logs: GENEROUS });

      console.error('boom %s', 'now');
      console.warn('careful');
      console.log('plain');

      const records = await driver.waitForLogs(3);
      expect(records.map((record) => record.level)).toEqual(['error', 'warn', 'info']);
      expect(records[0]?.message).toBe('boom now');
      expect(records.every((record) => record.logger === 'console')).toBe(true);
    });

    it('still calls through to the original console', () => {
      const error = vi.fn();
      const target = { error, warn: vi.fn(), log: vi.fn() } as unknown as Console;
      const restore = captureConsole(target);

      target.error('hello %s', 'world');

      expect(error).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith('hello %s', 'world');
      restore();
    });

    it('restores the methods it replaced', () => {
      const original = vi.fn();
      const target = { error: original, warn: vi.fn(), log: vi.fn() } as unknown as Console;

      const restore = captureConsole(target);
      expect(target.error).not.toBe(original);

      restore();
      expect(target.error).toBe(original);
      restore(); // idempotent
      expect(target.error).toBe(original);
    });

    it('can be turned off', async () => {
      const { driver } = await launch({ logs: GENEROUS, captureConsole: false });

      console.error('not captured');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(driver.logs).toHaveLength(0);
    });
  });
});
