/**
 * Removes control-plane modes injected by the vendored ConPTY host.
 *
 * The passthrough ConPTY deliberately enables focus and Win32 input modes for
 * its own input transport. Those bytes describe the host, not the child, and
 * must not reach the terminal emulator as application-owned mode evidence.
 * The transform is byte based: VT control sequences are ASCII and can be
 * divided at any byte by the anonymous output pipe.
 */

const ESC = 0x1b;

const bytes = (...values: number[]): Buffer => Buffer.from(values);

const DA1 = bytes(ESC, 0x5b, 0x63);
const DSRCPR = bytes(ESC, 0x5b, 0x36, 0x6e);
const WINDOW_DEICONIFY = bytes(ESC, 0x5b, 0x31, 0x74);
const WINDOW_ICONIFY = bytes(ESC, 0x5b, 0x32, 0x74);
const FOCUS_ON = bytes(ESC, 0x5b, 0x3f, 0x31, 0x30, 0x30, 0x34, 0x68);
const FOCUS_OFF = bytes(ESC, 0x5b, 0x3f, 0x31, 0x30, 0x30, 0x34, 0x6c);
const WIN32_ON = bytes(ESC, 0x5b, 0x3f, 0x39, 0x30, 0x30, 0x31, 0x68);
const WIN32_OFF = bytes(ESC, 0x5b, 0x3f, 0x39, 0x30, 0x30, 0x31, 0x6c);
const RIS = bytes(ESC, 0x63);

interface Rewrite {
  readonly input: Buffer;
  readonly output: Buffer;
  readonly hostQueries?: readonly ConPtyHostQuery[];
}

export type ConPtyHostQuery = 'cursor-position' | 'primary-device-attributes';
export type ConPtyTerminalResponseRoute =
  'host-control' | 'conpty-cpr-arbitrated' | 'application-win32-input';

export function encodeWin32InputModeTerminalResponse(data: Uint8Array): Buffer {
  let encoded = '';
  for (const byte of data) {
    if (byte > 0x7f) {
      throw new TypeError(
        `terminal response contains non-ASCII byte 0x${byte.toString(16).padStart(2, '0')}`,
      );
    }
    encoded += `\u001b[0;0;${byte};1;0;1_`;
  }
  return Buffer.from(encoded, 'ascii');
}

