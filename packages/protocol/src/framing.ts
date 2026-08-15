/**
 * Wire framing: 4-byte big-endian unsigned length prefix + UTF-8 JSON body.
 * The length is checked against limits.maxFrameBytes BEFORE any decoding;
 * oversized, partial or duplicated frames fail closed with a typed error.
 * Decoded values MUST be projected into immutable plain DTOs (no accessors,
 * proxies, symbols, functions, non-plain prototypes) before retention.
 */

import { types } from 'node:util';
import { ProtocolViolation } from './errors.js';
import { DEFAULT_LIMITS } from './limits.js';

export interface FrameDecoder {
  /** Feed raw bytes; returns fully decoded, validated, frozen messages. */
  push(chunk: Uint8Array): readonly unknown[];
  /** Bytes currently buffered (bounded by maxFrameBytes + 4). */
  readonly buffered: number;
}

/** Size of the big-endian length prefix that precedes every frame body. */
export const FRAME_HEADER_BYTES = 4;

/**
 * Structural nesting ceiling applied to every decoded frame.
 *
 * The decoder signature carries only a byte ceiling, so projection uses this
 * fixed structural bound; message-specific limits are applied later by
 * `parseAdapterMessage`/`parseDriverMessage` and `validateSnapshot`.
 */
const FRAME_PROJECTION_DEPTH = DEFAULT_LIMITS.maxDepth;

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Matches any unpaired surrogate code unit. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const encoder = new TextEncoder();
/** `fatal` makes malformed UTF-8 throw instead of yielding U+FFFD. */
const decoder = new TextDecoder('utf-8', { fatal: true });

function assertPositiveByteCeiling(maxFrameBytes: number): void {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
    throw new ProtocolViolation(
      'frame-malformed',
      'maxFrameBytes must be a positive safe integer',
    );
  }
}

class BufferedFrameDecoder implements FrameDecoder {
  readonly #maxFrameBytes: number;
  #buffer: Uint8Array;
  /** Offset of the first unconsumed byte in `#buffer`. */
  #start = 0;
  /** Offset just past the last buffered byte in `#buffer`. */
  #end = 0;
  #failure: ProtocolViolation | null = null;

  constructor(maxFrameBytes: number) {
    assertPositiveByteCeiling(maxFrameBytes);
    this.#maxFrameBytes = maxFrameBytes;
    this.#buffer = new Uint8Array(0);
  }

  get buffered(): number {
    return this.#end - this.#start;
  }

  push(chunk: Uint8Array): readonly unknown[] {
    if (this.#failure !== null) {
      throw new ProtocolViolation(
        'decoder-poisoned',
        `decoder failed earlier (${this.#failure.code}) and accepts no further input`,
      );
    }
    try {
      return this.#pushOrThrow(chunk);
    } catch (error) {
      this.#failure =
        error instanceof ProtocolViolation
          ? error
          : new ProtocolViolation('frame-malformed', 'frame decoding failed');
      // Release the buffer: a poisoned decoder never resumes.
      this.#buffer = new Uint8Array(0);
      this.#start = 0;
      this.#end = 0;
      throw this.#failure;
    }
  }

  #pushOrThrow(chunk: Uint8Array): readonly unknown[] {
    this.#append(chunk);
    const messages: unknown[] = [];

    for (;;) {
      const available = this.#end - this.#start;
      if (available < FRAME_HEADER_BYTES) break;

      const length = this.#readLength();
      if (length === 0) {
        throw new ProtocolViolation('frame-malformed', 'frame length must be non-zero');
      }
      if (length > this.#maxFrameBytes) {
        throw new ProtocolViolation(
          'frame-oversized',
          `frame declares ${length} bytes, ceiling is ${this.#maxFrameBytes}`,
        );
      }
      if (available < FRAME_HEADER_BYTES + length) break; // partial: wait for more

      const bodyStart = this.#start + FRAME_HEADER_BYTES;
      const body = this.#buffer.subarray(bodyStart, bodyStart + length);
      messages.push(decodeBody(body));
      this.#start = bodyStart + length;
    }

