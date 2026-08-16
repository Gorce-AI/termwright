/**
 * The one channel between a test and a fixture process: a bounded JSON
 * document.
 *
 * Props cross a process boundary here, and the rule is absolute — the fixture
 * runner parses JSON and nothing else. It never evaluates code from the test,
 * never resolves a callback, and never reconstructs a class. What cannot be
 * expressed as JSON is rejected *here*, with a message naming the offending
 * path, rather than being silently dropped by `JSON.stringify` and turning into
 * an `undefined` prop three seconds later inside a child process.
 */

import { CapacityError, UnsupportedActionError } from '@termwright/driver';

/** A value that survives the crossing to a fixture process. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Props for a fixture component: a JSON object, never a function. */
export type JsonProps = { readonly [key: string]: JsonValue };

/** What the fixture runner receives on its command line. */
export interface FixturePayload {
  /** Payload format version; the runner refuses anything else. */
  readonly v: 1;
  /** `file:` URL of the module holding the component. */
  readonly module: string;
  /** Named export to render. `default` unless overridden. */
  readonly exportName: string;
  /** Props handed to the component. */
  readonly props: JsonProps;
  /** Ink's frame cap, mirrored from the mount defaults for parity. */
  readonly maxFps: number;
}

/**
 * Largest serialized payload accepted, in bytes.
 *
 * The payload travels as a command-line argument, so this ceiling has to fit
 * the narrowest platform's command line, not the roomiest. Windows caps a whole
 * command line at 32,767 characters — a limit the *operating system* enforces
 * at spawn, long before any code of ours runs. A larger ceiling here would mean
 * accepting props that then die as a raw `ENAMETOOLONG` with nothing to say
 * about what went wrong, and only on one OS.
 *
 * 24 KiB leaves roughly 8 KiB for the interpreter path, the runner path and
 * quoting, which is ample even in a deeply nested CI checkout.
 */
export const MAX_PAYLOAD_BYTES = 24 * 1024;

/** Deepest object/array nesting accepted in props. */
export const MAX_PROPS_DEPTH = 8;

/**
 * Serializes a payload for `argv`.
 *
 * @throws UnsupportedActionError when props contain something JSON cannot carry
 * (a function, a symbol, `undefined`, a `bigint`, a cycle) or nest too deeply
 * @throws CapacityError when the result exceeds {@link MAX_PAYLOAD_BYTES}
 */
export function encodeFixturePayload(payload: FixturePayload): string {
  assertJsonProps(payload.props);
  const text = JSON.stringify(payload);
  const size = Buffer.byteLength(text, 'utf8');
  if (size > MAX_PAYLOAD_BYTES) {
    throw new CapacityError(
      `fixture props serialize to ${size} bytes, over the ${MAX_PAYLOAD_BYTES}-byte limit`,
      {
        semanticTree: false,
        suggestion: 'pass a small identifier and let the fixture module load the bulk itself',
      },
    );
  }
  return text;
}

/**
 * Validates that a props object can cross the boundary intact.
 *
 * @throws UnsupportedActionError naming the path of the first value that cannot
 */
export function assertJsonProps(props: JsonProps): void {
  assertJsonValue(props, '$', 0, new Set<object>());
}

function assertJsonValue(value: unknown, path: string, depth: number, seen: Set<object>): void {
  if (depth > MAX_PROPS_DEPTH) {
    throw reject(path, `nests deeper than ${MAX_PROPS_DEPTH} levels`);
  }
  if (value === null) return;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) throw reject(path, `is ${String(value)}, which JSON cannot represent`);
      return;
    case 'undefined':
      throw reject(path, 'is undefined; omit the key or use null');
    case 'function':
      throw reject(
        path,
        'is a function; a fixture runs in another process, so use mountInk for callback assertions',
      );
    case 'bigint':
      throw reject(path, 'is a bigint; pass it as a string');
    case 'symbol':
      throw reject(path, 'is a symbol');
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) throw reject(path, 'is part of a cycle');
  seen.add(object);

  if (Array.isArray(object)) {
    object.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1, seen));
  } else {
    const prototype = Object.getPrototypeOf(object) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw reject(path, `is a ${object.constructor?.name ?? 'class'} instance; pass plain data`);
    }
    for (const [key, item] of Object.entries(object)) {
      assertJsonValue(item, `${path}.${key}`, depth + 1, seen);
    }
  }

  seen.delete(object);
}

function reject(path: string, reason: string): UnsupportedActionError {
  return new UnsupportedActionError(`fixture prop ${path} ${reason}`, {
    semanticTree: false,
    suggestion: 'fixture props are transferred as JSON; everything else has to stay in-process',
  });
}
