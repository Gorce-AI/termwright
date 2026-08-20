import { describe, expect, it } from 'vitest';
import { ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import { withProbe } from './launch.js';
import { isInstrumented } from './runtime.js';
import {
  buildShimSource,
  originalUrl,
  shouldShim,
  ORIGINAL_MARKER,
} from './shim.js';

describe('Ink shim', () => {
  const entry = '/repo/node_modules/ink/build/index.js';

  it('matches ordinary and Bun-cache Ink entries only', () => {
    expect(shouldShim(entry)).toBe(true);
    expect(shouldShim('/cache/ink@7.1.1@@@1/build/index.js')).toBe(true);
    expect(shouldShim('/repo/node_modules/blink/build/index.js')).toBe(false);
    expect(shouldShim('/repo/node_modules/ink/build/render.js')).toBe(false);
  });

  it('does not intercept its own re-import', () => {
    expect(originalUrl(entry)).toContain(ORIGINAL_MARKER);
    expect(shouldShim(originalUrl(entry))).toBe(false);
  });

  it('forwards every export and shadows only render', () => {
    const source = buildShimSource(entry, 'file:///probe/instrument.js');
    expect(source).toContain('export * from');
    expect(source).toContain('export const render');
    expect(source).toContain('wrapInkRender');
    expect(source).toContain('file:///probe/instrument.js');
  });
});

describe('launcher and dormant rule', () => {
  it.each(['node', 'bun'] as const)('uses a file URL for %s', (runtime) => {
    const { command } = withProbe(runtime, [runtime, 'app.mjs']);
    const flag = runtime === 'node' ? '--import' : '--preload';
    const index = command.indexOf(flag);
    expect(index).toBeGreaterThan(0);
    expect(command[index + 1]).toMatch(/^file:\/\//u);
    expect(command.at(-1)).toBe('app.mjs');
  });

  it('rejects an empty application command', () => {
    expect(() => withProbe('node', [])).toThrowError();
  });

  it('requires both endpoint and token', () => {
    expect(isInstrumented({})).toBe(false);
    expect(isInstrumented({ [ENV_ENDPOINT]: '/tmp/s.sock' })).toBe(false);
    expect(isInstrumented({ [ENV_TOKEN]: 'token' })).toBe(false);
    expect(isInstrumented({ [ENV_ENDPOINT]: '/tmp/s.sock', [ENV_TOKEN]: 'token' })).toBe(true);
  });
});
