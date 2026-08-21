/**
 * Configuration for the Vitest preset: viewport, timeout classes, trace mode,
 * snapshot directories and profiles.
 *
 * A project declares its configuration once with {@link defineTermwrightConfig}
 * and installs it from a Vitest `setupFiles` module with
 * {@link configureTermwright}. Fixtures and matchers read the resolved value
 * through {@link getTermwrightConfig}.
 */

import type { TimeoutClasses } from '@termwright/driver';
import { LOG_LEVEL_SEVERITY, type LogLevel } from '@termwright/protocol';

/** How much of a session ends up in a `.twtrace` archive. */
export type TraceMode = 'on' | 'retain-on-failure' | 'on-first-retry' | 'off';

/**
 * Snapshot writing policy.
 *
 * - `all` — rewrite every snapshot, even matching ones.
 * - `changed` — write missing snapshots and overwrite mismatching ones.
 * - `missing` — write snapshots that do not exist yet; mismatches still fail.
 * - `none` — never write; a missing snapshot fails the test.
 */
export type UpdateSnapshotsMode = 'all' | 'changed' | 'missing' | 'none';

/** Timeout classes, extended with the class that governs polling matchers. */
export interface TestTimeoutClasses extends TimeoutClasses {
  /** Budget for self-polling matchers (`toBeVisible`, …). Default 5 000 ms. */
  readonly expect?: number;
}

/**
 * A deterministic 16-entry ANSI palette.
 *
 * Terminals differ in what `palette index 2` looks like; pinning the palette
 * per profile is what makes color assertions and cell snapshots stable across
 * a developer machine and CI.
 */
export interface ColorPalette {
  readonly name: string;
  /** `#rrggbb` for palette indices 0…15, in ANSI order. */
  readonly colors: readonly string[];
  /** Extra environment handed to launched programs, e.g. `TERM`. */
  readonly env?: Readonly<Record<string, string>>;
}

/** User-facing configuration. Every field has a documented default. */
export interface TermwrightConfig {
  /** Viewport width in cells. Default 100. */
  readonly columns?: number;
  /** Viewport height in cells. Default 30. */
  readonly rows?: number;
  /** Timeout classes forwarded to the driver, plus the `expect` class. */
  readonly timeouts?: TestTimeoutClasses;
  /** Trace collection policy. Default `retain-on-failure`. */
  readonly trace?: TraceMode;
  /** Where traces and the HTML report are written. Default `termwright-report`. */
  readonly outputDir?: string;
  /** Snapshot directory, relative to the test file. Default `__snapshots__`. */
  readonly snapshotDir?: string;
  /** Default command for `terminal.launch()` when the test passes none. */
  readonly command?: readonly string[];
  /** Extra environment for launched programs. Merged after the palette's. */
  readonly env?: Readonly<Record<string, string>>;
  /** Character-width and terminal behavior profile used by the emulator. */
  readonly terminalProfile?: string;
  /** Deterministic palette; also decorates cell snapshots with color names. */
  readonly palette?: ColorPalette;
  /** Overrides selected by the `TERMWRIGHT_PROFILE` environment variable. */
  readonly profiles?: Readonly<Record<string, Omit<TermwrightConfig, 'profiles'>>>;
  /**
   * Fail an otherwise passing test when the program logged a record at this
   * level or above. Default `'error'`; `false` turns the check off.
   *
   * This is the negative assertion nobody writes: a test that clicks through a
   * flow while the program logs `error: failed to save` is not a passing test,
   * it is a test that did not look.
   */
  readonly failOnLogLevel?: LogLevel | false;
  /**
   * Snapshot policy. Normally left unset: it is derived per run from
   * `TERMWRIGHT_UPDATE_SNAPSHOTS` or Vitest's `--update` flag.
   */
  readonly updateSnapshots?: UpdateSnapshotsMode;
}

/** Configuration with every default filled in. */
export interface ResolvedTermwrightConfig {
  readonly columns: number;
  readonly rows: number;
  readonly timeouts: Required<TestTimeoutClasses>;
  readonly trace: TraceMode;
  readonly outputDir: string;
  readonly snapshotDir: string;
  readonly command: readonly string[] | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly palette: ColorPalette | undefined;
  readonly terminalProfile: string | undefined;
  readonly updateSnapshots: UpdateSnapshotsMode | undefined;
  readonly failOnLogLevel: LogLevel | false;
  /** Name of the profile that was applied, when any. */
  readonly profile: string | undefined;
}

