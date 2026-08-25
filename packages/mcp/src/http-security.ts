/**
 * Security policy for the Streamable HTTP transport.
 *
 * This module deliberately knows nothing about MCP messages or sessions. It is
 * the admission boundary in front of both: rate limit the peer, apply the
 * browser Origin policy, then authenticate the bearer. Only an admitted
 * request may reach routing, body parsing or the session registry.
 */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Defaults are conservative for an interactive protocol and cheap to raise explicitly. */
export const DEFAULT_HTTP_RATE_LIMIT = Object.freeze({
  windowMs: 60_000,
  maxRequests: 120,
  maxClients: 1_024,
});

/** Bounded fixed-window admission policy, keyed by the TCP peer address. */
export interface HttpRateLimitOptions {
  readonly windowMs?: number;
  readonly maxRequests?: number;
  readonly maxClients?: number;
}

interface RateBucket {
  readonly startedAt: number;
  requests: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/**
 * A rate limiter whose own memory is bounded. When all client slots are active,
 * a new identity is refused instead of evicting an active bucket and thereby
 * letting an address-rotation attack reset counters.
 */
export class BoundedRateLimiter {
  readonly #windowMs: number;
  readonly #maxRequests: number;
  readonly #maxClients: number;
  readonly #buckets = new Map<string, RateBucket>();

  constructor(options: HttpRateLimitOptions = {}) {
    this.#windowMs = positiveInteger(options.windowMs ?? DEFAULT_HTTP_RATE_LIMIT.windowMs, 'rateLimit.windowMs');
    this.#maxRequests = positiveInteger(options.maxRequests ?? DEFAULT_HTTP_RATE_LIMIT.maxRequests, 'rateLimit.maxRequests');
    this.#maxClients = positiveInteger(options.maxClients ?? DEFAULT_HTTP_RATE_LIMIT.maxClients, 'rateLimit.maxClients');
  }

  /** Visible for deterministic tests and operational diagnostics. */
  get size(): number {
    return this.#buckets.size;
  }

  admit(identity: string, now: number): RateLimitDecision {
    if (!Number.isFinite(now)) throw new TypeError('rate-limit clock must return a finite number');
    let bucket = this.#buckets.get(identity);
    if (bucket !== undefined && now - bucket.startedAt >= this.#windowMs) {
      this.#buckets.delete(identity);
      bucket = undefined;
    }

    if (bucket === undefined) {
      if (this.#buckets.size >= this.#maxClients) this.#purgeExpired(now);
      if (this.#buckets.size >= this.#maxClients) {
        return { allowed: false, retryAfterSeconds: this.#retryForOldest(now) };
      }
      this.#buckets.set(identity, { startedAt: now, requests: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (bucket.requests >= this.#maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: secondsUntil(bucket.startedAt + this.#windowMs, now),
      };
    }
    bucket.requests += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  #purgeExpired(now: number): void {
    for (const [identity, bucket] of this.#buckets) {
      if (now - bucket.startedAt >= this.#windowMs) this.#buckets.delete(identity);
    }
  }

  #retryForOldest(now: number): number {
    let oldestExpiry = Number.POSITIVE_INFINITY;
    for (const bucket of this.#buckets.values()) {
      oldestExpiry = Math.min(oldestExpiry, bucket.startedAt + this.#windowMs);
    }
    return Number.isFinite(oldestExpiry) ? secondsUntil(oldestExpiry, now) : 1;
  }
}

/** Exact origins accepted from browser-like clients. Missing Origin is allowed. */
export function normalizeAllowedOrigins(origins: readonly string[] = []): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const candidate of origins) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new TypeError(`allowed origin is not a URL: ${JSON.stringify(candidate)}`);
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '' ||
        url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new TypeError(`allowed origin must be an HTTP(S) origin without path, query or credentials: ${JSON.stringify(candidate)}`);
    }
    normalized.add(url.origin);
  }
  return normalized;
}

/** True only for an explicit loopback address or the conventional localhost name. */
export function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/gu, '');
  if (lower === 'localhost' || lower === '::1') return true;
  if (isIP(lower) === 4) return lower.split('.')[0] === '127';
  return /^::ffff:127(?:\.\d{1,3}){3}$/u.test(lower);
}

export interface HttpAdmissionOptions {
  readonly token: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly authenticatedRateLimiter: BoundedRateLimiter;
  readonly preflightRateLimiter: BoundedRateLimiter;
  readonly now: () => number;
}

/**
 * Applies the complete admission policy and writes the rejection response.
 * Returns only after headers have been decided; it never consumes request data.
 */
export function admitHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpAdmissionOptions,
): boolean {
  const identity = request.socket.remoteAddress ?? '<unknown-peer>';
  const origin = request.headers.origin;
  if (origin !== undefined && (Array.isArray(origin) || !options.allowedOrigins.has(origin))) {
    sendSecurityError(response, 403, 'origin is not allowed');
    return false;
  }
  if (typeof origin === 'string') {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-expose-headers', 'Mcp-Session-Id');
    response.setHeader('vary', 'Origin');
    if (request.method === 'OPTIONS') {
      if (!admitRate(identity, response, options.preflightRateLimiter, options.now)) return false;
      return admitPreflight(request, response);
    }
  }

  if (!bearerMatches(request.headers.authorization, options.token)) {
    sendSecurityError(response, 401, 'missing or invalid bearer token', {
      'www-authenticate': 'Bearer realm="termwright-mcp"',
    });
    return false;
  }
  if (!admitRate(identity, response, options.authenticatedRateLimiter, options.now)) return false;
  return true;
}

function admitRate(
  identity: string,
  response: ServerResponse,
  limiter: BoundedRateLimiter,
  now: () => number,
): boolean {
  const rate = limiter.admit(identity, now());
  if (rate.allowed) return true;
  sendSecurityError(response, 429, 'rate limit exceeded', {
    'retry-after': String(rate.retryAfterSeconds),
  });
  return false;
}

const CORS_METHODS = new Set(['GET', 'POST', 'DELETE']);
const CORS_HEADERS = new Set([
  'accept',
  'authorization',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
]);

/** A preflight authorizes no MCP operation, but remains origin- and rate-limited. */
function admitPreflight(request: IncomingMessage, response: ServerResponse): false {
  const method = request.headers['access-control-request-method'];
  const requestedHeaders = (request.headers['access-control-request-headers'] ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter((header) => header !== '');
  if (typeof method !== 'string' || !CORS_METHODS.has(method.toUpperCase()) ||
      requestedHeaders.some((header) => !CORS_HEADERS.has(header))) {
    sendSecurityError(response, 403, 'CORS preflight is not allowed');
    return false;
  }
  response.writeHead(204, {
    'access-control-allow-methods': [...CORS_METHODS].join(', '),
    'access-control-allow-headers': [...CORS_HEADERS].join(', '),
    'access-control-max-age': '600',
  });
  response.end();
  return false;
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length);
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendSecurityError(
  response: ServerResponse,
  status: number,
  error: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  const text = JSON.stringify({ error });
  // Rejections never reuse the connection: an unauthenticated peer that
  // declared a large body cannot keep streaming it after admission failed.
  response.writeHead(status, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-type': 'application/json',
    ...headers,
  });
  response.end(text);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function secondsUntil(deadline: number, now: number): number {
  return Math.max(1, Math.ceil((deadline - now) / 1_000));
}
