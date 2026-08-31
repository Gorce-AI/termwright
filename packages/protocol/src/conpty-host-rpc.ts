/** Private, request-addressed cursor synchronization used by Termwright's ConPTY host. */
export const CONPTY_HOST_CURSOR_OSC_CODE = 8488;

/** Versioned payload prefix inside the host-reserved OSC 8488 namespace. */
export const CONPTY_HOST_CURSOR_PREFIX = 'twh-cpr-v1';

const TOKEN = '[0-9a-f]{32}';
const REQUEST = new RegExp(`^${CONPTY_HOST_CURSOR_PREFIX}:q:(${TOKEN})$`, 'u');
const RESPONSE = new RegExp(
  `^\\x1b\\]${CONPTY_HOST_CURSOR_OSC_CODE};${CONPTY_HOST_CURSOR_PREFIX}:r:(${TOKEN}):([1-9][0-9]{0,4}):([1-9][0-9]{0,4})\\x07$`,
  'u',
);
const MAX_COORDINATE = 32_768;

export interface ConPtyHostCursorRequest {
  readonly token: string;
}

export interface ConPtyHostCursorResponse extends ConPtyHostCursorRequest {
  readonly row: number;
  readonly column: number;
}

/** Parses the payload delivered by an OSC 8488 handler, after `8488;`. */
export function parseConPtyHostCursorRequest(payload: string): ConPtyHostCursorRequest | null {
  const match = REQUEST.exec(payload);
  return match?.[1] === undefined ? null : { token: match[1] };
}

/** Encodes the only reply the patched native host consumes. Coordinates are one-based. */
export function encodeConPtyHostCursorResponse(
  request: ConPtyHostCursorRequest,
  row: number,
  column: number,
): string {
  if (!new RegExp(`^${TOKEN}$`, 'u').test(request.token)) {
    throw new TypeError('ConPTY host cursor token must be 128-bit lowercase hexadecimal');
  }
  for (const [name, value] of [
    ['row', row],
    ['column', column],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_COORDINATE) {
      throw new RangeError(`ConPTY host cursor ${name} must be an integer from 1 to 32768`);
    }
  }
  return `\x1b]${CONPTY_HOST_CURSOR_OSC_CODE};${CONPTY_HOST_CURSOR_PREFIX}:r:${request.token}:${row}:${column}\x07`;
}

/** Strictly recognizes a complete host reply before the PTY chooses its input transport. */
export function parseConPtyHostCursorResponse(
  value: Uint8Array | string,
): ConPtyHostCursorResponse | null {
  const text =
    typeof value === 'string' ? value : new TextDecoder('ascii', { fatal: true }).decode(value);
  const match = RESPONSE.exec(text);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  const row = Number(match[2]);
  const column = Number(match[3]);
  if (row > MAX_COORDINATE || column > MAX_COORDINATE) return null;
  return { token: match[1], row, column };
}
