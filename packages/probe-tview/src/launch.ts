/**
 * The one call a launcher makes.
 *
 * Everything else in this package is a step: read the workspace, materialise a
 * copy, patch it, key the cache, write the file. A user should not assemble
 * those, and neither should a test — the assembly order is where the mistakes
 * live, and there is exactly one correct one.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  applyPatchSet,
  assertNoVendorMode,
  copyDir,
  digestPatchSet,
  ensureUpstreamModule,
  isComplete,
  markComplete,
  materializeUpstream,
  prepareCopyDir,
  readManifest,
  readWorkspace,
  writeProvenance,
  writeWorkspace,
  type CopyKeyInput,
} from "@termwright/probe-go";

const run = promisify(execFile);

/** Module path of the framework this probe instruments. */
export const FRAMEWORK = "github.com/rivo/tview";

const TCELL_FRAMEWORK = "github.com/gdamore/tcell/v2";

/** Module path of the protocol client the injected probe imports. */
export const CLIENT_MODULE = "github.com/gorce-ai/termwright/clients/go";

/** Version of this probe; part of the cache key, so a new patch set invalidates copies. */
export const PROBE_VERSION = "0.2.0";

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
  /** Exact tcell companion copy providing the Windows same-handle marker hook. */
  readonly tcellCopyDir: string;
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

  const frameworkResolution = await resolvedOfficialModule(
    options.moduleDir,
    FRAMEWORK,
    env,
  );
  const frameworkVersion =
    options.frameworkVersion ?? frameworkResolution.version;
  if (frameworkVersion !== frameworkResolution.version) {
    throw new Error(
      `@termwright/probe-tview was asked to instrument ${FRAMEWORK} ${frameworkVersion}, ` +
        `but the application resolves ${frameworkResolution.version || "no version"}`,
    );
  }
  const patchSetDir = patchSetFor(frameworkVersion);
  const manifest = await readExactManifest(
    patchSetDir,
    FRAMEWORK,
    frameworkVersion,
  );

  const tcellVersion = (
    await resolvedOfficialModule(options.moduleDir, TCELL_FRAMEWORK, env)
  ).version;

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

  const tcellPatchSet = join(
    packageRoot(),
    "upstream-patches",
    "tcell",
    tcellVersion,
  );
  const tcellManifest = await readExactManifest(
    tcellPatchSet,
    TCELL_FRAMEWORK,
    tcellVersion,
  );
  const tcellKey: CopyKeyInput = {
    framework: TCELL_FRAMEWORK,
    frameworkVersion: tcellVersion,
    probeVersion: PROBE_VERSION,
    toolchain: await toolchain(env),
    patchDigest: await digestPatchSet(tcellPatchSet),
  };
  const tcellCopy = copyDir(tcellKey, env);
  const tcellBuilt = !(await isComplete(tcellCopy));
  if (tcellBuilt) {
    await prepareCopyDir(tcellCopy);
    await materializeUpstream(
      await ensureUpstreamModule({
        module: TCELL_FRAMEWORK,
        version: tcellVersion,
        cachePath: moduleCachePath(TCELL_FRAMEWORK, tcellVersion),
        env,
      }),
      tcellCopy,
    );
    await applyPatchSet(tcellCopy, tcellPatchSet);
    await writeProvenance(tcellCopy, tcellManifest);
    await markComplete(tcellCopy, tcellKey);
  }

  const workspaceFile = await writeWorkspace(
    options.workspaceFile ?? join(copy, "..", "generated.work"),
    {
      moduleDir: options.moduleDir,
      inherited: await readWorkspace(options.moduleDir),
      suppliedUses: await clientWorkspaceUses(options, env),
      replaces: [
        { from: FRAMEWORK, to: copy },
        { from: TCELL_FRAMEWORK, to: tcellCopy },
        ...(await clientVersionReplacements(options, env)),
      ],
    },
  );

  return {
    workspaceFile,
    copyDir: copy,
    tcellCopyDir: tcellCopy,
    env: { ...env, GOWORK: workspaceFile },
    built: built || tcellBuilt,
  };
}

async function resolvedOfficialModule(
  moduleDir: string,
  module: string,
  env: NodeJS.ProcessEnv,
): Promise<{ version: string }> {
  const { stdout } = await run("go", ["list", "-m", "-json", module], {
    cwd: moduleDir,
    env: { ...env, GOWORK: "off" },
  });
  const resolved = JSON.parse(stdout) as {
    readonly Path?: string;
    readonly Version?: string;
    readonly Replace?: unknown;
  };
  if (resolved.Replace != null) {
    throw new Error(
      `@termwright/probe-tview refuses replaced ${module}; exact certification requires the official ${module} module source`,
    );
  }
  if (resolved.Path !== module) {
    throw new Error(
      `@termwright/probe-tview expected ${module}, but go list resolved ${resolved.Path ?? "no module path"}`,
    );
  }
  return { version: resolved.Version ?? "" };
}

