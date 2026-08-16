import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('defaults to help', () => {
    expect(parseArgs([]).command).toBe('help');
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-v']).command).toBe('version');
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
    const args = parseArgs(['ui', '--port', '4000', '--host', '127.0.0.1', '--no-watch']);
    expect(args).toMatchObject({ command: 'ui', port: 4000, host: '127.0.0.1', watch: false });
    expect(args.open).toBe(true);
  });

  it('reads --no-open', () => {
    expect(parseArgs(['ui', '--no-open']).open).toBe(false);
  });

  it('passes arguments after -- to the test runner', () => {
    expect(parseArgs(['ui', '--', 'src/login.test.ts', '--reporter=dot']).rest).toEqual([
      'src/login.test.ts',
      '--reporter=dot',
    ]);
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
