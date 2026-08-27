/**
 * The child environment, which is platform-shaped whether or not the author
 * remembers it. Runs on every platform in CI, so the Windows branch is checked
 * by Windows rather than by a comment.
 */
import { describe, expect, it } from 'vitest';
import { buildChildEnv } from './session.js';

/** Variables without which a child cannot start on this platform. */
const REQUIRED: readonly string[] =
  process.platform === 'win32'
    ? // A Node process with no SystemRoot aborts, and no PATHEXT cannot resolve
      // an executable. Both produce a dead child with no explanation.
      ['PATH', 'PATHEXT', 'SystemRoot']
    : ['PATH'];

function lookup(env: Record<string, string>, name: string): string | undefined {
  if (process.platform !== 'win32') return env[name];
  const found = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
  return found === undefined ? undefined : env[found];
}

describe('buildChildEnv', () => {
  it('gives a replaced environment everything the platform needs to start a process', () => {
    const env = buildChildEnv('replace', undefined);
    for (const name of REQUIRED) {
      expect(
        lookup(env, name),
        `${name} must survive envMode 'replace' on ${process.platform}`,
      ).toBeDefined();
    }
  });

  it('keeps the runner’s secrets out of a replaced environment', () => {
    process.env['TERMWRIGHT_ENV_TEST_SECRET'] = 'leaked';
    try {
      const env = buildChildEnv('replace', undefined);
      expect(lookup(env, 'TERMWRIGHT_ENV_TEST_SECRET')).toBeUndefined();
    } finally {
      delete process.env['TERMWRIGHT_ENV_TEST_SECRET'];
    }
  });

  it('passes everything through when the caller asks to inherit', () => {
    process.env['TERMWRIGHT_ENV_TEST_SECRET'] = 'shared-on-purpose';
    try {
      const env = buildChildEnv('inherit', undefined);
      expect(lookup(env, 'TERMWRIGHT_ENV_TEST_SECRET')).toBe('shared-on-purpose');
    } finally {
      delete process.env['TERMWRIGHT_ENV_TEST_SECRET'];
    }
  });

  it('tells the child which terminal it is attached to, in either mode', () => {
    // Ours, not the runner's: the emulator's capabilities are known exactly,
    // and a Windows runner has no TERM of its own to pass on anyway.
    for (const mode of ['replace', 'inherit'] as const) {
      const env = buildChildEnv(mode, undefined);
      expect(lookup(env, 'TERM')).toBe('xterm-256color');
      expect(lookup(env, 'COLORTERM')).toBe('truecolor');
    }
  });

  it('does not depend on the parent having a terminal', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'TERM');
    const previous = process.env['TERM'];
    delete process.env['TERM'];
    try {
      // A GitHub Actions Windows runner looks exactly like this.
      expect(lookup(buildChildEnv('replace', undefined), 'TERM')).toBe('xterm-256color');
      expect(lookup(buildChildEnv('inherit', undefined), 'TERM')).toBe('xterm-256color');
    } finally {
      if (had) process.env['TERM'] = previous;
    }
  });

  it('does not pass on the parent’s terminal, which describes a different one', () => {
    const had = Object.prototype.hasOwnProperty.call(process.env, 'TERM');
    const previous = process.env['TERM'];
    process.env['TERM'] = 'dumb';
    try {
      expect(lookup(buildChildEnv('inherit', undefined), 'TERM')).toBe('xterm-256color');
    } finally {
      if (had) process.env['TERM'] = previous;
      else delete process.env['TERM'];
    }
  });

  it('still lets a caller test their program under another terminal', () => {
    for (const mode of ['replace', 'inherit'] as const) {
      const env = buildChildEnv(mode, { TERM: 'vt100', COLORTERM: '' });
      expect(env['TERM']).toBe('vt100');
      expect(env['COLORTERM']).toBe('');
    }
  });

  it('lets explicit entries win in either mode', () => {
    for (const mode of ['replace', 'inherit'] as const) {
      const env = buildChildEnv(mode, { EXPLICIT: 'yes', PATH: 'overridden' });
      expect(env['EXPLICIT']).toBe('yes');
      expect(env['PATH']).toBe('overridden');
    }
  });
});
