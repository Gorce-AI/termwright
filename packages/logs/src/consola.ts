/**
 * consola bridge.
 *
 * consola dispatches every call to its *reporters*: objects with a
 * `log(logObj)` method. We implement that shape, so no consola import is
 * needed.
 *
 * ```ts
 * import { consola } from 'consola';
 * import { termwrightReporter } from '@termwright/logs/consola';
 *
 * consola.addReporter(termwrightReporter());
 * ```
 *
 * @remarks
 * consola's numeric `level` runs the opposite way to pino's (0 is the most
 * severe, not the least), so this bridge resolves severity from the `type`
 * string and never forwards the number to the generic normaliser.
 */

import type { LogLevel } from '@termwright/protocol';
import { publishLog, type PublishOptions } from './channel.js';
import type { LogInput } from './normalize.js';

/** The log object consola hands to a reporter. */
export interface ConsolaLogObject {
  readonly type?: string;
  readonly level?: number;
  readonly tag?: string;
  readonly date?: Date;
  readonly message?: unknown;
  readonly args?: readonly unknown[];
  readonly [key: string]: unknown;
}

/** Settings for {@link termwrightReporter}. */
export type ConsolaBridgeOptions = PublishOptions;

/** consola's reporter interface. */
export interface ConsolaReporter {
  log(logObj: ConsolaLogObject): void;
}

/** consola `type` → protocol level. Types absent here fall back to `info`. */
const TYPE_TO_LEVEL: Readonly<Record<string, LogLevel>> = Object.freeze({
  fatal: 'fatal',
  error: 'error',
  fail: 'error',
  warn: 'warn',
  log: 'info',
  info: 'info',
  success: 'info',
  ready: 'info',
  start: 'info',
  box: 'info',
  debug: 'debug',
  trace: 'trace',
  verbose: 'trace',
  silent: 'trace',
});

const CONSOLA_RESERVED = new Set(['type', 'level', 'tag', 'date', 'message', 'args']);

function formatArgs(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function toInput(logObj: ConsolaLogObject): LogInput {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(logObj)) {
    if (CONSOLA_RESERVED.has(key)) continue;
    attrs[key] = value;
  }

  // consola carries the call's arguments in `args` and normally has no
  // `message` field at all: `consola.info('hi', { a: 1 })` arrives as
  // args: ['hi', { a: 1 }]. Treat a leading string as the message and keep
  // everything after it as context, so structured extras never get glued
  // onto the end of the message text.
  const args = logObj.args ?? [];
  let message: string;
  let rest: readonly unknown[] = [];

  if (typeof args[0] === 'string') {
    message = args[0];
    rest = args.slice(1);
  } else if (typeof logObj.message === 'string' && logObj.message.length > 0) {
    message = logObj.message;
    rest = args;
  } else if (
    typeof args[0] === 'object' &&
    args[0] !== null &&
    typeof (args[0] as { message?: unknown }).message === 'string'
  ) {
    message = (args[0] as { message: string }).message;
    rest = args.slice(1);
  } else {
    message = formatArgs(args);
  }

  if (rest.length > 0) {
    attrs['args'] = formatArgs(rest);
  }

  const input: Record<string, unknown> = {
    level: TYPE_TO_LEVEL[logObj.type ?? ''] ?? 'info',
    message,
    attrs,
  };
  if (logObj.date !== undefined) input['time'] = logObj.date;
  if (typeof logObj.tag === 'string' && logObj.tag.length > 0) input['logger'] = logObj.tag;
  return input as LogInput;
}

/**
 * A consola reporter that republishes records to termwright.
 *
 * @param options - Publishing and redaction settings.
 */
export function termwrightReporter(options: ConsolaBridgeOptions = {}): ConsolaReporter {
  return {
    log(logObj: ConsolaLogObject): void {
      publishLog(() => toInput(logObj), options);
    },
  };
}
