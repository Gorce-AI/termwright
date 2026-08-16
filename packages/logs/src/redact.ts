/**
 * Secret redaction, applied at ingress.
 *
 * Logs are the classic accidental exfiltration path: a request header, a
 * connection string or a stack frame carrying a token ends up in a trace
 * archive, an HTML report, and eventually a bug tracker. Redaction therefore
 * runs before a record reaches any subscriber, not at render time — once an
 * unredacted record has been handed out, it is already too late.
 */

import type { LogAttrValue } from '@termwright/protocol';

/** Text substituted for a redacted value. */
export const REDACTED = '[redacted]';

/**
 * Attribute names whose value is always replaced, whatever it looks like.
 * Matched case-insensitively against the whole key and each dotted segment.
 */
export const DEFAULT_SECRET_KEY_PATTERN =
  /(?:^|[._-])(?:pass(?:word|wd)?|secret|token|api[._-]?key|apikey|auth(?:orization)?|credential|cookie|session[._-]?id|private[._-]?key|access[._-]?key)(?:$|[._-])/i;

/**
 * Value shapes redacted wherever they appear, including inside message text.
 *
 * Deliberately anchored on *recognisable credential formats* rather than on
 * entropy alone: a generic "looks random" rule redacts hashes, request ids and
 * git SHAs, which destroys the diagnostic value of the log without protecting
 * anything.
 */
export const DEFAULT_SECRET_VALUE_PATTERNS: readonly RegExp[] = Object.freeze([
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, // JWT
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bsk-[A-Za-z0-9]{20,}\b/g, // OpenAI-style
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@/gi, // credentials in a URL
]);

/** How to redact. Every field has a conservative default. */
export interface RedactionOptions {
  /** Attribute keys whose values are always replaced. */
  readonly keyPattern?: RegExp;
  /** Value shapes replaced wherever they appear. */
  readonly valuePatterns?: readonly RegExp[];
  /** Replacement text. */
  readonly replacement?: string;
  /** Set false to pass records through untouched (never the default). */
  readonly enabled?: boolean;
}

/** Fully resolved redaction settings. */
export interface ResolvedRedaction {
  readonly keyPattern: RegExp;
  readonly valuePatterns: readonly RegExp[];
  readonly replacement: string;
  readonly enabled: boolean;
}

/**
 * Resolve user options against the defaults.
 *
 * @param options - Partial settings; omitted fields take the default.
 */
export function resolveRedaction(options: RedactionOptions = {}): ResolvedRedaction {
  return Object.freeze({
    keyPattern: options.keyPattern ?? DEFAULT_SECRET_KEY_PATTERN,
    valuePatterns: options.valuePatterns ?? DEFAULT_SECRET_VALUE_PATTERNS,
    replacement: options.replacement ?? REDACTED,
    enabled: options.enabled ?? true,
  });
}

/**
 * Replace credential-shaped substrings in free text.
 *
 * @param text - Text to scan, typically a log message.
 * @param redaction - Resolved settings.
 */
export function redactText(text: string, redaction: ResolvedRedaction): string {
  if (!redaction.enabled) return text;
  let result = text;
  for (const pattern of redaction.valuePatterns) {
    // Patterns are module-level and carry /g, so reset before each use:
    // lastIndex survives between calls and would skip matches otherwise.
    pattern.lastIndex = 0;
    result = result.replace(pattern, redaction.replacement);
  }
  return result;
}

/**
 * Decide whether an attribute key is secret by name.
 *
 * @param key - Attribute key, possibly dotted (`headers.authorization`).
 * @param redaction - Resolved settings.
 */
export function isSecretKey(key: string, redaction: ResolvedRedaction): boolean {
  if (!redaction.enabled) return false;
  redaction.keyPattern.lastIndex = 0;
  if (redaction.keyPattern.test(key)) return true;
  return key
    .split('.')
    .some((segment) => {
      redaction.keyPattern.lastIndex = 0;
      return redaction.keyPattern.test(segment) || redaction.keyPattern.test(`_${segment}_`);
    });
}

/**
 * Redact one attribute value, by key name first and then by value shape.
 *
 * @param key - Attribute key.
 * @param value - Scalar attribute value.
 * @param redaction - Resolved settings.
 */
export function redactAttr(
  key: string,
  value: LogAttrValue,
  redaction: ResolvedRedaction,
): LogAttrValue {
  if (!redaction.enabled) return value;
  if (isSecretKey(key, redaction)) return redaction.replacement;
  return typeof value === 'string' ? redactText(value, redaction) : value;
}
