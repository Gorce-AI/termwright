import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('defaults to help', () => {
    expect(parseArgs([]).command).toBe('help');
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-v']).command).toBe('version');
  });

  it('prints global help or version instead of executing a subcommand', () => {
    for (const command of ['ui', 'report', 'screenshot', 'codegen']) {
      expect(parseArgs([command, '--help']).command).toBe('help');
      expect(parseArgs(['--help', command]).command).toBe('help');
      expect(parseArgs([command, '--version']).command).toBe('version');
    }
  });

  it('reads the agent-facing commands', () => {
    expect(parseArgs(['agent-context']).command).toBe('agent-context');
    expect(parseArgs(['usage']).command).toBe('usage');
    expect(parseArgs(['skill', '--out', 'out/skill']).out).toBe('out/skill');
  });

  it('takes --json anywhere', () => {
    expect(parseArgs(['--json', 'usage']).json).toBe(true);
    expect(parseArgs(['usage', '--json']).json).toBe(true);
  });

  it('reads the ui flags', () => {
    const args = parseArgs([
      'ui', '--port', '4000', '--host', '127.0.0.1', '--tags', '@smoke and not @slow', '--no-watch',
    ]);
    expect(args).toMatchObject({
      command: 'ui',
      port: 4000,
      host: '127.0.0.1',
      tags: '@smoke and not @slow',
      watch: false,
    });
    expect(args.surface).toBe('desktop');
  });

  it('reads the report command and where it writes', () => {
    const args = parseArgs(['report', '--trace', 'out/login.twtrace', '--out-file', 'r.html']);
    expect(args).toMatchObject({ command: 'report', trace: 'out/login.twtrace', outFile: 'r.html' });
  });

  it('refuses a report with nothing to render', () => {
    // The archive is the whole input; without it there is no report to write.
    expect(() => parseArgs(['report'])).toThrow(/needs the archive/);
  });

  it('reads the screenshot command and how the moment is named', () => {
    const args = parseArgs(['screenshot', '--trace', 'out/a.twtrace', '--at', '1500', '--scale', '2']);
    expect(args).toMatchObject({ command: 'screenshot', atMs: 1_500, scale: 2 });
    expect(parseArgs(['screenshot', '--trace', 'out/a.twtrace', '--step', '3']).step).toBe(3);
  });

  it('refuses a screenshot with nothing to capture, or two ways of naming it', () => {
    expect(() => parseArgs(['screenshot'])).toThrow(/needs the recording/);
    expect(() =>
      parseArgs(['screenshot', '--trace', 'a.twtrace', '--at', '10', '--step', '1']),
    ).toThrow(/pass one/);
  });

  it('refuses a flag that needs a number and did not get one', () => {
    expect(() => parseArgs(['screenshot', '--trace', 'a', '--at', 'soon'])).toThrow(/needs a number/);
  });

  it('selects desktop by default, or an explicit browser/no-open surface', () => {
    expect(parseArgs(['ui']).surface).toBe('desktop');
    expect(parseArgs(['ui', '--browser']).surface).toBe('browser');
    expect(parseArgs(['ui', '--no-open']).surface).toBe('none');
    expect(() => parseArgs(['ui', '--browser', '--no-open'])).toThrow(/cannot be used together/);
  });

  it('passes arguments after -- to the test runner', () => {
    expect(parseArgs(['ui', '--', 'src/login.test.ts', '--reporter=dot']).rest).toEqual([
      'src/login.test.ts',
      '--reporter=dot',
    ]);
  });

  it('selects only a declared native-host resource profile', () => {
    expect(parseArgs(['test', '--resource-profile', 'windows-ci']).resourceProfile).toBe('windows-ci');
    expect(parseArgs(['watch', '--resource-profile', 'stress']).resourceProfile).toBe('stress');
    expect(() => parseArgs(['test', '--resource-profile', 'auto'])).toThrow(/must be one of/u);
    expect(() => parseArgs(['doctor', '--resource-profile', 'ci'])).toThrow(/only available/u);
  });

  it('accepts a bounded number of complete native-host run cycles only for test', () => {
    expect(parseArgs(['test', '--runs', '50'])).toMatchObject({ command: 'test', runs: 50 });
    expect(parseArgs(['test']).runs).toBe(1);
    for (const value of ['0', '-1', '1.5', '10001', 'many']) {
      expect(() => parseArgs(['test', '--runs', value]), value).toThrow(/between 1 and 10000/u);
    }
    expect(() => parseArgs(['watch', '--runs', '2'])).toThrow(/only available/u);
  });

  it('treats codegen as ui --record', () => {
    const args = parseArgs(['codegen', '--out-file', 'src/rec.test.ts', '--', 'node', 'agent.js']);
    expect(args).toMatchObject({
      command: 'codegen',
      record: true,
      outFile: 'src/rec.test.ts',
      rest: ['node', 'agent.js'],
    });
  });

  it('forwards everything after mcp verbatim, including -- and unknown flags', () => {
    const args = parseArgs(['mcp', '--http', '--port', '7333']);
    expect(args.command).toBe('mcp');
    expect(args.rest).toEqual(['--http', '--port', '7333']);
  });

  it('rejects a flag it does not know', () => {
    expect(() => parseArgs(['ui', '--turbo'])).toThrow(/unknown argument/u);
  });

  it('does not apply Gherkin tag filtering to unrelated commands', () => {
    // Filtering belongs to the commands that run scenarios. Reading a trace or
    // writing a report has nothing to select.
    expect(() => parseArgs(['report', '--trace', 'a.twtrace', '--tags', '@smoke']))
      .toThrow(/only available with `termwright test`/u);
  });

  it('accepts a tag filter on every command that runs scenarios', () => {
    expect(parseArgs(['test', '--tags', '@smoke']).tags).toBe('@smoke');
    expect(parseArgs(['watch', '--tags', 'not @slow']).tags).toBe('not @slow');
    expect(parseArgs(['ui', '--tags', '@a or @b']).tags).toBe('@a or @b');
  });

  it('rejects a flag whose value is missing', () => {
    expect(() => parseArgs(['ui', '--trace'])).toThrow(/needs a value/u);
    expect(() => parseArgs(['ui', '--trace', '--port'])).toThrow(/needs a value/u);
  });

  it('rejects a port that is not a port', () => {
    expect(() => parseArgs(['ui', '--port', 'soon'])).toThrow(/integer between 0 and 65535/u);
    expect(() => parseArgs(['ui', '--port', '70000'])).toThrow(/integer between 0 and 65535/u);
  });

  it('rejects contradictory modes and an empty recording', () => {
    expect(() => parseArgs(['ui', '--trace', 'a.twtrace', '--record', '--', 'node'])).toThrow(
      /different modes/u,
    );
    expect(() => parseArgs(['codegen'])).toThrow(/needs a command to record/u);
  });

  it('rejects two commands', () => {
    expect(() => parseArgs(['ui', 'usage'])).toThrow(/cannot follow/u);
  });

  it('reports usage failures as the usage kind', () => {
    expect(() => parseArgs(['--nope'])).toThrow(expect.objectContaining({ kind: 'usage' }));
  });
});
