/**
 * `@termwright/logs` — application log capture for terminal tests.
 *
 * A TUI cannot print diagnostics to the screen without corrupting its own
 * render, so applications write them to a logger instead — where a test can no
 * longer see them. This package carries those records to termwright over the
 * `termwright:log` diagnostics channel, so `LOG.error(...)` becomes assertable
 * test state.
 *
 * Two properties make it safe to leave wired up in production code:
 * publishing costs nothing when no termwright session is listening, and
 * secrets are redacted at ingress, before any subscriber sees a record.
 */

export {
  LOG_CHANNEL_NAME,
  getLogChannel,
  hasLogSubscribers,
  nextLogSequence,
  publishLog,
  resetLogSequence,
  subscribeToLogs,
  type PublishOptions,
  type SubscribeOptions,
} from './channel.js';

export {
  normalizeLogRecord,
  redactRecord,
  toLogLevel,
  truncateToBytes,
  type LogInput,
  type NormalizeOptions,
} from './normalize.js';

export {
  DEFAULT_SECRET_KEY_PATTERN,
  DEFAULT_SECRET_VALUE_PATTERNS,
  REDACTED,
  isSecretKey,
  redactAttr,
  redactText,
  resolveRedaction,
  type RedactionOptions,
  type ResolvedRedaction,
} from './redact.js';

export {
  LOG_LEVELS,
  LOG_LEVEL_SEVERITY,
  MAX_LOG_ATTRS,
  type LogAttrValue,
  type LogLevel,
  type LogRecord,
} from '@termwright/protocol';