/** Inline Vitest project generated from one named Termwright profile. */
export interface TermwrightVitestProject {
  readonly extends: true;
  readonly test: {
    readonly name: string;
    readonly env: Readonly<Record<'TERMWRIGHT_PROFILE', string>>;
  };
}

/** Runs the same Vitest tests once per named Termwright profile. */
export function termwrightProjects(
  config: TermwrightConfig,
  names: readonly string[] = Object.keys(config.profiles ?? {}),
): readonly TermwrightVitestProject[] {
  const known = config.profiles ?? {};
  if (names.length === 0) throw new TypeError('termwrightProjects() needs at least one configured profile');
  const seen = new Set<string>();
  return Object.freeze(names.map((name) => {
    if (seen.has(name)) throw new TypeError(`termwrightProjects() received duplicate profile ${JSON.stringify(name)}`);
    seen.add(name);
    if (known[name] === undefined) throw new TypeError(`termwrightProjects() cannot find profile ${JSON.stringify(name)}`);
    return Object.freeze({
      extends: true as const,
      test: Object.freeze({
        name,
        env: Object.freeze({ TERMWRIGHT_PROFILE: name }),
      }),
    });
  }));
}

/**
 * The palette shipped for CI: the xterm defaults, pinned.
 *
 * It is not "the prettiest" palette — it is the one every emulator agrees on,
 * which is the property color assertions need.
 */
export const XTERM_PALETTE: ColorPalette = Object.freeze({
  name: 'xterm',
  colors: Object.freeze([
    '#000000', '#cd0000', '#00cd00', '#cdcd00',
    '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
    '#7f7f7f', '#ff0000', '#00ff00', '#ffff00',
    '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
  ]),
  env: Object.freeze({ TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '3' }),
});

/** ANSI names for palette indices 0…15, used by cell snapshots. */
export const ANSI_COLOR_NAMES: readonly string[] = Object.freeze([
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'bright-black', 'bright-red', 'bright-green', 'bright-yellow',
  'bright-blue', 'bright-magenta', 'bright-cyan', 'bright-white',
]);

const DEFAULT_TIMEOUTS: Required<TestTimeoutClasses> = Object.freeze({
  action: 5_000,
  text: 5_000,
  idle: 2_000,
  ready: 10_000,
  exit: 10_000,
  expect: 5_000,
});

const TRACE_MODES: readonly TraceMode[] = ['on', 'retain-on-failure', 'on-first-retry', 'off'];
const UPDATE_MODES: readonly UpdateSnapshotsMode[] = ['all', 'changed', 'missing', 'none'];
const MAX_RETRIES = 100;

export interface TermwrightRetryOptions {
  /** Additional attempts on CI. Default 2. */
  readonly ci?: number;
  /** Additional attempts outside CI. Default 0. */
  readonly local?: number;
  /** Environment used for CI detection and `TERMWRIGHT_RETRIES`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolves the number for Vitest's native `test.retry` option.
 *
 * `TERMWRIGHT_RETRIES` wins when present and always means additional attempts,
 * matching Vitest's own `retry` semantics. Termwright never schedules a second
 * whole-suite run.
 */
export function termwrightRetry(options: TermwrightRetryOptions = {}): number {
  const env = options.env ?? process.env;
  const overridden = env['TERMWRIGHT_RETRIES'];
  if (overridden !== undefined && overridden !== '') {
    return retryCount(overridden, 'TERMWRIGHT_RETRIES');
  }
  const ci = env['CI'];
  return retryCount(
    ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false'
      ? (options.ci ?? 2)
      : (options.local ?? 0),
    ci !== undefined ? 'ci' : 'local',
  );
}

function retryCount(value: string | number, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_RETRIES) {
    throw new TypeError(`${name} retries must be an integer from 0 to ${MAX_RETRIES}, received ${String(value)}`);
  }
  return parsed;
}

/**
 * Validates a configuration object and returns it unchanged.
 *
 * Exists for the same reason as Vite's `defineConfig`: type inference in a
 * plain `termwright.config.ts`, plus eager validation of the values that would
 * otherwise fail deep inside a test run.
 *
 * @example
 * ```ts
 * export default defineTermwrightConfig({
 *   columns: 100,
 *   rows: 30,
 *   trace: 'retain-on-failure',
 *   profiles: { ci: { trace: 'on', palette: XTERM_PALETTE } },
 * });
 * ```
 */