    this.#compact();
    if (this.buffered > this.#maxFrameBytes + FRAME_HEADER_BYTES) {
      throw new ProtocolViolation(
        'frame-oversized',
        `buffered ${this.buffered} bytes without a complete frame`,
      );
    }
    return messages;
  }

  #readLength(): number {
    const b = this.#buffer;
    const i = this.#start;
    // Non-null assertions are safe: the caller checked 4 bytes are available.
    return (
      (b[i]! * 0x1000000 + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!)) >>> 0
    );
  }

  #append(chunk: Uint8Array): void {
    const kept = this.#end - this.#start;
    const needed = kept + chunk.length;
    if (needed > this.#buffer.length - this.#start) {
      const next = new Uint8Array(needed);
      next.set(this.#buffer.subarray(this.#start, this.#end), 0);
      this.#buffer = next;
      this.#start = 0;
      this.#end = kept;
    }
    this.#buffer.set(chunk, this.#end);
    this.#end += chunk.length;
  }

  #compact(): void {
    if (this.#start === 0) return;
    const kept = this.#end - this.#start;
    if (kept === 0) {
      this.#buffer = new Uint8Array(0);
    } else {
      const next = new Uint8Array(kept);
      next.set(this.#buffer.subarray(this.#start, this.#end), 0);
      this.#buffer = next;
    }
    this.#start = 0;
    this.#end = kept;
  }
}

function decodeBody(body: Uint8Array): unknown {
  let text: string;
  try {
    text = decoder.decode(body);
  } catch {
    throw new ProtocolViolation('frame-encoding', 'frame body is not valid UTF-8');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // Also covers RangeError from pathologically nested JSON.
    throw new ProtocolViolation('frame-malformed', 'frame body is not valid JSON');
  }
  return projectDto(parsed, FRAME_PROJECTION_DEPTH);
}

/**
 * Create a streaming decoder for length-prefixed JSON frames.
 *
 * A frame whose declared length exceeds `maxFrameBytes` is rejected before its
 * body is read. Any violation poisons the decoder permanently: subsequent
 * `push` calls throw rather than resynchronising on attacker-chosen offsets.
 *
 * @param maxFrameBytes - Per-frame byte ceiling; must be a positive safe integer.
 * @throws {ProtocolViolation} On an invalid ceiling, or (from `push`) on any
 * oversized, malformed, non-UTF-8 or non-projectable frame.
 */
export function createFrameDecoder(maxFrameBytes: number): FrameDecoder {
  return new BufferedFrameDecoder(maxFrameBytes);
}

/**
 * Serialise a message into a single length-prefixed frame.
 *
 * @param message - A JSON-representable value.
 * @param maxFrameBytes - Per-frame byte ceiling applied to the encoded body.
 * @returns Header + UTF-8 JSON body, ready to write to the transport.
 * @throws {ProtocolViolation} If the value is not JSON-representable or the
 * encoded body exceeds `maxFrameBytes`.
 */
export function encodeFrame(message: unknown, maxFrameBytes: number): Uint8Array {
  assertPositiveByteCeiling(maxFrameBytes);

  let text: string | undefined;
  try {
    text = JSON.stringify(message);
  } catch {
    throw new ProtocolViolation('frame-malformed', 'message is not JSON-serialisable');
  }
  if (text === undefined) {
    throw new ProtocolViolation('dto-scalar', 'message serialises to undefined');
  }

  const body = encoder.encode(text);
  if (body.length > maxFrameBytes) {
    throw new ProtocolViolation(
      'frame-oversized',
      `encoded frame is ${body.length} bytes, ceiling is ${maxFrameBytes}`,
    );
  }

  const frame = new Uint8Array(FRAME_HEADER_BYTES + body.length);
  const n = body.length;
  frame[0] = (n >>> 24) & 0xff;
  frame[1] = (n >>> 16) & 0xff;
  frame[2] = (n >>> 8) & 0xff;
  frame[3] = n & 0xff;
  frame.set(body, FRAME_HEADER_BYTES);
  return frame;
}

function projectScalar(value: unknown, path: string): string | number | boolean | null {
  if (value === null) return null;
  switch (typeof value) {
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ProtocolViolation('dto-scalar', `non-finite number at ${path}`);
      }
      return value;
    case 'string':
      if (LONE_SURROGATE.test(value)) {
        throw new ProtocolViolation('dto-string', `unpaired surrogate at ${path}`);
      }
      return value;
    default:
      throw new ProtocolViolation(
        'dto-scalar',
        `value of type ${typeof value} is not JSON-representable at ${path}`,
      );
  }
}

