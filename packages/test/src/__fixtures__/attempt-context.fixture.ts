import { appendFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, test as base } from 'vitest';
import { currentAttemptContext } from '../attempt-context.js';
import { test as termwrightTest } from '../fixtures.js';

const configuredOutput = process.env['TERMWRIGHT_ATTEMPT_CONTEXT_OUTPUT'];
if (configuredOutput === undefined) throw new Error('TERMWRIGHT_ATTEMPT_CONTEXT_OUTPUT is required');
const output: string = configuredOutput;

function record(phase: string, label: string): void {
  appendFileSync(output, `${JSON.stringify({ phase, label, ...currentAttemptContext() })}\n`, 'utf8');
}

const test = base.extend<{ witness: void }>({
  witness: [async ({ task }, use) => {
    const label = task.name === 'repeat and retry' ? 'repeat-retry' : task.name;
    record('fixture-before', label);
    try {
      await use();
    } finally {
      record('fixture-cleanup', label);
    }
  }, { auto: true }],
});

beforeEach(({ task }) => {
  record('before-each', task.name === 'repeat and retry' ? 'repeat-retry' : task.name);
});

afterEach(({ task }) => {
  record('after-each', task.name === 'repeat and retry' ? 'repeat-retry' : task.name);
});

test.concurrent('duplicate title', async () => {
  await Promise.resolve();
  record('callback', 'duplicate-a');
});

test.concurrent('duplicate title', async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  record('callback', 'duplicate-b');
});

describe('native repeat/retry', { repeats: 1, retry: 1 }, () => {
  test('repeat and retry', ({ onTestFinished }) => {
    const context = currentAttemptContext();
    record('callback', 'repeat-retry');
    onTestFinished(() => record('on-finished', 'repeat-retry'));
    if (context.retry === 0) throw new Error(`force retry for repeat ${context.repeat}`);
  });
});

termwrightTest('brokered terminal', async ({ terminal, step }) => {
  const app = await terminal.launch({
    command: [process.execPath, '-e', 'process.stdin.setRawMode?.(true);process.stdout.write("brokered\\n");process.stdin.once("data",()=>process.exit(0));process.stdin.resume()'],
    trace: 'off',
  });
  await app.waitForText('brokered');
  await step('finish brokered terminal', async () => app.press('Enter'));
  record('callback', 'brokered-terminal');
});

const hostile = base.extend<{ cleanupBomb: void }>({
  cleanupBomb: [async ({ task }, use) => {
    await use();
    record('hostile-fixture-cleanup', task.name);
    throw new Error('hostile fixture cleanup');
  }, { auto: true }],
});

hostile.fails('hostile cleanup and completion hooks', ({ onTestFinished, onTestFailed }) => {
  onTestFinished(() => {
    record('hostile-user-finished', 'hostile');
    throw new Error('hostile onTestFinished');
  });
  onTestFailed(() => {
    record('hostile-user-failed', 'hostile');
    throw new Error('hostile onTestFailed');
  });
  record('callback', 'hostile');
});

base.fails('only onTestFinished fails', ({ onTestFinished }) => {
  onTestFinished(() => {
    record('only-user-finished-failed', 'only-finished');
    throw new Error('sole failure from onTestFinished');
  });
  record('callback', 'only-finished');
});

base('runtime skip', ({ skip }) => {
  record('callback', 'runtime-skip');
  skip('authoritative runtime skip');
});