export function encodeConPtyApplicationInput(
  data: Uint8Array,
  kind: 'key' | 'mouse' | 'paste' | 'raw',
): Buffer {
  // Preserve the complete physical Escape event. Reusing the byte-oriented
  // terminal-response encoder would deliver UnicodeChar=ESC but erase the
  // VK/scan identity observed by ReadConsoleInput applications.
  return kind === 'key' && data.byteLength === 1 && data[0] === 0x1b
    ? Buffer.from('\x1b[27;1;27;1;0;1_', 'ascii')
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

const CPR_ARBITRATION_PRIMER = Buffer.from('\x1b[27;0;0;1;8;1_', 'ascii');

export class ConPtyTerminalResponseTransport {
  #cprArbitrationPrimed = false;

  encode(route: ConPtyTerminalResponseRoute, data: Uint8Array): Buffer {
    if (route === 'application-win32-input') {
      return encodeWin32InputModeTerminalResponse(data);
    }
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (route !== 'conpty-cpr-arbitrated' || this.#cprArbitrationPrimed) return bytes;
    this.#cprArbitrationPrimed = true;
    return Buffer.concat([CPR_ARBITRATION_PRIMER, bytes]);
  }
}

function isHostResponse(query: ConPtyHostQuery, response: Buffer): boolean {
  const text = response.toString('ascii');
  return query === 'cursor-position'
    ? /^\x1b\[\d+;\d+R$/u.test(text)
    : /^\x1b\[\?[\d;]*c$/u.test(text);
}

/**
 * Preserves the ownership of startup queries emitted by ConPTY itself.
 *
 * Host-control replies must be written as raw VT so OpenConsole consumes
 * them. Application replies must use Win32 Input Mode so they reach the
 * child as terminal protocol bytes. The queue is populated by the same
 * split-safe startup rewrite that exposes each query to the emulator.
 */
export class ConPtyTerminalResponseRouter {
  readonly #hostQueries: ConPtyHostQuery[] = [];

  noteHostQuery(query: ConPtyHostQuery): void {
    this.#hostQueries.push(query);
  }

  route(response: Uint8Array): ConPtyTerminalResponseRoute {
    const bytes = Buffer.from(response.buffer, response.byteOffset, response.byteLength);
    const query = this.#hostQueries[0];
    // OpenConsole's input parser is itself the authoritative CPR provenance
    // seam. With a pending host capture it consumes the report and updates its
    // shadow cursor; otherwise its Win32-input branch passes the same raw CPR
    // through to the application. This also covers runtime host DSRs emitted
    // after resize or unknown VT, which are byte-identical to application DSRs.
    if (isHostResponse('cursor-position', bytes)) {
      if (query === 'cursor-position') {
        this.#hostQueries.shift();
        return 'conpty-cpr-arbitrated';
      }
      if (query !== undefined) {
        throw new Error(`terminal answered ${query} ConPTY host query with an unexpected response`);
      }
      return 'conpty-cpr-arbitrated';
    }
    if (query === undefined) return 'application-win32-input';
    if (!isHostResponse(query, bytes)) {
      throw new Error(`terminal answered ${query} ConPTY host query with an unexpected response`);
    }
    this.#hostQueries.shift();
    return 'host-control';
  }
}

const STARTUP_REWRITES: readonly Rewrite[] = [
  ...[WINDOW_DEICONIFY, WINDOW_ICONIFY].flatMap((windowReport): readonly Rewrite[] => [
    {
      input: Buffer.concat([windowReport, DSRCPR, DA1, FOCUS_ON, WIN32_ON]),
      output: Buffer.concat([windowReport, DSRCPR, DA1]),
      hostQueries: ['cursor-position', 'primary-device-attributes'],
    },
    {
      input: Buffer.concat([windowReport, DA1, FOCUS_ON, WIN32_ON]),
      output: Buffer.concat([windowReport, DA1]),
      hostQueries: ['primary-device-attributes'],
    },
  ]),
  {
    // With cursor inheritance VtIo asks for the cursor position before DA1.
    // Both queries are real transport output; only the modes belong to host.
    input: Buffer.concat([DSRCPR, DA1, FOCUS_ON, WIN32_ON]),
    output: Buffer.concat([DSRCPR, DA1]),
    hostQueries: ['cursor-position', 'primary-device-attributes'],
  },
  {
    // VtIo's ordinary startup handshake.
    input: Buffer.concat([DA1, FOCUS_ON, WIN32_ON]),
    output: DA1,
    hostQueries: ['primary-device-attributes'],
  },
];

const HOST_REWRITES: readonly Rewrite[] = [
  // AdaptDispatch reinjects these immediately after the child reset that
  // caused them. Keeping the reset preserves the child's original bytes.
  { input: Buffer.concat([FOCUS_OFF, FOCUS_ON]), output: FOCUS_OFF },
  { input: Buffer.concat([WIN32_OFF, WIN32_ON]), output: WIN32_OFF },
  { input: Buffer.concat([RIS, FOCUS_ON, WIN32_ON]), output: RIS },
];

function hasPrefixAt(input: Buffer, offset: number, pattern: Buffer): boolean {
  const available = Math.min(input.length - offset, pattern.length);
  for (let index = 0; index < available; index += 1) {
    if (input[offset + index] !== pattern[index]) return false;
  }
  return true;
}

/**
 * A deterministic streaming transducer for one ConPTY output stream.
 *
 * `push()` may retain only a suffix which could still become a host rewrite.
 * `finish()` releases that suffix verbatim, so a truncated or merely similar
 * child sequence is never lost at authoritative EOF.
 */
export class ConPtyControlPlaneNormalizer {
  #pending = Buffer.alloc(0);
  #atStreamStart = true;
  #finished = false;

  constructor(readonly onHostQuery: (query: ConPtyHostQuery) => void = () => undefined) {}

  push(chunk: Uint8Array): Buffer {
    if (this.#finished) {
      throw new Error('ConPTY output arrived after authoritative EOF');
    }
    if (chunk.byteLength === 0) return Buffer.alloc(0);

    const incoming = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const input = this.#pending.length === 0 ? incoming : Buffer.concat([this.#pending, incoming]);
    this.#pending = Buffer.alloc(0);

    const output: Buffer[] = [];
    let literalStart = 0;
    let offset = 0;

    while (offset < input.length) {
      const rewrites = this.#atStreamStart
        ? [...STARTUP_REWRITES, ...HOST_REWRITES]
        : HOST_REWRITES;
      let rewritten = false;
      let awaitingSuffix = false;

      for (const rewrite of rewrites) {
        if (!hasPrefixAt(input, offset, rewrite.input)) continue;
        const remaining = input.length - offset;
        if (remaining < rewrite.input.length) {
          awaitingSuffix = true;
          break;
        }

        if (literalStart < offset) output.push(input.subarray(literalStart, offset));
        output.push(rewrite.output);
        for (const query of rewrite.hostQueries ?? []) this.onHostQuery(query);
        offset += rewrite.input.length;
        literalStart = offset;
        this.#atStreamStart = false;
        rewritten = true;
        break;
      }

      if (rewritten) continue;
      if (awaitingSuffix) {
        if (literalStart < offset) output.push(input.subarray(literalStart, offset));
        this.#pending = Buffer.from(input.subarray(offset));
        return output.length === 0 ? Buffer.alloc(0) : Buffer.concat(output);
      }

      // This byte cannot begin any host-owned structure. It is child output.
      this.#atStreamStart = false;
      offset += 1;
    }

    if (literalStart < input.length) output.push(input.subarray(literalStart));
    return output.length === 0 ? Buffer.alloc(0) : Buffer.concat(output);
  }

  finish(): Buffer {
    if (this.#finished) return Buffer.alloc(0);
    this.#finished = true;
    const tail = this.#pending;
    this.#pending = Buffer.alloc(0);
    return tail;
  }
}