export function defineTermwrightConfig(config: TermwrightConfig): TermwrightConfig {
  validate(config, 'config');
  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    validate(profile, `profiles.${name}`);
  }
  return config;
}

function validate(config: TermwrightConfig, path: string): void {
  positive(config.columns, `${path}.columns`);
  positive(config.rows, `${path}.rows`);
  for (const [key, value] of Object.entries(config.timeouts ?? {})) {
    positive(value as number | undefined, `${path}.timeouts.${key}`);
  }
  if (config.trace !== undefined && !TRACE_MODES.includes(config.trace)) {
    throw new TypeError(`${path}.trace must be one of ${TRACE_MODES.join(' | ')}`);
  }
  if (config.updateSnapshots !== undefined && !UPDATE_MODES.includes(config.updateSnapshots)) {
    throw new TypeError(`${path}.updateSnapshots must be one of ${UPDATE_MODES.join(' | ')}`);
  }
  if (
    config.failOnLogLevel !== undefined &&
    config.failOnLogLevel !== false &&
    !(config.failOnLogLevel in LOG_LEVEL_SEVERITY)
  ) {
    throw new TypeError(
      `${path}.failOnLogLevel must be false or one of ${Object.keys(LOG_LEVEL_SEVERITY).join(' | ')}`,
    );
  }
  if (config.command !== undefined && config.command.length === 0) {
    throw new TypeError(`${path}.command must not be empty`);
  }
  const palette = config.palette;
  if (palette !== undefined && palette.colors.length !== 16) {
    throw new TypeError(`${path}.palette.colors must hold exactly 16 entries`);
  }
}

function positive(value: number | undefined, path: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive number, received ${String(value)}`);
  }
}

/**
 * Applies the profile selected by `TERMWRIGHT_PROFILE` and fills in defaults.
 *
 * @param config - user configuration; `{}` when the project declares none.
 * @param env - environment to read the profile name from. Defaults to `process.env`.
 */
export function resolveTermwrightConfig(
  config: TermwrightConfig = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedTermwrightConfig {
  const name = env['TERMWRIGHT_PROFILE'];
  const profile = name === undefined ? undefined : config.profiles?.[name];
  if (name !== undefined && name.length > 0 && profile === undefined) {
    const known = Object.keys(config.profiles ?? {});
    throw new TypeError(
      `TERMWRIGHT_PROFILE=${name} does not match any configured profile (${known.join(', ') || 'none'})`,
    );
  }
  const merged: TermwrightConfig = { ...config, ...profile };
  const palette = merged.palette;
  return Object.freeze({
    columns: merged.columns ?? 100,
    rows: merged.rows ?? 30,
    timeouts: Object.freeze({ ...DEFAULT_TIMEOUTS, ...stripUndefined(merged.timeouts ?? {}) }),
    trace: merged.trace ?? 'retain-on-failure',
    outputDir: merged.outputDir ?? 'termwright-report',
    snapshotDir: merged.snapshotDir ?? (profile === undefined ? '__snapshots__' : `__snapshots__/${name}`),
    command: merged.command,
    env: Object.freeze({ ...(palette?.env ?? {}), ...(merged.env ?? {}) }),
    palette,
    terminalProfile: merged.terminalProfile,
    updateSnapshots: merged.updateSnapshots,
    failOnLogLevel: merged.failOnLogLevel ?? 'error',
    profile: profile === undefined ? undefined : name,
  });
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

let current: ResolvedTermwrightConfig | undefined;
let declared: TermwrightConfig = {};

/**
 * Installs the project configuration. Call it from a Vitest `setupFiles`
 * module; every fixture and matcher created afterwards observes it.
 *
 * @example
 * ```ts
 * // vitest.setup.ts
 * import { configureTermwright } from '@termwright/test';
 * import config from './termwright.config.js';
 *
 * configureTermwright(config);
 * ```
 */
export function configureTermwright(config: TermwrightConfig): ResolvedTermwrightConfig {
  declared = defineTermwrightConfig(config);
  current = resolveTermwrightConfig(declared);
  return current;
}

/** The active configuration, resolving defaults on first use. */
export function getTermwrightConfig(): ResolvedTermwrightConfig {
  current ??= resolveTermwrightConfig(declared);
  return current;
}

/** Drops the installed configuration. Intended for this package's own tests. */
export function resetTermwrightConfig(): void {
  declared = {};
  current = undefined;
}
