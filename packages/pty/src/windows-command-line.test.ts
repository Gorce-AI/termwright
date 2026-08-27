import { describe, expect, it } from 'vitest';
import { buildCommandLine, buildEnvironment, quoteWindowsArgument } from './windows.js';

/**
 * Windows has no argv. The child re-parses one string with
 * CommandLineToArgvW, so an argument only survives intact if it is quoted to
 * that exact grammar — and the grammar is unusual enough that "wrap it in
 * quotes" is wrong for most of these cases.
 */
describe('Windows command-line quoting', () => {
  it('leaves a plain argument alone', () => {
    expect(quoteWindowsArgument('node')).toBe('node');
    expect(quoteWindowsArgument('--flag=value')).toBe('--flag=value');
  });

  it('quotes anything containing whitespace', () => {
    expect(quoteWindowsArgument('C:\\Program Files\\node.exe')).toBe(
      '"C:\\Program Files\\node.exe"',
    );
  });

  it('quotes an empty argument, which would otherwise vanish', () => {
    expect(quoteWindowsArgument('')).toBe('""');
  });

  it('escapes a quote and the backslashes in front of it', () => {
    expect(quoteWindowsArgument('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsArgument('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('doubles a trailing backslash run so it cannot escape the closing quote', () => {
    // Without this the final quote is consumed as an escape and the argument
    // swallows everything after it.
    expect(quoteWindowsArgument('C:\\path with space\\')).toBe('"C:\\path with space\\\\"');
  });

  it('keeps interior backslashes literal', () => {
    expect(quoteWindowsArgument('a\\b\\c d')).toBe('"a\\b\\c d"');
  });

  it('leaves shell metacharacters to the child, since no shell is involved', () => {
    // CreateProcessW runs the executable directly, so these are ordinary
    // characters rather than syntax; quoting them like a shell would corrupt
    // the argument the caller asked for.
    expect(quoteWindowsArgument('a&b|c')).toBe('a&b|c');
    expect(quoteWindowsArgument('%PATH%')).toBe('%PATH%');
  });

  it('preserves Unicode paths unchanged', () => {
    expect(quoteWindowsArgument('C:\\Użytkownicy\\提交')).toBe('C:\\Użytkownicy\\提交');
  });

  it('joins a command with single spaces', () => {
    expect(buildCommandLine(['node', '-e', 'process.stdout.write("x")'])).toBe(
      'node -e "process.stdout.write(\\"x\\")"',
    );
  });

  it('refuses a command with no executable', () => {
    expect(() => buildCommandLine([])).toThrow(/at least an executable/u);
  });
});

describe('Windows environment block', () => {
  it('renders KEY=VALUE entries', () => {
    expect(buildEnvironment({ PATH: 'C:\\Windows', TERM: 'xterm-256color' })).toEqual([
      'PATH=C:\\Windows',
      'TERM=xterm-256color',
    ]);
  });

  it('keeps an empty value, which is different from an absent variable', () => {
    expect(buildEnvironment({ EMPTY: '' })).toEqual(['EMPTY=']);
  });
});
