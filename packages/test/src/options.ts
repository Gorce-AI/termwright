/**
 * Per-file and per-suite options — the equivalent of Playwright's `test.use()`.
 *
 * Vitest's own `test.override()` overrides a fixture's value for a file or a
 * `describe`, which is the mechanism; what it does *not* do is merge. Scoping
 * replaces the whole value, so `test.override({ termwrightOptions: { trace: 'on' } })`
 * would drop every other option if the value were used as-is. Merging therefore
 * happens here, key by key, and is what {@link TerminalFactory.launch} applies.
 */

import type { LogLevel } from '@termwright/protocol';
import type { SessionCapabilityId, TerminalProfileId, TimeoutClasses } from '@termwright/driver';
import type { ResolvedTermwrightConfig, TestTimeoutClasses, TraceMode } from './config.js';

/** Options a file or suite may override with `test.override`. */
export interface TermwrightOptions {
  /** Replaced wholly, never concatenated: an argv is not a merge. */
  readonly command?: readonly string[];
  readonly columns?: number;
  readonly rows?: number;
  readonly terminalProfile?: TerminalProfileId;
  /** Replaces the project capability requirements for this scope. */
  readonly requiredCapabilities?: readonly SessionCapabilityId[];
  /**
   * Merged key by key over the project's `env` — overriding one variable keeps
   * the rest, which is the only behaviour that makes suite overrides usable.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Merged key by key over the project's timeout classes. */
  readonly timeouts?: TestTimeoutClasses;
  /** Trace policy for the sessions this file or suite launches. */
  readonly trace?: TraceMode;
  /** Initial threshold for this test; `terminal.failOnLogLevel()` still wins. */
  readonly failOnLogLevel?: LogLevel | false;
}

/** What a single `launch()` call may override on top of everything else. */
export interface LaunchOverrides {
  readonly command?: readonly string[];
  readonly columns?: number;
  readonly rows?: number;
  readonly terminalProfile?: TerminalProfileId;
  readonly requiredCapabilities?: readonly SessionCapabilityId[];
  readonly env?: Readonly<Record<string, string>>;
  readonly timeouts?: TimeoutClasses;
  readonly trace?: TraceMode;
}

/** Everything a session needs, after config, scope and call have been merged. */
export interface MergedOptions {
  readonly command: readonly string[] | undefined;
  readonly columns: number;
  readonly rows: number;
  readonly terminalProfile: TerminalProfileId | undefined;
  readonly requiredCapabilities: readonly SessionCapabilityId[];
  readonly env: Readonly<Record<string, string>>;
  /** Driver timeout classes only; the `expect` class never reaches the driver. */
  readonly timeouts: TimeoutClasses;
  readonly trace: TraceMode;
  readonly failOnLogLevel: LogLevel | false;
}

/**
 * Merges the three layers: project config, then the file or suite override,
 * options, then this call's.
 *
 * @param baseEnv - environment inherited from the runner, under everything else.
 */
export function mergeOptions(
  config: ResolvedTermwrightConfig,
  suite: TermwrightOptions,
  call: LaunchOverrides,
  baseEnv: Readonly<Record<string, string>> = {},
): MergedOptions {
  const { expect: _configExpect, ...configTimeouts } = config.timeouts;
  const { expect: _suiteExpect, ...suiteTimeouts } = suite.timeouts ?? {};
  return {
    command: call.command ?? suite.command ?? config.command,
    columns: call.columns ?? suite.columns ?? config.columns,
    rows: call.rows ?? suite.rows ?? config.rows,
    terminalProfile: call.terminalProfile ?? suite.terminalProfile ?? config.terminalProfile,
    requiredCapabilities:
      call.requiredCapabilities ?? suite.requiredCapabilities ?? config.requiredCapabilities,
    env: { ...baseEnv, ...config.env, ...(suite.env ?? {}), ...(call.env ?? {}) },
    timeouts: { ...configTimeouts, ...strip(suiteTimeouts), ...strip(call.timeouts ?? {}) },
    trace: call.trace ?? suite.trace ?? config.trace,
    failOnLogLevel: suite.failOnLogLevel ?? config.failOnLogLevel,
  };
}

/** Drops explicit `undefined`s so a later layer does not erase an earlier one. */
function strip<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
