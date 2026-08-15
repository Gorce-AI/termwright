/**
 * Typed protocol failures. Everything in this package fails closed: a hostile
 * or merely malformed input never produces a partially-trusted value, it
 * produces a {@link ProtocolViolation} (imperative APIs) or a structured
 * `{ ok: false }` result (validation APIs).
 */

/** Machine-readable reason a value was rejected. */
export type ProtocolViolationCode =
  /** Declared frame length exceeds the negotiated ceiling. */
  | 'frame-oversized'
  /** Frame header/body is structurally impossible (zero length, bad JSON). */
  | 'frame-malformed'
  /** Frame body is not well-formed UTF-8. */
  | 'frame-encoding'
  /** Decoder already failed; it is poisoned and refuses further input. */
  | 'decoder-poisoned'
  /** Value is not representable as JSON (undefined, bigint, function, NaN…). */
  | 'dto-scalar'
  /** String contains unpaired surrogates. */
  | 'dto-string'
  /** Object graph is not a tree: the same object is reachable twice. */
  | 'dto-alias'
  /** Property is an accessor (getter/setter) rather than plain data. */
  | 'dto-accessor'
  /** Value carries symbol keys. */
  | 'dto-symbol'
  /** Value is a Proxy, or has a prototype other than Object/Array/null. */
  | 'dto-prototype'
  /** Array has holes or extra own properties. */
  | 'dto-sparse'
  /** Property name is reserved (`__proto__`, `constructor`, `prototype`). */
  | 'dto-key'
  /** Nesting exceeds the permitted depth. */
  | 'dto-depth'
  /** A marker argument is outside its permitted domain. */
  | 'marker-argument';

/**
 * Thrown when untrusted input violates a protocol invariant.
 *
 * Never carries the offending value or the session token — only a code and a
 * short structural description safe to log.
 */
export class ProtocolViolation extends Error {
  /** Machine-readable reason. */
  readonly code: ProtocolViolationCode;

  constructor(code: ProtocolViolationCode, message: string) {
    super(message);
    this.name = 'ProtocolViolation';
    this.code = code;
  }
}
