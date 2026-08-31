import { describe, expect, it } from 'vitest';
import {
  ConPtyControlPlaneNormalizer,
  ConPtyTerminalResponseRouter,
  ConPtyTerminalResponseTransport,
  encodeConPtyApplicationInput,
  encodeWin32InputModeTerminalResponse,
  type ConPtyHostQuery,
} from './windows-output-normalizer.js';

const DA1 = '\x1b[c';
const HOST_CURSOR_REQUEST = '\x1b]8488;twh-cpr-v1:q:0123456789abcdef0123456789abcdef\x07';
const FOCUS_ON = '\x1b[?1004h';
const FOCUS_OFF = '\x1b[?1004l';
const WIN32_ON = '\x1b[?9001h';
const WIN32_OFF = '\x1b[?9001l';
const RIS = '\x1bc';

function normalize(chunks: readonly Buffer[]): Buffer {
  const normalizer = new ConPtyControlPlaneNormalizer();
  const output = chunks.map((chunk) => normalizer.push(chunk));
  output.push(normalizer.finish());
  return Buffer.concat(output);
}

function normalizeWithQueries(chunks: readonly Buffer[]): {
  readonly output: Buffer;
  readonly queries: readonly ConPtyHostQuery[];
} {
  const queries: ConPtyHostQuery[] = [];
  const normalizer = new ConPtyControlPlaneNormalizer((query) => queries.push(query));
  const output = chunks.map((chunk) => normalizer.push(chunk));
  output.push(normalizer.finish());
  return { output: Buffer.concat(output), queries };
}

function everySplit(input: string, expected: string): void {
  const source = Buffer.from(input);
  expect(normalize([source]).toString()).toBe(expected);
  expect(normalize([...source].map((byte) => Buffer.of(byte))).toString()).toBe(expected);
  for (let first = 0; first <= source.length; first += 1) {
    expect(normalize([source.subarray(0, first), source.subarray(first)]).toString()).toBe(
      expected,
    );
    for (let second = first; second <= source.length; second += 1) {
      expect(
        normalize([
          source.subarray(0, first),
          source.subarray(first, second),
          source.subarray(second),
        ]).toString(),
      ).toBe(expected);
    }
  }
}

describe('ConPTY control-plane output normalization', () => {
  it('keeps DA1 while removing the two startup host modes at every split', () => {
    everySplit(`${DA1}${FOCUS_ON}${WIN32_ON}app`, `${DA1}app`);
  });

  it('keeps the addressed startup cursor RPC while removing host modes at every split', () => {
    everySplit(
      `${HOST_CURSOR_REQUEST}${DA1}${FOCUS_ON}${WIN32_ON}app`,
      `${HOST_CURSOR_REQUEST}${DA1}app`,
    );
  });

  it('classifies only the exact startup DA host query', () => {
    const source = Buffer.from(`${HOST_CURSOR_REQUEST}${DA1}${FOCUS_ON}${WIN32_ON}app`);
    for (const chunks of [[source], [...source].map((byte) => Buffer.of(byte))]) {
      expect(normalizeWithQueries(chunks)).toEqual({
        output: Buffer.from(`${HOST_CURSOR_REQUEST}${DA1}app`),
        queries: ['primary-device-attributes'],
      });
    }
    expect(normalizeWithQueries([Buffer.from(`x${DA1}${FOCUS_ON}${WIN32_ON}`)]).queries).toEqual(
      [],
    );
  });

  it('recognizes the startup handshake after a pseudo-window report', () => {
    everySplit(`\x1b[1t${DA1}${FOCUS_ON}${WIN32_ON}app`, `\x1b[1t${DA1}app`);
    everySplit(
      `\x1b[2t${HOST_CURSOR_REQUEST}${DA1}${FOCUS_ON}${WIN32_ON}app`,
      `\x1b[2t${HOST_CURSOR_REQUEST}${DA1}app`,
    );
  });

  it('removes only the focus mode reinjected after a child reset', () => {
    everySplit(`a${FOCUS_OFF}${FOCUS_ON}b`, `a${FOCUS_OFF}b`);
  });

  it('removes only the Win32 input mode reinjected after a child reset', () => {
    everySplit(`a${WIN32_OFF}${WIN32_ON}b`, `a${WIN32_OFF}b`);
  });

  it('removes both host modes reinjected after RIS', () => {
    everySplit(`a${RIS}${FOCUS_ON}${WIN32_ON}b`, `a${RIS}b`);
  });

  it('preserves an intentional child disable followed by enable', () => {
    // ConPTY inserts its own SET between the two original child sequences.
    // The first SET is removed; the second one remains application evidence.
    everySplit(
      `${FOCUS_OFF}${FOCUS_ON}${FOCUS_ON}${WIN32_OFF}${WIN32_ON}${WIN32_ON}`,
      `${FOCUS_OFF}${FOCUS_ON}${WIN32_OFF}${WIN32_ON}`,
    );
  });

  it('preserves child mode changes following a hard reset', () => {
    everySplit(
      `${RIS}${FOCUS_ON}${WIN32_ON}${FOCUS_ON}${WIN32_ON}`,
      `${RIS}${FOCUS_ON}${WIN32_ON}`,
    );
  });

  it('does not remove standalone child enables or near misses', () => {
    const sequences = [
      FOCUS_ON,
      WIN32_ON,
      `${FOCUS_OFF}x${FOCUS_ON}`,
      `${WIN32_OFF}\x1b[?9002h`,
      `${RIS}${WIN32_ON}${FOCUS_ON}`,
      `${DA1}${FOCUS_ON}x${WIN32_ON}`,
      `x${DA1}${FOCUS_ON}${WIN32_ON}`,
      `${HOST_CURSOR_REQUEST.replace('abcdef', 'ABCDEF')}${DA1}${FOCUS_ON}${WIN32_ON}`,
    ];
    for (const sequence of sequences) everySplit(sequence, sequence);
  });

  it('releases every incomplete candidate verbatim at EOF', () => {
    const candidates = [
      `${HOST_CURSOR_REQUEST}${DA1}${FOCUS_ON}${WIN32_ON}`,
      `${DA1}${FOCUS_ON}${WIN32_ON}`,
      `${FOCUS_OFF}${FOCUS_ON}`,
      `${WIN32_OFF}${WIN32_ON}`,
      `${RIS}${FOCUS_ON}${WIN32_ON}`,
    ];
    for (const candidate of candidates) {
      for (let length = 1; length < candidate.length; length += 1) {
        const prefix = candidate.slice(0, length);
        expect(normalize([Buffer.from(prefix)]).toString()).toBe(prefix);
      }
    }
  });

  it('is idempotent at EOF and rejects data after EOF', () => {
    const normalizer = new ConPtyControlPlaneNormalizer();
    expect(normalizer.push(Buffer.from(FOCUS_OFF))).toEqual(Buffer.alloc(0));
    expect(normalizer.finish().toString()).toBe(FOCUS_OFF);
    expect(normalizer.finish()).toEqual(Buffer.alloc(0));
    expect(() => normalizer.push(Buffer.from('late'))).toThrow(/after authoritative EOF/u);
  });
});

