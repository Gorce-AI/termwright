import { describe, expect, it } from 'vitest';
import { ENV_ENDPOINT, ENV_PROTOCOL, ENV_TOKEN } from '@termwright/protocol';
import { readAdapterEnv } from './config.js';

const complete = {
  [ENV_ENDPOINT]: '/tmp/tw.sock',
  [ENV_TOKEN]: 'tok',
};

describe('readAdapterEnv', () => {
  it('resolves a complete environment', () => {
    expect(readAdapterEnv(complete)).toEqual({ endpoint: '/tmp/tw.sock', token: 'tok' });
  });

  it('stays dormant without an endpoint or a token', () => {
    expect(readAdapterEnv({})).toBeNull();
    expect(readAdapterEnv({ [ENV_ENDPOINT]: '/tmp/tw.sock' })).toBeNull();
    expect(readAdapterEnv({ [ENV_TOKEN]: 'tok' })).toBeNull();
  });

  it('treats empty values as absent', () => {
    expect(readAdapterEnv({ ...complete, [ENV_ENDPOINT]: '' })).toBeNull();
    expect(readAdapterEnv({ ...complete, [ENV_TOKEN]: '' })).toBeNull();
  });

  it('fails closed on a protocol version it does not speak', () => {
    expect(readAdapterEnv({ ...complete, [ENV_PROTOCOL]: '1' })).not.toBeNull();
    expect(readAdapterEnv({ ...complete, [ENV_PROTOCOL]: '2' })).toBeNull();
    expect(readAdapterEnv({ ...complete, [ENV_PROTOCOL]: 'nonsense' })).toBeNull();
  });
});
