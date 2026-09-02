import { describe, expect, it } from 'vitest';
import { resolveArtifactSecurityPolicy } from '@termwright/protocol';
import { measureTextCellWidth } from '@termwright/vt';
import { TerminalSanitizer } from './terminal-sanitizer.js';

function sanitizer(secret: string): TerminalSanitizer {
  return new TerminalSanitizer(
    resolveArtifactSecurityPolicy({ mode: 'redacted', secrets: [secret] }),
  );
}

describe('TerminalSanitizer', () => {
  it('matches an exact secret across arbitrary output chunks', () => {
    const secret = 'TERMWRIGHT_CANARY_SECRET_split';
    const value = sanitizer(secret);
    const output =
      value.push(`before ${secret.slice(0, 8)}`) +
      value.push(secret.slice(8, 21)) +
      value.push(`${secret.slice(21)} after`) +
      value.finish();
    expect(output).not.toContain(secret);
    expect(output).toContain('before ');
    expect(output).toContain(' after');
  });

  it('matches printable text separated by SGR controls', () => {
    const secret = 'SECRET';
    const value = sanitizer(secret);
    const output = value.push(`S\u001b[31mE\u001b[0mCRET`) + value.finish();
    expect(output).not.toContain(secret);
    expect(output).toContain('\u001b[31m');
    expect(output.replace(/\u001b\[[0-9;]*m/gu, '')).toBe('██████');
  });

  it('sanitizes OSC and Unicode secrets without persisting their payload', () => {
    const secret = 'tajne-Żółć-👩🏽‍💻';
    const value = sanitizer(secret);
    const output =
      value.push(`\u001b]0;${secret.slice(0, 7)}`) +
      value.push(`${secret.slice(7)}\u0007${secret}`) +
      value.finish();
    expect(output).not.toContain(secret);
    expect(output).toContain('\u001b]0;[redacted]\u0007');
  });

  it.each(['👨‍👩‍👧‍👦', '🇵🇱', 'क्षि', '漢'])('preserves canonical cell geometry for %s', (secret) => {
    const value = sanitizer(secret);
    const output = value.push(secret) + value.finish();
    expect(measureTextCellWidth(output)).toBe(measureTextCellWidth(secret));
    expect(output).not.toContain(secret);
  });

  it('fails secure on an unterminated string control', () => {
    const value = sanitizer('secret');
    value.push('\u001b]0;untrusted');
    expect(() => value.finish()).toThrow(/control sequence/u);
  });

  it('matches bounded configured patterns across chunks', () => {
    const value = new TerminalSanitizer(
      resolveArtifactSecurityPolicy({
        mode: 'redacted',
        patterns: [{ pattern: /token=[A-Z]+/u, maxMatchChars: 16 }],
      }),
    );
    const output = value.push('token=SE') + value.push('CRET;ok') + value.finish();
    expect(output).toBe('█'.repeat(12) + ';ok');
  });
});
