/**
 * pino bridge.
 *
 * pino writes newline-delimited JSON to a *destination*: any object with a
 * `write(chunk: string)` method. Following `pino-test`, we implement that
 * interface rather than wrapping pino, so this module needs no pino import and
 * works with every pino major that keeps the NDJSON contract.
 *
 * ```ts
 * import pino from 'pino';
 * import { termwrightDestination } from '@termwright/logs/pino';
 *
 * const logger = pino({ level: 'trace' }, termwrightDestination());
 * ```
 */

import { publishLog, type PublishOptions } from './channel.js';
import type { LogInput } from './normalize.js';

/** The subset of a pino destination we implement. */
export interface PinoDestination {
  write(chunk: string): void;
}

/** Settings for {@link termwrightDestination}. */
export interface PinoBridgeOptions extends PublishOptions {
  /**
   * Keep pino's `pid`/`hostname` bindings as attributes. Default `true`; turn
   * it off when every record comes from the same process anyway.
   */
  readonly includeProcessBindings?: boolean;
  /** Called for a line that is not valid pino NDJSON. Default: ignore. */
  readonly onUnparsable?: (line: string) => void;
}

/** pino record fields consumed as record fields rather than attributes. */
const PINO_RESERVED = new Set(['level', 'time', 'msg', 'name', 'v']);
const PROCESS_BINDINGS = new Set(['pid', 'hostname']);

/**
 * Convert one parsed pino record into loose input.
 *
 * pino levels are numeric on the same scale the normaliser understands
 * (10 trace … 60 fatal), so the level passes straight through.
 */
function toInput(parsed: Record<string, unknown>, includeBindings: boolean): LogInput {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (PINO_RESERVED.has(key)) continue;
    if (!includeBindings && PROCESS_BINDINGS.has(key)) continue;
    attrs[key] = value;
  }
  const input: Record<string, unknown> = {
    level: parsed['level'],
    message: parsed['msg'],
    attrs,
  };
  if (typeof parsed['time'] === 'number') input['time'] = parsed['time'];
  if (typeof parsed['name'] === 'string') input['logger'] = parsed['name'];
  return input as LogInput;
}

/**
 * Build a pino destination that republishes records to termwright.
 *
 * Chunks may contain several newline-delimited records; each is parsed
 * independently, so one malformed line cannot swallow the rest.
 *
 * @param options - Publishing, redaction and binding settings.
 */
export function termwrightDestination(options: PinoBridgeOptions = {}): PinoDestination {
  const includeBindings = options.includeProcessBindings ?? true;

  return {
    write(chunk: string): void {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          options.onUnparsable?.(trimmed);
          continue;
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          options.onUnparsable?.(trimmed);
          continue;
        }
        publishLog(() => toInput(parsed as Record<string, unknown>, includeBindings), options);
      }
    },
  };
}
