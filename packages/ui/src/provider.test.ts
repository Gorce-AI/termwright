import { describe, expect, it } from 'vitest';
import {
  hasTermwrightProvider,
  termwrightProvider,
  termwrightProviderDeclaration,
  TERMWRIGHT_PROVIDER_VERSION,
} from './provider.js';

describe('the Termwright provider marker', () => {
  it('recognises the explicit versioned envelope', () => {
    expect(
      hasTermwrightProvider({
        termwright: { provider: termwrightProvider('@termwright/test') },
      }),
    ).toBe(true);
  });

  it.each([
    undefined,
    {},
    { termwright: {} },
    { termwright: { traces: ['out.twtrace'] } },
    { termwright: { provider: '@termwright/test' } },
    { termwright: { provider: { id: '', version: TERMWRIGHT_PROVIDER_VERSION } } },
    { termwright: { provider: { id: '@termwright/test', version: 2 } } },
  ])('rejects foreign or malformed metadata %#', (meta) => {
    expect(hasTermwrightProvider(meta)).toBe(false);
  });

  it('reads a bounded declaration and rejects an unknown mode', () => {
    const provider = termwrightProvider('@termwright/test');
    expect(
      termwrightProviderDeclaration({
        termwright: { provider, declaration: { mode: 'skip', exclusive: false } },
      }),
    ).toEqual({ mode: 'skip', exclusive: false });
    expect(
      termwrightProviderDeclaration({
        termwright: { provider, declaration: { mode: 'queued', exclusive: false } },
      }),
    ).toBeUndefined();
  });
});
