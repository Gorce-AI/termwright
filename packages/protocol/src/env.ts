import { randomBytes } from 'node:crypto';

/** Environment variable names injected by the driver before spawning the child. */
export const ENV_ENDPOINT = 'TERMWRIGHT_ENDPOINT';
export const ENV_TOKEN = 'TERMWRIGHT_TOKEN';
export const ENV_PROTOCOL = 'TERMWRIGHT_PROTOCOL';

/** Current protocol major version. */
export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_ID = 'termwright/1' as const;

/** Entropy behind a session token, in bytes (256 bits). */
export const TOKEN_BYTES = 32;

/**
 * Mint a session token for `TERMWRIGHT_TOKEN`.
 *
 * **The token is an opaque UTF-8 string end to end.** Whatever lands in the
 * env var is what both sides feed to the HMAC as the key — the driver must not
 * decode it back to bytes, and an adapter must not re-encode it. Honouring
 * that is what keeps non-JS clients (Python, Go, Rust) interoperable, since
 * they only ever see the string.
 *
 * The encoding here (base64url, 43 characters) is therefore a convention, not
 * a constraint: it is compact, shell-safe, and free of `=` padding.
 *
 * @returns A fresh 256-bit token. Never log or embed it; it authenticates the
 * render markers.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}
