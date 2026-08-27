/**
 * The one-call build preparation path for both Bubble Tea majors.
 *
 * Bubble Tea and Bubbles are separate Go modules. Bubble Tea still needs an
 * exact context patch in an independently cached copy; Bubbles accessors are
 * add-only units injected by the official Go tool executor seam.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  applyPatchSet,
  assertNoVendorMode,
  cacheRoot,
  copyDir,
  digestPatchSet,
  ensureUpstreamModule,
  isComplete,
  markComplete,
  materializeUpstream,
  prepareGoToolExec,
  prepareCopyDir,
  readManifest,
  readWorkspace,
  writeProvenance,
  writeWorkspace,
  type CopyKeyInput,
  type GoToolExecUnit,
} from '@termwright/probe-go';
import {
  detectCharmFlavour,
  type CharmFlavour,
  type CharmMajor,
} from './detect.js';

const run = promisify(execFile);

/** Module path of the protocol client imported by the injected probe. */
export const CLIENT_MODULE = 'github.com/gorce-ai/termwright/clients/go';

/** Version of this probe. It participates in every instrumented-copy key. */
export const PROBE_VERSION = '0.2.0';

/** Exact Bubbles module paths; like Bubble Tea, v2 moved to a vanity domain. */
export const BUBBLES_MODULES: Readonly<Record<CharmMajor, string>> = {
  v1: 'github.com/charmbracelet/bubbles',
  v2: 'charm.land/bubbles/v2',
};

/** Owned accessor profile per module line; compilation, not this advisory version, admits a resolved candidate. */
const BUBBLES_UNIT_PROFILES: Readonly<Record<CharmMajor, string>> = {
  v1: 'v1.0.0',
  v2: 'v2.1.1',
};

export class CharmPrepareError extends Error {
  constructor(
    readonly code: 'unsupported-version' | 'unsupported-capability',
    readonly module: string,
    readonly version: string,
    message: string,
  ) {
    super(message);
    this.name = 'CharmPrepareError';
  }
}

export interface PrepareOptions {
  /** Directory of the Go module to build. */
  readonly moduleDir: string;
  /** Where the protocol client lives. Defaults to the checkout or matching released Go module. */
  readonly clientDir?: string;
  /** Where to write the generated go.work. Defaults to the Termwright cache. */
  readonly workspaceFile?: string;
  /** Environment the eventual Go build will receive; inspected, never mutated. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface PreparedBuild {
  /** The exact detected major, module versions and companions. */
  readonly flavour: CharmFlavour;
  /** Hand this to the build as `GOWORK`. */
  readonly workspaceFile: string;
  /** Instrumented Bubble Tea copy. */
  readonly copyDir: string;
  /** Explicit flags to insert after every controlled `go build`/`go test` subcommand. */
  readonly goArgs: readonly string[];
  /** Generated compiler wrapper, or null when no supported Bubbles module is present. */
  readonly toolExecFile: string | null;
  /** Modules whose add-only units the wrapper injects. */
  readonly injectedModules: readonly string[];
  /** Environment to build with: the caller's, plus the generated GOWORK. */
  readonly env: NodeJS.ProcessEnv;
  /** True when the Bubble Tea copy was materialised rather than reused. */
  readonly built: boolean;
  /** Modules materialised during this call; add-only units are never module copies. */
  readonly builtModules: readonly string[];
}

interface PreparedCopy {
  readonly dir: string;
  readonly built: boolean;
}

/**
 * Prepares a normal Bubble Tea application for an instrumented `go build`.
 *
 * The helper detects v1 versus v2, chooses only byte-pinned patch sets, adds a
 * Bubbles compiler units when the application resolves a supported Bubbles
 * version, and writes an external workspace for the remaining redirects. It
 * does not build or launch the application or write inside `moduleDir`.
 */
