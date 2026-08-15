/**
 * The inverse of the driver's key encoder: raw stdin bytes back into the key
 * descriptions a generated test would use.
 *
 * The recorder receives what the browser's terminal sends — bytes, because that
 * is what a terminal speaks. A test that read `write('[B')` would be
 * unreadable, so the recorder decodes: `[B` becomes `ArrowDown`, a run of
 * printable characters becomes one `type('hello')`, and a bracketed-paste block
 * becomes `paste(...)`.
 *
 * Decoding is best-effort by design. Anything the table does not recognise is
 * emitted as a `raw` chunk, which codegen writes as `write(...)` with the bytes
 * escaped — never dropped, never guessed at.
 *
 * @packageDocumentation
 */

/** One decoded input action. */
export type DecodedInput =
  | { readonly kind: 'press'; readonly keys: string }
  | { readonly kind: 'type'; readonly text: string }
  | { readonly kind: 'paste'; readonly text: string }
  | { readonly kind: 'raw'; readonly bytes: Uint8Array };

const ESC = 0x1b;

/** Ceiling on bytes held back waiting for a sequence to complete. */
const MAX_PENDING_BYTES = 64 * 1024;

/** `CSI <final>` / `SS3 <final>` cursor-style keys. */
const CURSOR_FINALS: Readonly<Record<string, string>> = Object.freeze({
  A: 'ArrowUp',
  B: 'ArrowDown',
  C: 'ArrowRight',
  D: 'ArrowLeft',
  H: 'Home',
  F: 'End',
});

/** `CSI <n> ~` keys. */
const TILDE_KEYS: Readonly<Record<number, string>> = Object.freeze({
  2: 'Insert',
  3: 'Delete',
  5: 'PageUp',
  6: 'PageDown',
  15: 'F5',
  17: 'F6',
  18: 'F7',
  19: 'F8',
  20: 'F9',
  21: 'F10',
  23: 'F11',
  24: 'F12',
});

/** `SS3 <final>` function keys. */
const SS3_FUNCTION_FINALS: Readonly<Record<string, string>> = Object.freeze({
  P: 'F1',
  Q: 'F2',
  R: 'F3',
  S: 'F4',
});

/** Single control bytes with a name of their own. */
const CONTROL_NAMES: Readonly<Record<number, string>> = Object.freeze({
  0x0d: 'Enter',
  0x0a: 'Enter',
  0x09: 'Tab',
  0x7f: 'Backspace',
  0x00: 'Control+@',
});

const PASTE_START = '[200~';
const PASTE_END = '[201~';

/**
 * Streaming decoder. Bytes arrive in whatever chunks the socket delivers, so an
 * escape sequence can be split across two messages; the decoder holds an
 * incomplete tail until the rest arrives.
 *
 * @example
 * ```ts
 * const decoder = new InputDecoder();
 * decoder.push(new TextEncoder().encode('hi\r'));
 * // [{ kind: 'type', text: 'hi' }, { kind: 'press', keys: 'Enter' }]
 * ```
 */
export class InputDecoder {
  #pending: Uint8Array = new Uint8Array(0);
  #inPaste = false;
  #paste = '';

