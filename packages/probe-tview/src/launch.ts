/**
 * The one call a launcher makes.
 *
 * Everything else in this package is a step: read the workspace, materialise a
 * copy, patch it, key the cache, write the file. A user should not assemble
 * those, and neither should a test — the assembly order is where the mistakes
 * live, and there is exactly one correct one.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  applyPatchSet,
  assertNoVendorMode,
  copyDir,
  digestPatchSet,
  isComplete,
  markComplete,
  materializeUpstream,
  prepareCopyDir,
  readManifest,
  readWorkspace,
  writeProvenance,
  writeWorkspace,
  type CopyKeyInput,
} from '@termwright/probe-go';

const run = promisify(execFile);

/** Module path of the framework this probe instruments. */
export const FRAMEWORK = 'github.com/rivo/tview';

/** Module path of the protocol client the injected probe imports. */
export const CLIENT_MODULE = 'github.com/gorce-ai/termwright/clients/go';

/** Version of this probe; part of the cache key, so a new patch set invalidates copies. */
export const PROBE_VERSION = '0.1.0';

export interface PrepareOptions {
  /** Directory of the Go module to build. */
  readonly moduleDir: string;
  /** Framework version to instrument, e.g. `v0.42.0`. */
  readonly frameworkVersion?: string;
  /** Where the protocol client lives on disk. Defaults to the copy shipped here. */
  readonly clientDir?: string;
  /** Where the generated workspace is written. Defaults to inside the copy's cache entry. */
  readonly workspaceFile?: string;
  /** Environment the build will run with; checked, never mutated. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface PreparedBuild {
  /** Hand this to the build as `GOWORK`. */
  readonly workspaceFile: string;
  /** The instrumented copy, for a canary check or for diagnosis. */
  readonly copyDir: string;
  /** Environment to build with: the caller's, plus GOWORK. */
  readonly env: NodeJS.ProcessEnv;
  /** True when the copy was built during this call rather than reused. */
  readonly built: boolean;
}

/**
 * Makes a build of `moduleDir` compile against the instrumented framework.
 *
 * Does not build anything and does not spawn the application: a launcher owns
 * that. This returns what the build needs and nothing else, which keeps the
 * package testable and keeps the decision about *how* to run the user's build
 * where it belongs.
 */
export async function prepareInstrumentedBuild(
  options: PrepareOptions,
): Promise<PreparedBuild> {
  const env = options.env ?? process.env;
  // Refused rather than overridden: forcing workspace mode over a vendored
  // build would change what compiles, behind the user's back.
  assertNoVendorMode(env);

  const frameworkVersion = options.frameworkVersion ?? (await detectFrameworkVersion(options.moduleDir, env));
  const patchSetDir = patchSetFor(frameworkVersion);
  const manifest = await readManifest(patchSetDir);

  const key: CopyKeyInput = {
    framework: FRAMEWORK,
    frameworkVersion,
    probeVersion: PROBE_VERSION,
    toolchain: await toolchain(env),
    patchDigest: await digestPatchSet(patchSetDir),
  };

  const copy = copyDir(key, env);
  const built = !(await isComplete(copy));
  if (built) {
    await prepareCopyDir(copy);
    await materializeUpstream(await upstreamDir(frameworkVersion, env), copy);
    await applyPatchSet(copy, patchSetDir);
    await writeProvenance(copy, manifest);
    // Last, so an interrupted build is rebuilt rather than compiled.
    await markComplete(copy, key);
  }

  const workspaceFile = await writeWorkspace(options.workspaceFile ?? join(copy, '..', 'generated.work'), {
    moduleDir: options.moduleDir,
    inherited: await readWorkspace(options.moduleDir),
    replaces: [
      { from: FRAMEWORK, to: copy },
      // A `use` entry does not satisfy the copy's versioned require; only a
      // replace does.
      { from: CLIENT_MODULE, to: options.clientDir ?? defaultClientDir() },
    ],
  });

  return { workspaceFile, copyDir: copy, env: { ...env, GOWORK: workspaceFile }, built };
}

/** Reads the framework version the module actually resolves to. */
async function detectFrameworkVersion(moduleDir: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run('go', ['list', '-m', '-f', '{{.Version}}', FRAMEWORK], {
    cwd: moduleDir,
    // Without this a workspace already in effect could report a replaced
    // version, and the patch set would be chosen for the wrong source.
    env: { ...env, GOWORK: 'off' },
  });
  return stdout.trim();
}

/** Locates the pristine module in the Go module cache. */
async function upstreamDir(version: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run('go', ['env', 'GOMODCACHE'], { env });
  return join(stdout.trim(), 'github.com', 'rivo', `tview@${version}`);
}

async function toolchain(env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run('go', ['version'], { env });
  return stdout.trim();
}

function patchSetFor(version: string): string {
  return join(packageRoot(), 'upstream-patches', 'tview', version);
}

/**
 * Where the protocol client lives.
 *
 * Published, it is vendored into the package as `go-client/`. In this
 * repository it is the workspace source, so a change to the client is picked
 * up without a copy step. Checked in that order, and reported rather than
 * guessed when neither exists — a missing client shows up as an unresolvable
 * module deep in a Go build otherwise.
 */
function defaultClientDir(): string {
  const vendored = join(packageRoot(), 'go-client');
  if (existsSync(join(vendored, 'go.mod'))) return vendored;

  const inRepo = join(packageRoot(), '..', '..', 'clients', 'go');
  if (existsSync(join(inRepo, 'go.mod'))) return inRepo;

  throw new Error(
    'the termwright Go client was not found next to the probe (expected go-client/ in the ' +
      'package, or clients/go in the repository); pass clientDir explicitly',
  );
}

function packageRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..');
}
