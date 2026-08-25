/**
 * Live debug log, in the spirit of Playwright's `DEBUG=pw:api`.
 *
 * Enabled with `TERMWRIGHT_DEBUG=1` (or `debug: true` when launching), it
 * writes to stderr what the driver is doing underneath: which API call ran with
 * which arguments, what each wait was waiting for and how it ended, when screen
 * and semantic revisions were published, and every diagnostic entry.
 *
 * Disabled is free: no wrapping is installed, no listener is registered and no
 * string is formatted. The session token is never printed, and payloads that
 * routinely carry secrets (`paste`, raw `write`) are logged by size only.
 */
import type { SessionDiagnostic } from './api.js';

/** Categories a line can belong to; the prefix a reader greps for. */
export type DebugCategory = 'api' | 'wait' | 'vt' | 'sem' | 'diag' | 'io' | 'app';

/** Marker used to recover the real object from an instrumented one. */
const RAW = Symbol.for('termwright.debug.raw');

/** Returns the underlying object when `value` is an instrumented wrapper. */
export function unwrap<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const raw = (value as Record<symbol, unknown>)[RAW];
  return raw === undefined ? value : (raw as T);
}

/**
 * Reads the debug switch. `TERMWRIGHT_DEBUG` accepts `1`, `true`, `api`
 * (calls, waits, revisions, diagnostics) and `all` (adds raw PTY traffic).
 */
export function debugMode(explicit: boolean | undefined): 'off' | 'api' | 'all' {
  const raw = (process.env['TERMWRIGHT_DEBUG'] ?? '').trim().toLowerCase();
  if (raw === 'all') return 'all';
  if (raw === '1' || raw === 'true' || raw === 'api' || raw === 'on') return 'api';
  if (raw === '0' || raw === 'false') return 'off';
  return explicit === true ? 'api' : 'off';
}

const MAX_TEXT = 60;

/** Formats one argument for the log: short, escaped and never a secret. */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    const escaped = JSON.stringify(value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value);
    return escaped;
  }
  if (value instanceof RegExp) return String(value);
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const json = JSON.stringify(value, (_key, item: unknown) =>
      item instanceof RegExp ? String(item) : item,
    );
    if (json === undefined) return '[object]';
    return json.length > MAX_TEXT ? `${json.slice(0, MAX_TEXT)}…}` : json;
  }
  return String(value);
}

/** Arguments that must never be printed verbatim, by method name. */
const SIZE_ONLY: ReadonlySet<string> = new Set(['paste', 'write']);

function formatArgs(method: string, args: readonly unknown[]): string {
  if (SIZE_ONLY.has(method)) {
    const first = args[0];
    const size =
      typeof first === 'string'
        ? `<${first.length} chars>`
        : first instanceof Uint8Array
          ? `<${first.length} bytes>`
          : formatValue(first);
    return [size, ...args.slice(1).map(formatValue)].join(', ');
  }
  return args.map(formatValue).join(', ');
}

/** Writes formatted lines to stderr for one session. */
export class DebugLog {
  readonly #label: string;
  readonly #now: () => number;
  readonly #mode: 'api' | 'all';
  readonly #write: (line: string) => void;

  constructor(
    sessionId: string,
    now: () => number,
    mode: 'api' | 'all',
    write: (line: string) => void = (line) => process.stderr.write(line),
  ) {
    this.#label = sessionId.startsWith('session:')
      ? sessionId.slice('session:'.length, 'session:'.length + 8)
      : sessionId.slice(0, 8);
    this.#now = now;
    this.#mode = mode;
    this.#write = write;
  }

  get logsIo(): boolean {
    return this.#mode === 'all';
  }

  line(category: DebugCategory, message: string): void {
    const seconds = (this.#now() / 1000).toFixed(3).padStart(7, ' ');
    this.#write(`  tw:${category.padEnd(4, ' ')} [${this.#label}] ${seconds}s ${message}\n`);
  }

  diagnostic(entry: SessionDiagnostic): void {
    const revision = entry.revision === undefined ? '' : ` r${entry.revision}`;
    const wire = entry.wireCode === undefined ? '' : ` (${entry.wireCode})`;
    this.line('diag', `${entry.code}${revision}${wire}: ${entry.detail}`);
  }
}

/** True for the methods whose result is worth naming in the log. */
function describeResult(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && 'description' in value) {
    return String((value as { description: unknown }).description);
  }
  return null;
}

/**
 * Wraps an object so every method call is logged with its arguments and its
 * outcome. Returned locators are wrapped too, so a chain stays visible.
 *
 * The wrapper binds calls to the raw target, so private fields keep working;
 * code that reaches into another instance's internals must {@link unwrap} the
 * value it was handed.
 */
export function instrument<T extends object>(target: T, log: DebugLog, kind: 'harness' | 'locator'): T {
  const cache = new Map<string | symbol, unknown>();
  return new Proxy(target, {
    get(raw, property, receiver): unknown {
      if (property === RAW) return raw;
      const value = Reflect.get(raw, property, raw) as unknown;
      if (typeof value !== 'function' || typeof property !== 'string') {
        void receiver;
        return value;
      }
      const cached = cache.get(property);
      if (cached !== undefined) return cached;

      const method = value as (...args: unknown[]) => unknown;
      const wrapper = (...args: unknown[]): unknown => {
        const call = `${kind === 'locator' ? 'locator.' : ''}${property}(${formatArgs(property, args)})`;
        const isWait = property.startsWith('waitFor') || property === 'resolve';
        const category: DebugCategory = isWait ? 'wait' : 'api';
        const startedAt = performance.now();
        let result: unknown;
        try {
          result = method.apply(raw, args);
        } catch (error) {
          log.line(category, `${call} failed: ${errorLabel(error)}`);
          throw error;
        }
        if (!(result instanceof Promise)) {
          const described = describeResult(result);
          log.line(category, described === null ? call : `${call} → ${described}`);
          return typeof result === 'object' && result !== null && described !== null
            ? instrument(result as object, log, 'locator')
            : result;
        }
        log.line(category, `${call} started`);
        return result.then(
          (value_: unknown) => {
            log.line(category, `${call} succeeded in ${Math.round(performance.now() - startedAt)} ms`);
            return value_;
          },
          (error: unknown) => {
            log.line(category, `${call} failed after ${Math.round(performance.now() - startedAt)} ms: ${errorLabel(error)}`);
            throw error;
          },
        );
      };
      cache.set(property, wrapper);
      return wrapper;
    },
  });
}

function errorLabel(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const suffix = typeof code === 'string' ? ` [${code}]` : '';
    return `${error.name}${suffix}: ${error.message.split('\n')[0] ?? ''}`;
  }
  return String(error);
}

/** Renders a byte payload for the `all` mode: escaped and truncated. */
export function formatBytes(data: Uint8Array): string {
  const text = new TextDecoder().decode(data.subarray(0, MAX_TEXT));
  const escaped = JSON.stringify(text).slice(1, -1);
  return `${data.length} bytes ${escaped}${data.length > MAX_TEXT ? '…' : ''}`;
}