export async function prepareInstrumentedBuild(
  options: PrepareOptions,
): Promise<PreparedBuild> {
  const env = options.env ?? process.env;
  assertNoVendorMode(env);

  const flavour = await detectCharmFlavour(options.moduleDir, env);
  const teaPatchSet = requirePatchSet('bubbletea', flavour.module, flavour.version);
  const toolchainVersion = await toolchain(env);
  const tea = await prepareCopy({
    module: flavour.module,
    version: flavour.version,
    patchSetDir: teaPatchSet,
    probeVersion: PROBE_VERSION,
    toolchain: toolchainVersion,
    env,
  });

  const builtModules: string[] = tea.built ? [flavour.module] : [];
  const bubblesModule = BUBBLES_MODULES[flavour.major];
  const bubblesVersion = flavour.companions[bubblesModule];

  const clientDir = options.clientDir ?? (await defaultClientDir(env));
  const replaces = [
    { from: flavour.module, to: tea.dir },
    ...(await clientVersionReplacements(options.moduleDir, clientDir, env)),
  ];
  const inherited = await readWorkspace(options.moduleDir);
  const requestedWorkspace =
    options.workspaceFile === undefined
      ? await defaultWorkspaceFile({ moduleDir: options.moduleDir, inherited, replaces }, env)
      : resolve(options.workspaceFile);
  const workspaceFile = await writeWorkspace(
    requestedWorkspace,
    {
      moduleDir: options.moduleDir,
      inherited,
      suppliedUses: (await modulePath(options.moduleDir, env)) === CLIENT_MODULE
        ? []
        : [{ dir: clientDir, module: CLIENT_MODULE }],
      replaces,
    },
  );
  const buildEnv = { ...env, GOWORK: workspaceFile };
  const bubblesToolExec = bubblesVersion === undefined
    ? null
    : await prepareBubblesToolExec({
        moduleDir: options.moduleDir,
        module: bubblesModule,
        version: bubblesVersion,
        patchSetDir: requireBubblesUnitProfile(flavour.major, bubblesModule),
        outputDir: join(dirname(workspaceFile), 'bubbles-toolexec'),
        env: buildEnv,
      });

  return {
    flavour,
    workspaceFile,
    copyDir: tea.dir,
    goArgs: bubblesToolExec?.goArgs ?? [],
    toolExecFile: bubblesToolExec?.wrapperFile ?? null,
    injectedModules: bubblesToolExec === null ? [] : [bubblesModule],
    env: bubblesToolExec?.env ?? buildEnv,
    built: tea.built,
    builtModules,
  };
}

async function prepareBubblesToolExec(options: {
  readonly moduleDir: string;
  readonly module: string;
  readonly version: string;
  readonly patchSetDir: string;
  readonly outputDir: string;
  readonly env: NodeJS.ProcessEnv;
}) {
  const manifest = await readManifest(options.patchSetDir);
  if (manifest.framework !== options.module) {
    throw new CharmPrepareError(
      'unsupported-capability',
      options.module,
      options.version,
      `the patch manifest at ${options.patchSetDir} describes ` +
        `${manifest.framework}, not ${options.module}`,
    );
  }
  if (manifest.patched.length !== 0 || manifest.added.length === 0) {
    throw new Error(
      `the Bubbles manifest for ${options.module} ${options.version} must contain only add-only units`,
    );
  }
  const units: GoToolExecUnit[] = await Promise.all(manifest.added.map(async (added) => {
    const packageDir = dirname(added.path).replaceAll('\\', '/');
    return {
      packagePath: packageDir === '.' ? options.module : `${options.module}/${packageDir}`,
      targetFile: 'zz_termwright_probe.go',
      source: await readFile(join(options.patchSetDir, added.source), 'utf8'),
      sourceDigest: added.sha256,
    };
  }));
  const prepared = await prepareGoToolExec({
    moduleDir: options.moduleDir,
    outputDir: options.outputDir,
    units,
    env: options.env,
  });
  try {
    await run('go', ['build', ...prepared.goArgs, ...units.map((unit) => unit.packagePath)], {
      cwd: options.moduleDir,
      env: prepared.env,
    });
  } catch (error) {
    throw new CharmPrepareError(
      'unsupported-capability',
      options.module,
      options.version,
      `${options.module} ${options.version} does not compile the owned Bubbles accessor contract: ${message(error)}`,
    );
  }
  return prepared;
}

async function clientVersionReplacements(
  moduleDir: string,
  clientDir: string,
  env: NodeJS.ProcessEnv,
): Promise<{ from: string; to: string; version: string }[]> {
  if ((await modulePath(moduleDir, env)) === CLIENT_MODULE) return [];
  const versions = new Set(['v0.0.0']);
  try {
    const { stdout } = await run('go', ['list', '-m', '-f', '{{.Version}}', CLIENT_MODULE], {
      cwd: moduleDir,
      env: { ...env, GOWORK: 'off' },
    });
    if (stdout.trim() !== '') versions.add(stdout.trim());
  } catch {
    // Applications do not need to import the annotation client themselves.
  }
  return [...versions].map((version) => ({ from: CLIENT_MODULE, to: clientDir, version }));
}

async function modulePath(moduleDir: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run('go', ['list', '-m', '-f', '{{.Path}}'], {
    cwd: moduleDir,
    env: { ...env, GOWORK: 'off' },
  });
  return stdout.trim();
}

