/**
 * `@termwright/conformance` — the fixtures and contract suites that decide
 * whether a driver and an adapter actually implement termwright.
 *
 * Two things are exported. {@link runAdapterConformance} is a vitest suite an
 * adapter author calls to self-certify: it drives the adapter as a subprocess
 * and checks the five contract obligations (dormant rule, handshake, snapshot
 * validity, revision ordering, channel loss) without importing the adapter, so
 * it works the same for a Python, Go or Rust one. {@link AdapterProbe} is the
 * mini-driver underneath it, for checks the suite does not cover.
 *
 * {@link CONFORMANCE_FIXTURES} points at the runnable fixtures that ship with
 * the package, so other packages' tests can launch them instead of inventing
 * their own.
 *
 * @example
 * ```ts
 * import { runAdapterConformance } from '@termwright/conformance';
 *
 * await runAdapterConformance({
 *   name: 'my-adapter',
 *   spawn: () => ({ command: ['python', 'demo_app.py'] }),
 *   ready: 'Ready',
 *   interaction: { input: '\t', expect: '[Save]' },
 *   quit: { input: '', exitCode: 0 },
 * });
 * ```
 */

export { runAdapterConformance } from './adapter-conformance.js';
export type { AdapterConformanceOptions } from './adapter-conformance.js';

export { AdapterProbe, MARKER_TEXT_PREFIX } from './support/probe.js';
export type {
  AdapterCommand,
  ProbeObservation,
  ProbeOptions,
  RecordedFault,
  RecordedMarker,
  RecordedMessage,
} from './support/probe.js';

export { CONFORMANCE_FIXTURES, createSessionPool, environment, fixturePath, ptyAvailable } from './support/pty.js';
export type { FixtureLaunchOptions, SessionPool } from './support/pty.js';
