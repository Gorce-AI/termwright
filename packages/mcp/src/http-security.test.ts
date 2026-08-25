import { describe, expect, it } from 'vitest';
import {
  BoundedRateLimiter,
  isLoopbackHost,
  normalizeAllowedOrigins,
} from './http-security.js';

describe('bounded HTTP rate limiting', () => {
  it('never grows past the configured identity ceiling', () => {
    const limiter = new BoundedRateLimiter({ maxClients: 2, maxRequests: 10, windowMs: 1_000 });
    expect(limiter.admit('client-a', 0).allowed).toBe(true);
    expect(limiter.admit('client-b', 0).allowed).toBe(true);
    expect(limiter.admit('client-c', 0)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.size).toBe(2);
  });

  it('purges expired identities before admitting a newcomer', () => {
    const limiter = new BoundedRateLimiter({ maxClients: 1, maxRequests: 10, windowMs: 1_000 });
    expect(limiter.admit('old-client', 0).allowed).toBe(true);
    expect(limiter.admit('new-client', 1_000).allowed).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it('rejects invalid or unbounded configurations', () => {
    expect(() => new BoundedRateLimiter({ maxClients: 0 })).toThrow(/positive safe integer/u);
    expect(() => new BoundedRateLimiter({ maxRequests: Number.POSITIVE_INFINITY })).toThrow(/positive safe integer/u);
    expect(() => new BoundedRateLimiter({ windowMs: -1 })).toThrow(/positive safe integer/u);
  });
});

describe('HTTP bind and Origin policy', () => {
  it('recognizes explicit loopback hosts without treating wildcard binds as local', () => {
    for (const host of ['localhost', '127.0.0.1', '127.99.1.2', '::1', '[::1]', '::ffff:127.0.0.1']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'example.test', 'localhost.example']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it('canonicalizes exact HTTP origins and rejects URL-like overreach', () => {
    expect([...normalizeAllowedOrigins(['HTTPS://Agent.Example:443'])]).toEqual(['https://agent.example']);
    for (const invalid of [
      'not a URL',
      'file:///tmp/agent',
      'https://agent.example/path',
      'https://user:secret@agent.example',
      'https://agent.example?token=x',
    ]) {
      expect(() => normalizeAllowedOrigins([invalid]), invalid).toThrow(/allowed origin/u);
    }
  });
});
