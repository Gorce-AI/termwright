import { describe, expect, it } from 'vitest';
import { readAdapterEnv } from './config.js';

describe('readAdapterEnv', () => {
  const complete = {
    TERMWRIGHT_ENDPOINT: '/tmp/tw.sock',
    TERMWRIGHT_TOKEN: 'secret',
    TERMWRIGHT_PROTOCOL: '1',
  };

  it('resolves a complete environment', () => {
    expect(readAdapterEnv(complete)).toEqual({ endpoint: '/tmp/tw.sock', token: 'secret' });
  });

  it('treats the protocol variable as optional', () => {
    const { TERMWRIGHT_PROTOCOL: _ignored, ...withoutVersion } = complete;
    expect(readAdapterEnv(withoutVersion)).not.toBeNull();
  });

  it.each([
    ['nothing set', {}],
    ['endpoint only', { TERMWRIGHT_ENDPOINT: '/tmp/tw.sock' }],
    ['token only', { TERMWRIGHT_TOKEN: 'secret' }],
    ['empty endpoint', { ...complete, TERMWRIGHT_ENDPOINT: '' }],
    ['empty token', { ...complete, TERMWRIGHT_TOKEN: '' }],
    ['future protocol', { ...complete, TERMWRIGHT_PROTOCOL: '2' }],
    ['nonsense protocol', { ...complete, TERMWRIGHT_PROTOCOL: 'yes' }],
  ])('stays dormant with %s', (_name, env) => {
    expect(readAdapterEnv(env)).toBeNull();
  });
});
