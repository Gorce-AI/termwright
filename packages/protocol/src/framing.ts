/**
 * Wire framing: 4-byte big-endian unsigned length prefix + UTF-8 JSON body.
 * The length is checked against limits.maxFrameBytes BEFORE any decoding;
 * oversized, partial or duplicated frames fail closed with a typed error.
 * Decoded values MUST be projected into immutable plain DTOs (no accessors,
 * proxies, symbols, functions, non-plain prototypes) before retention.
 */

export interface FrameDecoder {
  /** Feed raw bytes; returns fully decoded, validated, frozen messages. */
  push(chunk: Uint8Array): readonly unknown[];
  /** Bytes currently buffered (bounded by maxFrameBytes + 4). */
  readonly buffered: number;
}

export declare function createFrameDecoder(maxFrameBytes: number): FrameDecoder;
export declare function encodeFrame(message: unknown, maxFrameBytes: number): Uint8Array;

/**
 * Deep-project an untrusted parsed value into a frozen, plain, JSON-safe DTO.
 * Throws ProtocolViolation on aliases, cycles, sparse arrays, accessors,
 * non-JSON scalars, or depth/size beyond limits.
 */
export declare function projectDto<T>(value: unknown, maxDepth: number): T;