function projectNode(value: unknown, depth: number, maxDepth: number, seen: Set<object>, path: string): unknown {
  if (value === null || typeof value !== 'object') {
    return projectScalar(value, path);
  }
  if (depth > maxDepth) {
    throw new ProtocolViolation('dto-depth', `nesting exceeds ${maxDepth} at ${path}`);
  }
  if (types.isProxy(value)) {
    throw new ProtocolViolation('dto-prototype', `proxy at ${path}`);
  }
  if (seen.has(value)) {
    // Covers both cycles and plain aliasing (shared subtrees).
    throw new ProtocolViolation('dto-alias', `value is reachable more than once at ${path}`);
  }
  seen.add(value);

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ProtocolViolation('dto-symbol', `symbol-keyed property at ${path}`);
  }

  const proto: unknown = Object.getPrototypeOf(value);
  const result = Array.isArray(value)
    ? projectArray(value, proto, depth, maxDepth, seen, path)
    : projectObject(value, proto, depth, maxDepth, seen, path);

  // `seen` is never cleared: a value reachable twice is an alias, not a
  // legitimate repeat, and must be rejected rather than duplicated.
  return Object.freeze(result);
}

function projectArray(
  value: readonly unknown[],
  proto: unknown,
  depth: number,
  maxDepth: number,
  seen: Set<object>,
  path: string,
): unknown[] {
  if (proto !== Array.prototype) {
    throw new ProtocolViolation('dto-prototype', `array with exotic prototype at ${path}`);
  }
  const length = value.length;
  const out = new Array<unknown>(length);
  for (let i = 0; i < length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (descriptor === undefined) {
      throw new ProtocolViolation('dto-sparse', `hole at ${path}[${i}]`);
    }
    if (!('value' in descriptor)) {
      throw new ProtocolViolation('dto-accessor', `accessor at ${path}[${i}]`);
    }
    out[i] = projectNode(descriptor.value, depth + 1, maxDepth, seen, `${path}[${i}]`);
  }
  // Reject `length` plus anything that is not a dense index we just consumed.
  if (Object.getOwnPropertyNames(value).length !== length + 1) {
    throw new ProtocolViolation('dto-sparse', `array carries extra own properties at ${path}`);
  }
  return out;
}

function projectObject(
  value: object,
  proto: unknown,
  depth: number,
  maxDepth: number,
  seen: Set<object>,
  path: string,
): Record<string, unknown> {
  if (proto !== Object.prototype && proto !== null) {
    throw new ProtocolViolation('dto-prototype', `non-plain object at ${path}`);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    if (RESERVED_KEYS.has(key)) {
      throw new ProtocolViolation('dto-key', `reserved property name "${key}" at ${path}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) {
      throw new ProtocolViolation('dto-accessor', `accessor property "${key}" at ${path}`);
    }
    if (!descriptor.enumerable) {
      throw new ProtocolViolation('dto-key', `non-enumerable property "${key}" at ${path}`);
    }
    if (LONE_SURROGATE.test(key)) {
      throw new ProtocolViolation('dto-string', `unpaired surrogate in key at ${path}`);
    }
    out[key] = projectNode(descriptor.value, depth + 1, maxDepth, seen, `${path}.${key}`);
  }
  return out;
}

/**
 * Deep-project an untrusted parsed value into a frozen, plain, JSON-safe DTO.
 * Throws ProtocolViolation on aliases, cycles, sparse arrays, accessors,
 * non-JSON scalars, or depth/size beyond limits.
 *
 * Properties are inspected with `Object.getOwnPropertyDescriptor`, so a getter
 * on hostile input is detected and rejected without ever being invoked.
 *
 * @param value - Untrusted input, typically the result of `JSON.parse`.
 * @param maxDepth - Maximum nesting depth; the root sits at depth 0.
 * @returns A structurally identical, deep-frozen copy. The `T` type parameter
 * is an unchecked assertion — validate the shape separately.
 * @throws {ProtocolViolation}
 */
export function projectDto<T>(value: unknown, maxDepth: number): T {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new ProtocolViolation('dto-depth', 'maxDepth must be a non-negative safe integer');
  }
  return projectNode(value, 0, maxDepth, new Set<object>(), '$') as T;
}
