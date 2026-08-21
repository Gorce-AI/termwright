/**
 * Which Charm a project is actually built on.
 *
 * This is the first thing the probe has to get right, and it is the thing most
 * likely to be got wrong from memory. Bubble Tea v2 is **not**
 * `github.com/charmbracelet/bubbletea/v2`: asking the proxy for that path fails
 * with *module declares its path as: charm.land/bubbletea/v2*. Charm moved the
 * v2 line to a vanity domain, so a probe that matches frameworks by module path
 * and knows only the GitHub form silently misses every v2 project — no error,
 * no semantics, just a session that never reports a tree.
 *
 * The two majors are not a parameter apart, either. v1's `View()` returns a
 * string and the frame leaves the model at three separate call sites; v2's
 * returns a `View` struct and all three were consolidated into one wrapper.
 * The strategy differs, so the detection has to be exact rather than
 * approximate.
 *
 * Facts here come from `docs/architecture/audit/charm.md`, read from the
 * sources of both majors.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Major line of the Charm stack, which decides the whole strategy. */
export type CharmMajor = 'v1' | 'v2';

/** Module paths per major. Both are matched; neither is derived from the other. */
export const BUBBLETEA_MODULES: Readonly<Record<CharmMajor, string>> = {
  v1: 'github.com/charmbracelet/bubbletea',
  v2: 'charm.land/bubbletea/v2',
};

/** Companion modules, needed because the probe reads component state directly. */
export const COMPANION_MODULES: Readonly<Record<CharmMajor, readonly string[]>> = {
  v1: ['github.com/charmbracelet/bubbles', 'github.com/charmbracelet/lipgloss'],
  v2: ['charm.land/bubbles/v2', 'charm.land/lipgloss/v2'],
};

/** What a project turned out to be using. */
export interface CharmFlavour {
  readonly major: CharmMajor;
  readonly module: string;
  readonly version: string;
  /** Companion modules the project resolves, with their versions. */
  readonly companions: Readonly<Record<string, string>>;
}

export class CharmDetectionError extends Error {
  constructor(
    readonly code: 'not-charm' | 'both-majors' | 'go-missing',
    message: string,
  ) {
    super(message);
    this.name = 'CharmDetectionError';
  }
}

/**
 * Reads which Bubble Tea a module resolves, and at what version.
 *
 * Runs with `GOWORK=off`, because a workspace already in effect — including one
 * of ours from an earlier run — would report a *replaced* version, and the
 * patch set would then be chosen for source that is not on disk.
 */
export async function detectCharmFlavour(
  moduleDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CharmFlavour> {
  const found: { major: CharmMajor; version: string }[] = [];

  for (const major of ['v1', 'v2'] as const) {
    const version = await moduleVersion(BUBBLETEA_MODULES[major], moduleDir, env);
    if (version !== null) found.push({ major, version });
  }

  if (found.length === 0) {
    throw new CharmDetectionError(
      'not-charm',
      `${moduleDir} does not require Bubble Tea under either module path ` +
        `(${BUBBLETEA_MODULES.v1} or ${BUBBLETEA_MODULES.v2})`,
    );
  }
  if (found.length > 1) {
    // Legal in Go — the paths are unrelated modules — and hopeless for us: two
    // event loops, two renderers, and no way to tell which one drew the frame
    // the marker will describe.
    throw new CharmDetectionError(
      'both-majors',
      `${moduleDir} requires both Bubble Tea majors (${found
        .map((entry) => `${BUBBLETEA_MODULES[entry.major]} ${entry.version}`)
        .join(', ')}); the probe cannot tell which one renders a given frame`,
    );
  }

  const [only] = found as [{ major: CharmMajor; version: string }];
  const companions: Record<string, string> = {};
  for (const module of COMPANION_MODULES[only.major]) {
    const version = await moduleVersion(module, moduleDir, env);
    if (version !== null) companions[module] = version;
  }

  return {
    major: only.major,
    module: BUBBLETEA_MODULES[only.major],
    version: only.version,
    companions,
  };
}

/** Resolved version of one module, or null when the project does not use it. */
async function moduleVersion(
  module: string,
  moduleDir: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const { stdout } = await run('go', ['list', '-m', '-f', '{{.Version}}', module], {
      cwd: moduleDir,
      env: { ...env, GOWORK: 'off' },
    });
    const version = stdout.trim();
    return version === '' ? null : version;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/ENOENT/u.test(detail)) {
      throw new CharmDetectionError('go-missing', 'the `go` toolchain is not on PATH');
    }
    // "not a known dependency" is the ordinary answer for the other major.
    return null;
  }
}

/**
 * What the probe can promise for a given major.
 *
 * The asymmetry is the audit's central finding and it is not a limitation to be
 * papered over. Both majors hand the frame to the renderer as one styled
 * string, and Lip Gloss destroys the mapping from fragment to screen region on
 * the way: `Style.Render` rebuilds the string rune by rune, the joins pad with
 * spaces indistinguishable from content, and truncation discards the tail with
 * no record it existed.
 *
 * v2 has two channels that could survive that — the layer compositor and
 * per-cell OSC 8 parameters — but this probe wires neither one yet. Therefore
 * both majors report **component known, final position unsupported**. Capabilities
 * describe what this build emits, not what its framework could support after
 * future instrumentation work.
 */
export function capabilitiesFor(_major: CharmMajor): readonly string[] {
  return ['tree', 'states', 'actions', 'render-revisions'];
}

/** Whether geometry can be reported at all for this major. */
export function reportsGeometry(_major: CharmMajor): boolean {
  return false;
}