  /** Decodes another chunk. Incomplete trailing sequences are buffered. */
  push(bytes: Uint8Array): readonly DecodedInput[] {
    const buffer = concat(this.#pending, bytes);
    const out: DecodedInput[] = [];
    let index = 0;
    let text = '';
    const flushText = (): void => {
      if (text === '') return;
      out.push({ kind: 'type', text });
      text = '';
    };

    while (index < buffer.length) {
      if (this.#inPaste) {
        const end = indexOfAscii(buffer, PASTE_END, index);
        if (end === -1) {
          // Keep the last few bytes back: they may be a split terminator.
          const keep = Math.max(index, buffer.length - PASTE_END.length + 1);
          this.#paste += decodeUtf8(buffer.subarray(index, keep));
          index = keep;
          break;
        }
        this.#paste += decodeUtf8(buffer.subarray(index, end));
        out.push({ kind: 'paste', text: this.#paste });
        this.#paste = '';
        this.#inPaste = false;
        index = end + PASTE_END.length;
        continue;
      }

      const byte = buffer[index] as number;
      if (byte === ESC) {
        if (startsWithAscii(buffer, PASTE_START, index)) {
          flushText();
          this.#inPaste = true;
          index += PASTE_START.length;
          continue;
        }
        const escape = decodeEscape(buffer, index);
        if (escape === 'incomplete') break;
        flushText();
        out.push(escape.input);
        index = escape.next;
        continue;
      }

      const name = CONTROL_NAMES[byte];
      if (name !== undefined) {
        flushText();
        out.push({ kind: 'press', keys: name });
        index += 1;
        continue;
      }
      if (byte < 0x20) {
        flushText();
        out.push({ kind: 'press', keys: `Control+${String.fromCharCode(byte + 0x40)}` });
        index += 1;
        continue;
      }

      // A printable run, decoded as UTF-8 up to the next control byte.
      const start = index;
      while (index < buffer.length && (buffer[index] as number) >= 0x20 && buffer[index] !== 0x7f) {
        index += 1;
      }
      const chunk = buffer.subarray(start, index);
      const complete = completeUtf8Length(chunk);
      text += decodeUtf8(chunk.subarray(0, complete));
      if (complete < chunk.length) {
        // Split multi-byte character: hold the tail for the next chunk.
        index = start + complete;
        break;
      }
    }

    flushText();
    this.#pending = buffer.subarray(index);
    if (this.#pending.length > MAX_PENDING_BYTES) {
      // An escape sequence that never terminates, or a paste with no end
      // marker: hand the bytes back rather than buffering without bound.
      out.push({ kind: 'raw', bytes: this.#pending });
      this.#pending = new Uint8Array(0);
      this.#paste = '';
      this.#inPaste = false;
    }
    return out;
  }

  /**
   * Flushes whatever is buffered, unrecognised, as a `raw` action. Call this
   * when the session ends so nothing is silently lost.
   */
  flush(): readonly DecodedInput[] {
    const out: DecodedInput[] = [];
    if (this.#inPaste) {
      // Whatever is buffered is paste content whose terminator never arrived.
      const text = this.#paste + decodeUtf8(this.#pending);
      this.#pending = new Uint8Array(0);
      this.#paste = '';
      this.#inPaste = false;
      if (text !== '') out.push({ kind: 'paste', text });
    }
    if (this.#pending.length > 0) {
      out.push({ kind: 'raw', bytes: this.#pending });
      this.#pending = new Uint8Array(0);
    }
    return out;
  }
}

/**
 * Decodes a complete buffer in one call.
 *
 * @example
 * ```ts
 * decodeInput(new TextEncoder().encode('[B')); // [{ kind: 'press', keys: 'ArrowDown' }]
 * ```
 */
export function decodeInput(bytes: Uint8Array): readonly DecodedInput[] {
  const decoder = new InputDecoder();
  return [...decoder.push(bytes), ...decoder.flush()];
}

/** Merges neighbouring `type` actions, so `h`,`i` records as `type('hi')`. */
export function coalesceInput(inputs: readonly DecodedInput[]): readonly DecodedInput[] {
  const out: DecodedInput[] = [];
  for (const input of inputs) {
    const last = out[out.length - 1];
    if (input.kind === 'type' && last?.kind === 'type') {
      out[out.length - 1] = { kind: 'type', text: last.text + input.text };
      continue;
    }
    out.push(input);
  }
  return out;
}

type EscapeResult = { input: DecodedInput; next: number } | 'incomplete';

function decodeEscape(buffer: Uint8Array, start: number): EscapeResult {
  const second = buffer[start + 1];
  if (second === undefined) {
    // A lone ESC is ambiguous until the next byte arrives; it may be the start
    // of a sequence. Treated as Escape only on flush.
    return { input: { kind: 'press', keys: 'Escape' }, next: start + 1 };
  }
  if (second === 0x5b /* [ */) return decodeCsi(buffer, start);
  if (second === 0x4f /* O */) {
    const final = buffer[start + 2];
    if (final === undefined) return 'incomplete';
    const char = String.fromCharCode(final);
    const key = SS3_FUNCTION_FINALS[char] ?? CURSOR_FINALS[char];
    if (key === undefined) {
      return { input: { kind: 'raw', bytes: buffer.subarray(start, start + 3) }, next: start + 3 };
    }
    return { input: { kind: 'press', keys: key }, next: start + 3 };
  }
  // ESC <char>: Alt-prefixed key, the way every terminal delivers it.
  if (second === ESC) return { input: { kind: 'press', keys: 'Escape' }, next: start + 1 };
  if (second >= 0x20 && second !== 0x7f) {
    const char = String.fromCharCode(second);
    return { input: { kind: 'press', keys: `Alt+${char}` }, next: start + 2 };
  }
  return { input: { kind: 'press', keys: 'Escape' }, next: start + 1 };
}

function decodeCsi(buffer: Uint8Array, start: number): EscapeResult {
  let index = start + 2;
  while (index < buffer.length) {
    const byte = buffer[index] as number;
    if (byte >= 0x40 && byte <= 0x7e) break;
    index += 1;
  }
  if (index >= buffer.length) return 'incomplete';
  const final = String.fromCharCode(buffer[index] as number);
  const params = decodeUtf8(buffer.subarray(start + 2, index));
  const next = index + 1;
  const modifier = modifierPrefix(params);

  if (final === '~') {
    const code = Number.parseInt(params.split(';')[0] ?? '', 10);
    const key = TILDE_KEYS[code];
    if (key === undefined) {
      return { input: { kind: 'raw', bytes: buffer.subarray(start, next) }, next };
    }
    return { input: { kind: 'press', keys: `${modifier}${key}` }, next };
  }
  if (final === 'Z') return { input: { kind: 'press', keys: 'Shift+Tab' }, next };
  const cursor = CURSOR_FINALS[final];
  if (cursor !== undefined) {
    return { input: { kind: 'press', keys: `${modifier}${cursor}` }, next };
  }
  return { input: { kind: 'raw', bytes: buffer.subarray(start, next) }, next };
}

/** `CSI 1;5A` → `Control+`. Mirrors the encoder's modifier parameter. */
function modifierPrefix(params: string): string {
  const parts = params.split(';');
  const value = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(value) || value <= 1) return '';
  const bits = value - 1;
  let prefix = '';
  if ((bits & 4) !== 0) prefix += 'Control+';
  if ((bits & 2) !== 0) prefix += 'Alt+';
  if ((bits & 1) !== 0) prefix += 'Shift+';
  return prefix;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function startsWithAscii(buffer: Uint8Array, text: string, at: number): boolean {
  if (at + text.length > buffer.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (buffer[at + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function indexOfAscii(buffer: Uint8Array, text: string, from: number): number {
  for (let index = from; index + text.length <= buffer.length; index += 1) {
    if (startsWithAscii(buffer, text, index)) return index;
  }
  return -1;
}

const utf8 = new TextDecoder('utf-8');

function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

/** Length of the prefix of `bytes` that ends on a complete UTF-8 character. */
function completeUtf8Length(bytes: Uint8Array): number {
  for (let back = 1; back <= 3 && back <= bytes.length; back += 1) {
    const byte = bytes[bytes.length - back] as number;
    if ((byte & 0xc0) === 0x80) continue; // continuation byte
    const expected = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return expected > back ? bytes.length - back : bytes.length;
  }
  return bytes.length;
}
