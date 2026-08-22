import { describe, expect, it } from 'vitest';
import { ResourceScope } from './resource-scope.js';

describe('ResourceScope', () => {
  it('owns each acquisition immediately and disposes in reverse order', async () => {
    const events: string[] = [];
    const scope = new ResourceScope('test scope');

    await scope.acquire('first', async () => {
      events.push('acquire first');
      return 'first';
    }, async (value) => {
      events.push(`dispose ${value}`);
    });
    await scope.acquire('second', () => {
      events.push('acquire second');
      return 'second';
    }, (value) => {
      events.push(`dispose ${value}`);
    });

    await scope.close();
    expect(events).toEqual([
      'acquire first',
      'acquire second',
      'dispose second',
      'dispose first',
    ]);
    expect(scope.state).toBe('closed');
  });

  it('shares close, attempts every disposer, and aggregates cleanup failures', async () => {
    const disposed: string[] = [];
    const scope = new ResourceScope('failing scope');
    scope.defer('first', () => {
      disposed.push('first');
      throw new Error('first failed');
    });
    scope.defer('second', async () => {
      disposed.push('second');
      throw new Error('second failed');
    });
    scope.defer('third', () => {
      disposed.push('third');
    });

    const first = scope.close();
    const second = scope.close();
    expect(second).toBe(first);
    await expect(first).rejects.toMatchObject({
      name: 'ResourceCleanupError',
      failedResources: ['second', 'first'],
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'failed to dispose second' }),
        expect.objectContaining({ message: 'failed to dispose first' }),
      ]),
    });
    expect(disposed).toEqual(['third', 'second', 'first']);
    expect(scope.state).toBe('closed');
  });

  it('disposes a value whose asynchronous acquisition loses a race with close', async () => {
    let publish!: (value: object) => void;
    const acquired = new Promise<object>((resolve) => {
      publish = resolve;
    });
    const disposed: object[] = [];
    const scope = new ResourceScope('racing scope');

    const pending = scope.acquire('late', () => acquired, (value) => {
      disposed.push(value);
    });
    const closing = scope.close();
    const value = {};
    publish(value);

    await expect(pending).rejects.toThrow(/began closing/u);
    await closing;
    expect(disposed).toEqual([value]);
  });
});