async function clientWorkspaceUses(
  options: PrepareOptions,
  env: NodeJS.ProcessEnv,
): Promise<{ dir: string; module: string }[]> {
  if ((await modulePath(options.moduleDir, env)) === CLIENT_MODULE) return [];
  return [
    {
      dir: options.clientDir ?? (await defaultClientDir(env)),
      module: CLIENT_MODULE,
    },
  ];
}

async function clientVersionReplacements(
  options: PrepareOptions,
  env: NodeJS.ProcessEnv,
): Promise<{ from: string; to: string; version: string }[]> {
  if ((await modulePath(options.moduleDir, env)) === CLIENT_MODULE) return [];
  const to = options.clientDir ?? (await defaultClientDir(env));
  const versions = new Set(["v0.0.0"]);
  try {
    const { stdout } = await run(
      "go",
      ["list", "-m", "-f", "{{.Version}}", CLIENT_MODULE],
      {
        cwd: options.moduleDir,
        env: { ...env, GOWORK: "off" },
      },
    );
    if (stdout.trim() !== "") versions.add(stdout.trim());
  } catch {
    // A project need not import annotations itself. The injected copy still
    // carries v0.0.0, which is the only version that must be redirected then.
  }
  return [...versions].map((version) => ({ from: CLIENT_MODULE, to, version }));
}

async function modulePath(
  moduleDir: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await run("go", ["list", "-m", "-f", "{{.Path}}"], {
    cwd: moduleDir,
    env: { ...env, GOWORK: "off" },
  });
  return stdout.trim();
}

/** Locates the pristine module, fetching it when the cache is cold. */
async function upstreamDir(
  version: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return ensureUpstreamModule({
    module: FRAMEWORK,
    version,
    cachePath: ["github.com", "rivo", `tview@${version}`],
    env,
  });
}

async function toolchain(env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run("go", ["version"], { env });
  return stdout.trim();
}

/** Directory layout used by Go for the lowercase client module path. */
function moduleCachePath(module: string, version: string): readonly string[] {
  const parts = module.split("/");
  const last = parts.pop();
  return last === undefined ? [] : [...parts, `${last}@${version}`];
}

function patchSetFor(version: string): string {
  return join(packageRoot(), "upstream-patches", "tview", version);
}

async function readExactManifest(
  patchSetDir: string,
  framework: string,
  version: string,
): Promise<Awaited<ReturnType<typeof readManifest>>> {
  let manifest: Awaited<ReturnType<typeof readManifest>>;
  try {
    manifest = await readManifest(patchSetDir);
  } catch (cause) {
    throw new Error(
      `@termwright/probe-tview has no exact certified patch set for ${framework} ${version || "no version"}`,
      { cause },
    );
  }
  if (
    manifest.framework !== framework ||
    manifest.frameworkVersion !== version
  ) {
    throw new Error(
      `@termwright/probe-tview patch identity mismatch for ${framework} ${version || "no version"}: ` +
        `manifest declares ${manifest.framework} ${manifest.frameworkVersion}`,
    );
  }
  return manifest;
}

/**
 * Where the protocol client lives.
 *
 * A package may vendor it as `go-client/`; this repository uses the workspace
 * source so client edits are picked up without a copy. A published standalone
 * probe resolves the matching tagged Go module into GOMODCACHE, the same
 * release strategy as probe-charm.
 */
async function defaultClientDir(env: NodeJS.ProcessEnv): Promise<string> {
  const vendored = join(packageRoot(), "go-client");
  if (existsSync(join(vendored, "go.mod"))) return vendored;

  const inRepo = join(packageRoot(), "..", "..", "clients", "go");
  if (existsSync(join(inRepo, "go.mod"))) return inRepo;

  // Published probes and the Go client are released from one versioned
  // commit. Outside the monorepo, materialise that exact module version in the
  // normal Go cache instead of requiring a second manually supplied path.
  const version = `v${PROBE_VERSION}`;
  return ensureUpstreamModule({
    module: CLIENT_MODULE,
    version,
    cachePath: moduleCachePath(CLIENT_MODULE, version),
    env,
  });
}

function packageRoot(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..");
}