describe('ConPTY terminal-response routing', () => {
  it('routes only addressed host replies raw and every standard CPR via W32IM', () => {
    const router = new ConPtyTerminalResponseRouter();
    router.noteHostQuery('primary-device-attributes');

    expect(router.route(Buffer.from('\x1b[?1;2c'))).toBe('host-control');
    expect(router.route(Buffer.from('\x1b[3;7R'))).toBe('application-win32-input');
    expect(
      router.route(
        Buffer.from('\x1b]8488;twh-cpr-v1:r:0123456789abcdef0123456789abcdef:3:7\x07', 'ascii'),
      ),
    ).toBe('host-control');
    expect(encodeWin32InputModeTerminalResponse(Buffer.from('\x1b[3;7R')).toString('ascii')).toBe(
      [27, 91, 51, 59, 55, 82].map((byte) => `\x1b[0;0;${byte};1;0;1_`).join(''),
    );
  });

  it('fails closed instead of letting a pending host query poison application routing', () => {
    const router = new ConPtyTerminalResponseRouter();
    router.noteHostQuery('primary-device-attributes');
    expect(() => router.route(Buffer.from('\x1b]11;rgb:0000\/0000\/0000\x1b\\'))).toThrow(
      /unexpected response/u,
    );
  });

  it('never exposes malformed or stale versioned host replies as application input', () => {
    const router = new ConPtyTerminalResponseRouter();
    for (const response of [
      '\x1b]8488;twh-cpr-v1:r:stale:3:7\x07',
      '\x1b]8488;twh-cpr-v1:r:0123456789abcdef0123456789abcdef:0:7\x07',
    ]) {
      expect(router.route(Buffer.from(response, 'ascii'))).toBe('host-control');
    }
    expect(router.route(Buffer.from('\x1b]8488;application-owned\x07', 'ascii'))).toBe(
      'application-win32-input',
    );
  });

  it('preserves an addressed host reply and encodes an application reply', () => {
    const transport = new ConPtyTerminalResponseTransport();
    const host = Buffer.from(
      '\x1b]8488;twh-cpr-v1:r:0123456789abcdef0123456789abcdef:1:1\x07',
      'ascii',
    );
    expect(transport.encode('host-control', host)).toEqual(host);
    expect(
      transport.encode('application-win32-input', Buffer.from('\x1b[3;7R')).toString('ascii'),
    ).toBe([27, 91, 51, 59, 55, 82].map((byte) => `\x1b[0;0;${byte};1;0;1_`).join(''));
  });

  it('encodes a physical lone Escape without changing raw or compound input', () => {
    expect(encodeConPtyApplicationInput(Buffer.from('\x1b'), 'key')).toEqual(
      Buffer.from('\x1b[27;1;27;1;0;1_', 'ascii'),
    );
    expect(encodeConPtyApplicationInput(Buffer.from('\x1b[A'), 'key')).toEqual(
      Buffer.from('\x1b[A'),
    );
    expect(encodeConPtyApplicationInput(Buffer.from('\x1b'), 'raw')).toEqual(Buffer.from('\x1b'));
  });
});
