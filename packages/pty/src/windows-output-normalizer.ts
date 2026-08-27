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
}

const STARTUP_REWRITES: readonly Rewrite[] = [
  ...[WINDOW_DEICONIFY, WINDOW_ICONIFY].flatMap((windowReport): readonly Rewrite[] => [
    {
      input: Buffer.concat([windowReport, DSRCPR, DA1, FOCUS_ON, WIN32_ON]),
      output: Buffer.concat([windowReport, DSRCPR, DA1]),
    },
    {
      input: Buffer.concat([windowReport, DA1, FOCUS_ON, WIN32_ON]),
      output: Buffer.concat([windowReport, DA1]),
    },
  ]),
  {
    // With cursor inheritance VtIo asks for the cursor position before DA1.
    // Both queries are real transport output; only the modes belong to host.
    input: Buffer.concat([DSRCPR, DA1, FOCUS_ON, WIN32_ON]),
    output: Buffer.concat([DSRCPR, DA1]),
  },
  {
    // VtIo's ordinary startup handshake.
    input: Buffer.concat([DA1, FOCUS_ON, WIN32_ON]),
    output: DA1,
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