async function prepareCopy(options: {
  readonly module: string;
  readonly version: string;
  readonly patchSetDir: string;
  readonly probeVersion: string;
  readonly toolchain: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<PreparedCopy> {
  const manifest = await readManifest(options.patchSetDir);
  if (manifest.framework !== options.module || manifest.frameworkVersion !== options.version) {
    throw new CharmPrepareError(
      'unsupported-version',
      options.module,
      options.version,
      `the patch manifest at ${options.patchSetDir} describes ` +
        `${manifest.framework} ${manifest.frameworkVersion}, not ${options.module} ${options.version}`,
    );
  }

  const key: CopyKeyInput = {
    framework: options.module,
    frameworkVersion: options.version,
    probeVersion: options.probeVersion,
    toolchain: options.toolchain,
    patchDigest: await digestPatchSet(options.patchSetDir),
  };
  const dir = copyDir(key, options.env);
  const built = !(await isComplete(dir));
  if (built) {
    await prepareCopyDir(dir);
    await materializeUpstream(
      await ensureUpstreamModule({
        module: options.module,
        version: options.version,
        cachePath: moduleCachePath(options.module, options.version),
        env: options.env,
      }),
      dir,
    );
    await applyPatchSet(dir, options.patchSetDir);
    await writeProvenance(dir, manifest);
    // Written last: an interrupted copy is rebuilt rather than trusted.
    await markComplete(dir, key);
  }
  return { dir, built };
}

function requirePatchSet(kind: 'bubbletea' | 'bubbles', module: string, version: string): string {
  const dir = optionalPatchSet(kind, version);
  if (dir !== undefined) return dir;
  throw new CharmPrepareError(
    'unsupported-version',
    module,
    version,
    `@termwright/probe-charm has no verified ${kind} patch set for ${module} ${version}`,
  );
}

function requireBubblesUnitProfile(major: CharmMajor, module: string): string {
  const version = BUBBLES_UNIT_PROFILES[major];
  const dir = optionalPatchSet('bubbles', version);
  if (dir !== undefined) return dir;
  throw new CharmPrepareError(
    'unsupported-capability',
    module,
    version,
    `@termwright/probe-charm is missing its owned ${major} Bubbles accessor profile`,
  );
}

function optionalPatchSet(kind: 'bubbletea' | 'bubbles', version: string): string | undefined {
  const dir = join(packageRoot(), 'upstream-patches', kind, version);
  return existsSync(join(dir, 'manifest.json')) ? dir : undefined;
}

/** Directory layout used by Go for these lowercase, unescaped module paths. */
function moduleCachePath(module: string, version: string): readonly string[] {
  const parts = module.split('/');
  const last = parts.pop();
  if (last === undefined) return [];
  return [...parts, `${last}@${version}`];
}

async function toolchain(env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run('go', ['version'], { env });
  return stdout.trim();
}

/**
 * Keeps generated workspaces outside the application and gives each module an
 * independent path. A single framework cache entry may be shared by many
 * projects; putting one `generated.work` next to it would make those projects
 * overwrite each other's build plan.
 */
async function defaultWorkspaceFile(
  plan: {
    readonly moduleDir: string;
    readonly inherited: Awaited<ReturnType<typeof readWorkspace>>;
    readonly replaces: readonly { readonly from: string; readonly to: string }[];
  },
  env: NodeJS.ProcessEnv,
): Promise<string> {
  let canonical = plan.moduleDir;
  try {
    canonical = await realpath(plan.moduleDir);
  } catch {
    // writeWorkspace will report a missing module more usefully than hashing does.
  }
  const id = createHash('sha256')
    .update(JSON.stringify({ ...plan, moduleDir: canonical }))
    .digest('hex')
    .slice(0, 24);
  return join(cacheRoot(env), 'workspaces', 'probe-charm', id, 'generated.work');
}

async function defaultClientDir(env: NodeJS.ProcessEnv): Promise<string> {
  const vendored = join(packageRoot(), 'go-client');
  if (existsSync(join(vendored, 'go.mod'))) return vendored;

  const inRepo = join(packageRoot(), '..', '..', 'clients', 'go');
  if (existsSync(join(inRepo, 'go.mod'))) return inRepo;

  // npm and Go are released from the same versioned commit. A published npm
  // package does not live inside this monorepo, so resolve the matching Go
  // module into GOMODCACHE rather than making one-call setup require another
  // manual download/path option.
  const version = `v${PROBE_VERSION}`;
  return ensureUpstreamModule({
    module: CLIENT_MODULE,
    version,
    cachePath: moduleCachePath(CLIENT_MODULE, version),
    env,
  });
}

function packageRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
