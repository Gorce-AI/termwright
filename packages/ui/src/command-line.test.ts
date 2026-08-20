import { describe, expect, it } from 'vitest';
import { CommandLineSyntaxError, parseCommandLine } from './command-line.js';

describe('recorder command-line parsing', () => {
  it('splits whitespace without retaining empty gaps', () => {
    expect(parseCommandLine('  node\tapp.js\n--watch  ')).toEqual(['node', 'app.js', '--watch']);
    expect(parseCommandLine('   ')).toEqual([]);
  });

  it('groups single and double quoted text and joins adjacent fragments', () => {
    expect(parseCommandLine(`node -e "console.log('hello world')"`)).toEqual([
      'node',
      '-e',
      "console.log('hello world')",
    ]);
    expect(parseCommandLine(`tool --name='two words' pre" middle "post`)).toEqual([
      'tool',
      '--name=two words',
      'pre middle post',
    ]);
  });

  it('keeps empty quoted arguments', () => {
    expect(parseCommandLine(`tool "" '' a""b`)).toEqual(['tool', '', '', 'ab']);
  });

  it('uses backslashes for spaces, quotes and literal backslashes', () => {
    expect(parseCommandLine(String.raw`tool one\ two "say \"hello\"" a\\b`)).toEqual([
      'tool',
      'one two',
      'say "hello"',
      'a\\b',
    ]);
  });

  it('preserves backslashes before ordinary characters for Windows paths', () => {
    expect(parseCommandLine(String.raw`"C:\Program Files\app.exe" C:\tools\app.exe`)).toEqual([
      String.raw`C:\Program Files\app.exe`,
      String.raw`C:\tools\app.exe`,
    ]);
  });

  it('does not interpret shell expansions or operators', () => {
    expect(parseCommandLine('echo $HOME *.ts | cat; next')).toEqual([
      'echo',
      '$HOME',
      '*.ts',
      '|',
      'cat;',
      'next',
    ]);
  });

  it.each([
    ['tool \\', 'dangling-escape', 5, /ends with a backslash.*character 6/i],
    [`tool 'value`, 'unclosed-single-quote', 5, /unclosed single quote.*character 6/i],
    ['tool "value', 'unclosed-double-quote', 5, /unclosed double quote.*character 6/i],
  ] as const)('reports %s clearly', (input, code, index, message) => {
    try {
      parseCommandLine(input);
      throw new Error('the invalid command was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(CommandLineSyntaxError);
      expect(error).toMatchObject({ code, index });
      expect((error as Error).message).toMatch(message);
    }
  });
});
