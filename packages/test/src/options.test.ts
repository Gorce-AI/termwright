import { describe, expect, it } from 'vitest';
import { resolveTermwrightConfig } from './config.js';
import { mergeOptions } from './options.js';

const config = resolveTermwrightConfig(
  {
    columns: 100,
    rows: 30,
    command: ['node', 'app.js'],
    env: { TERM: 'xterm-256color', PROJECT: 'yes' },
    timeouts: { action: 5_000, expect: 5_000 },
    trace: 'retain-on-failure',
    failOnLogLevel: 'error',
  },
  {},
);

describe('mergeOptions', () => {
  it('takes the project configuration when nothing overrides it', () => {
    const merged = mergeOptions(config, {}, {});
    expect(merged.columns).toBe(100);
    expect(merged.command).toEqual(['node', 'app.js']);
    expect(merged.trace).toBe('retain-on-failure');
    expect(merged.failOnLogLevel).toBe('error');
  });

  it('scoping one option keeps every other one', () => {
    // The regression this exists for: `test.scoped` replaces the whole value,
    // so a suite that scopes only `trace` would lose the project's viewport
    // and environment if the scoped object were used as-is.
    const merged = mergeOptions(config, { trace: 'on' }, {}, { PATH: '/usr/bin' });
    expect(merged.trace).toBe('on');
    expect(merged.columns).toBe(100);
    expect(merged.rows).toBe(30);
    expect(merged.command).toEqual(['node', 'app.js']);
    expect(merged.env).toEqual({ PATH: '/usr/bin', TERM: 'xterm-256color', PROJECT: 'yes' });
    expect(merged.timeouts.action).toBe(5_000);
    expect(merged.failOnLogLevel).toBe('error');
  });

  it('applies the layers in order: config, then scope, then the call', () => {
    const merged = mergeOptions(config, { columns: 120, rows: 40 }, { columns: 200 });
    expect(merged.columns).toBe(200);
    expect(merged.rows).toBe(40);
  });

  it('merges env key by key across all three layers', () => {
    const merged = mergeOptions(
      config,
      { env: { PROJECT: 'scoped', SUITE: 'yes' } },
      { env: { CALL: 'yes' } },
      { PATH: '/usr/bin' },
    );
    expect(merged.env).toEqual({
      PATH: '/usr/bin',
      TERM: 'xterm-256color',
      PROJECT: 'scoped',
      SUITE: 'yes',
      CALL: 'yes',
    });
  });

  it('merges timeout classes key by key, keeping the ones nobody mentioned', () => {
    const merged = mergeOptions(config, { timeouts: { action: 1_000 } }, { timeouts: { text: 2_000 } });
    expect(merged.timeouts).toMatchObject({ action: 1_000, text: 2_000, idle: 2_000, exit: 10_000 });
  });

  it('never lets the expect class reach the driver', () => {
    const merged = mergeOptions(config, { timeouts: { expect: 999 } }, {});
    expect(merged.timeouts).not.toHaveProperty('expect');
  });

  it('replaces the command wholly rather than concatenating argv', () => {
    const merged = mergeOptions(config, { command: ['node', 'other.js'] }, {});
    expect(merged.command).toEqual(['node', 'other.js']);
    expect(mergeOptions(config, { command: ['a'] }, { command: ['b'] }).command).toEqual(['b']);
  });

  it('lets a suite turn the log threshold off', () => {
    expect(mergeOptions(config, { failOnLogLevel: false }, {}).failOnLogLevel).toBe(false);
    expect(mergeOptions(config, { failOnLogLevel: 'warn' }, {}).failOnLogLevel).toBe('warn');
  });

  it('ignores an explicit undefined instead of erasing the layer below', () => {
    // Types forbid this, JavaScript does not: options built dynamically end up
    // with explicit undefineds, and spreading one would erase the layer below.
    const scoped = { timeouts: { action: undefined } } as unknown as Parameters<typeof mergeOptions>[1];
    expect(mergeOptions(config, scoped, {}).timeouts.action).toBe(5_000);
  });
});
