import { describe, expect, it } from 'vitest';
import { REDACTED, isSecretKey, redactAttr, redactText, resolveRedaction } from './redact.js';

const redaction = resolveRedaction();

describe('secret-shaped values', () => {
  it('redacts a bearer token', () => {
    const text = redactText('GET /v1 auth=Bearer abc123DEF456ghi789JKL', redaction);
    expect(text).not.toContain('abc123DEF456');
    expect(text).toContain(REDACTED);
  });

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
    expect(redactText(`token=${jwt}`, redaction)).not.toContain('eyJzdWIi');
  });

  it('redacts provider-specific credentials', () => {
    const samples = [
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_abcdefghijklmnopqrstuv_wxyz0123456789',
      'AKIAIOSFODNN7EXAMPLE',
      // Assembled at runtime so secret scanners never see a token-shaped literal.
      ['xoxb', '123456789012', 'abcdefghijklmnop'].join('-'),
      'sk-abcdefghijklmnopqrstuvwxyz0123456789',
    ];
    for (const sample of samples) {
      expect(redactText(`value ${sample} end`, redaction)).not.toContain(sample);
    }
  });

  it('redacts credentials embedded in a URL', () => {
    const text = redactText('connecting to postgres://admin:s3cr3t@db:5432/app', redaction);
    expect(text).not.toContain('s3cr3t');
  });

  it('redacts a private key block', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----';
    expect(redactText(`key: ${key}`, redaction)).not.toContain('MIIEow');
  });

  it('redacts every occurrence, not just the first', () => {
    const text = redactText('a AKIAIOSFODNN7EXAMPLE b AKIAIOSFODNN7EXAMPL2 c', redaction);
    expect(text).not.toContain('AKIA');
  });

  it('is idempotent', () => {
    const once = redactText('Bearer abcdef1234567890abcdef', redaction);
    expect(redactText(once, redaction)).toBe(once);
  });

  it('leaves ordinary diagnostics intact', () => {
    // Over-redaction destroys the value of a log; hashes, ids and paths must
    // survive, so the patterns key on credential formats rather than entropy.
    const samples = [
      'commit 9f2b1c4e8a7d6f5b3c2a1e0d9f8b7a6c5d4e3f21 built ok',
      'request 550e8400-e29b-41d4-a716-446655440000 took 12ms',
      'GET /api/users/12345 200 in 3ms',
      'checksum sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ];
    for (const sample of samples) {
      expect(redactText(sample, redaction)).toBe(sample);
    }
  });
});

describe('secret-shaped keys', () => {
  it('recognises common credential key names', () => {
    for (const key of [
      'password',
      'passwd',
      'api_key',
      'apiKey',
      'authorization',
      'auth',
      'token',
      'secret',
      'cookie',
      'sessionId',
      'private_key',
      'accessKey',
      'credential',
    ]) {
      expect(isSecretKey(key, redaction)).toBe(true);
    }
  });

  it('recognises them inside a dotted path', () => {
    expect(isSecretKey('headers.authorization', redaction)).toBe(true);
    expect(isSecretKey('db.password', redaction)).toBe(true);
    expect(isSecretKey('req.headers.cookie', redaction)).toBe(true);
  });

  it('leaves ordinary keys alone', () => {
    for (const key of ['user', 'durationMs', 'status', 'path', 'keyboard', 'tokenizer', 'count']) {
      expect(isSecretKey(key, redaction)).toBe(false);
    }
  });

  it('replaces a secret-keyed value whatever it looks like', () => {
    expect(redactAttr('password', 'hunter2', redaction)).toBe(REDACTED);
    expect(redactAttr('api_key', 12345, redaction)).toBe(REDACTED);
  });

  it('still scans the value of an ordinary key', () => {
    expect(redactAttr('note', 'Bearer abcdef1234567890abcdef', redaction)).toContain(REDACTED);
    expect(redactAttr('count', 42, redaction)).toBe(42);
  });
});

describe('configuration', () => {
  it('honours a custom replacement and extra key pattern', () => {
    const custom = resolveRedaction({ replacement: '***', keyPattern: /ssn/i });
    expect(redactAttr('ssn', '123-45-6789', custom)).toBe('***');
    expect(redactAttr('password', 'hunter2', custom)).toBe('hunter2');
  });

  it('can be turned off entirely', () => {
    const off = resolveRedaction({ enabled: false });
    expect(redactAttr('password', 'hunter2', off)).toBe('hunter2');
    expect(redactText('Bearer abcdef1234567890abcdef', off)).toContain('abcdef');
  });
});
