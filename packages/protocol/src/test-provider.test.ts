import { describe, expect, it } from 'vitest';
import {
  hasTermwrightProvider,
  termwrightProvider,
  termwrightProviderDeclaration,
  TERMWRIGHT_PROVIDER_VERSION,
} from './test-provider.js';

describe('test-provider metadata contract', () => {
  it('creates only a non-empty, versioned provider marker', () => {
    expect(termwrightProvider('@termwright/test')).toEqual({
      id: '@termwright/test',
      version: TERMWRIGHT_PROVIDER_VERSION,
    });
    expect(() => termwrightProvider('')).toThrow(/cannot be empty/u);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { termwright: null },
    { termwright: [] },
    { termwright: {} },
    { termwright: { provider: null } },
    { termwright: { provider: [] } },
    { termwright: { provider: { id: 'provider', version: 2 } } },
    { termwright: { provider: { id: '', version: TERMWRIGHT_PROVIDER_VERSION } } },
    { termwright: { provider: { id: 1, version: TERMWRIGHT_PROVIDER_VERSION } } },
  ])('rejects malformed provider metadata: %#', (meta) => {
    expect(hasTermwrightProvider(meta)).toBe(false);
  });

  it('accepts the exact structural marker without relying on object identity', () => {
    expect(
      hasTermwrightProvider({
        termwright: {
          provider: { id: 'custom-provider', version: TERMWRIGHT_PROVIDER_VERSION },
        },
      }),
    ).toBe(true);
  });

  it.each([
    undefined,
    { termwright: { provider: { id: 'provider', version: 2 } } },
    { termwright: { provider: termwrightProvider('provider') } },
    { termwright: { provider: termwrightProvider('provider'), declaration: null } },
    {
      termwright: {
        provider: termwrightProvider('provider'),
        declaration: { mode: 'later', exclusive: false },
      },
    },
    {
      termwright: {
        provider: termwrightProvider('provider'),
        declaration: { mode: 'run', exclusive: 'yes' },
      },
    },
  ])('rejects malformed declarations: %#', (meta) => {
    expect(termwrightProviderDeclaration(meta)).toBeUndefined();
  });

  it.each(['run', 'skip', 'todo'] as const)('reads the bounded %s declaration', (mode) => {
    expect(
      termwrightProviderDeclaration({
        termwright: {
          provider: termwrightProvider('provider'),
          declaration: { mode, exclusive: mode === 'run' },
        },
      }),
    ).toEqual({ mode, exclusive: mode === 'run' });
  });
});
