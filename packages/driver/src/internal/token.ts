/**
 * Constant-time comparison for the handshake token.
 *
 * `@termwright/protocol` owns token *generation* (`generateToken`); the driver
 * owns the comparison because it is the only side that holds the expected
 * value.
 *
 * @internal
 */
import { timingSafeEqual } from 'node:crypto';

/** True when `received` is a string equal to `expected`, compared in constant time. */
export function tokenMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
