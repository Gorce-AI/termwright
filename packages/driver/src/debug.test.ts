import { afterEach, describe, expect, it } from 'vitest';
import { DebugLog, debugMode, formatBytes, instrument, unwrap } from './debug.js';

const ORIGINAL = process.env['TERMWRIGHT_DEBUG'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['TERMWRIGHT_DEBUG'];
  else process.env['TERMWRIGHT_DEBUG'] = ORIGINAL;
});

function sink(): { lines: string[]; log: DebugLog } {
  const lines: string[] = [];
  let clock = 0;
  const log = new DebugLog('abcdef0123456789', () => (clock += 1000), 'api', (line) => {
    lines.push(line.trimEnd());
  });
  return { lines, log };
}

describe('debugMode', () => {
  it('reads the environment switch', () => {
    for (const [value, expected] of [
      ['1', 'api'],
      ['true', 'api'],
      ['api', 'api'],
      ['all', 'all'],
      ['0', 'off'],
      ['', 'off'],
    ] as const) {
      process.env['TERMWRIGHT_DEBUG'] = value;
      expect(debugMode(undefined), value).toBe(expected);
    }
  });

  it('lets the launch option turn it on, and the environment turn it off', () => {
    delete process.env['TERMWRIGHT_DEBUG'];
    expect(debugMode(true)).toBe('api');
    expect(debugMode(false)).toBe('off');
    expect(debugMode(undefined)).toBe('off');

    process.env['TERMWRIGHT_DEBUG'] = '0';
    expect(debugMode(true)).toBe('off');
  });
});

describe('DebugLog', () => {
  it('prefixes lines with a category, a short session id and a timestamp', () => {
    const { lines, log } = sink();
    log.line('api', 'hello()');
    expect(lines[0]).toBe('  tw:api  [abcdef01]   1.000s hello()');
  });

  it('renders diagnostics with their revision and wire code', () => {
    const { lines, log } = sink();
    log.diagnostic({ code: 'revision-superseded', detail: 'dropped', revision: 4, timeMs: 1 });
    log.diagnostic({ code: 'protocol-violation', detail: 'closed', wireCode: 'limit-exceeded', timeMs: 2 });
    expect(lines[0]).toContain('revision-superseded r4: dropped');
    expect(lines[1]).toContain('protocol-violation (limit-exceeded): closed');
  });
});

describe('instrument', () => {
  it('logs calls with their arguments and their outcome', async () => {
    const { lines, log } = sink();
    const target = {
      press(keys: string): Promise<void> {
        void keys;
        return Promise.resolve();
      },
      async waitForText(text: string | RegExp): Promise<void> {
        void text;
        return Promise.reject(new Error('nope'));
      },
    };
    const wrapped = instrument(target, log, 'harness');

    await wrapped.press('Control+A');
    await wrapped.waitForText(/ready/u).catch(() => {});

    expect(lines[0]).toContain('press("Control+A") started');
    expect(lines[1]).toContain('press("Control+A") succeeded in');
    expect(lines[2]).toContain('waitForText(/ready/u) started');
    expect(lines[3]).toContain('waitForText(/ready/u) failed after');
    expect(lines[3]).toContain('Error: nope');
    // Waits are their own category so a reader can grep them apart from calls.
    expect(lines[2]?.startsWith('  tw:wait')).toBe(true);
  });

  it('logs payloads that routinely carry secrets by size only', async () => {
    const { lines, log } = sink();
    const wrapped = instrument(
      {
        paste: async (text: string) => void text,
        write: async (bytes: Uint8Array) => void bytes,
        type: async (text: string) => void text,
      },
      log,
      'harness',
    );

    await wrapped.paste('correct horse battery staple');
    await wrapped.write(new Uint8Array([1, 2, 3]));
    await wrapped.type('visible');

    expect(lines.join('\n')).not.toContain('correct horse');
    expect(lines[0]).toContain('paste(<28 chars>)');
    expect(lines[2]).toContain('write(<3 bytes>)');
    // Ordinary typing stays readable: it is what the test is about.
    expect(lines[4]).toContain('type("visible")');
  });

  it('names returned locators and wraps them so chains stay visible', async () => {
    const { lines, log } = sink();
    const locator = {
      description: '#save',
      async click(): Promise<void> {},
    };
    const wrapped = instrument({ getByTestId: (id: string) => ({ ...locator, description: `#${id}` }) }, log, 'harness');

    const found = wrapped.getByTestId('save');
    await found.click();

    expect(lines[0]).toContain('getByTestId("save") → #save');
    expect(lines[1]).toContain('locator.click() started');
  });

  it('keeps the real object reachable through unwrap', () => {
    const { log } = sink();
    const target = { description: 'x' };
    const wrapped = instrument(target, log, 'locator');
    expect(unwrap(wrapped)).toBe(target);
    expect(unwrap(target)).toBe(target);
    expect(unwrap('plain')).toBe('plain');
  });

  it('propagates synchronous throws after logging them', () => {
    const { lines, log } = sink();
    const wrapped = instrument(
      {
        nth(): never {
          throw new TypeError('bad index');
        },
      },
      log,
      'locator',
    );
    expect(() => wrapped.nth()).toThrow(TypeError);
    expect(lines[0]).toContain('locator.nth() failed: TypeError: bad index');
  });
});

describe('formatBytes', () => {
  it('escapes control characters and truncates', () => {
    expect(formatBytes(new TextEncoder().encode('a\r\n'))).toBe('3 bytes a\\r\\n');
    expect(formatBytes(new TextEncoder().encode('x'.repeat(80)))).toContain('80 bytes');
    expect(formatBytes(new TextEncoder().encode('x'.repeat(80))).endsWith('…')).toBe(true);
  });
});
