#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, compareVersions, downloadVerifiedNpmTarball, resolveNpmSource, trustedGoEnvironment } from './discover-framework-candidates.mjs';
import { digestTree, materializeCandidateSource, preparePatchBundle, proposeCompatibilityUpdate, recordExecutableVariant, removeMaterializedCandidateSource } from './prepare-framework-candidate.mjs';
import { pnpmInvocation } from './package-manager-command.mjs';
import { finishWithCleanups } from './cleanup-resources.mjs';
import { safeExtractTarGz } from './safe-tar.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function certificationPlatform(nodePlatform = process.platform) {
  if (nodePlatform === 'linux') return 'linux';
  if (nodePlatform === 'darwin') return 'macos';
  if (nodePlatform === 'win32') return 'windows';
  throw new Error(`unsupported certification host platform ${nodePlatform}`);
}

export function candidateExecutableName(platform = certificationPlatform()) {
  return platform === 'windows' ? 'candidate-app.exe' : 'candidate-app';
}

export function assertRustTestDiscovered(stdout, test, candidateId) {
  if (!String(stdout).split(/\r?\n/u).includes(`${test}: test`)) {
    throw new Error(`${candidateId}: certification test ${test} was not discovered by the Rust test harness`);
  }
}

async function writeVerdict(path, candidate, state, detail, sourceRevision, executableResolution) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    canonicalJson({
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision,
      platform: certificationPlatform(),
      state,
      detail: String(detail).slice(-12_000),
      ...(executableResolution === undefined ? {} : { executableResolution }),
    }),
  );
}

async function run(command, args, env = process.env, cwd = root) {
  try {
    const result = await exec(command, args, {
      cwd,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result;
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    const detail = [error instanceof Error ? error.message : String(error), stdout, stderr].filter(Boolean).join('\n');
    throw new Error(detail, { cause: error });
  }
}

async function runPnpm(args, env = process.env, cwd = root) {
  const invocation = pnpmInvocation(args, { env });
  return run(invocation.command, invocation.args, env, cwd);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function packageRootForEntry(entry, expectedName) {
  let directory = dirname(entry);
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === expectedName) return { directory, manifest };
    } catch {
      // Keep walking to the package boundary.
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`installed npm package ${expectedName} has no reachable package.json`);
    directory = parent;
  }
}

export async function installedDependencyFrom(parentDirectory, dependencyName) {
  let directory = parentDirectory;
  const segments = dependencyName.split('/');
  for (;;) {
    const dependencyDirectory = join(directory, 'node_modules', ...segments);
    try {
      const manifest = JSON.parse(await readFile(join(dependencyDirectory, 'package.json'), 'utf8'));
      // pnpm links a dependency into its parent's virtual node_modules. Its own
      // dependencies are siblings of the real package location, not siblings
      // of that lexical alias, so recursive lookup must follow the real path.
      return { directory: await realpath(dependencyDirectory), manifest };
    } catch {
      // Node's lookup walks ancestor node_modules directories, including peers.
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`installed npm graph cannot resolve ${dependencyName}`);
    directory = parent;
  }
}

function installedDeclarations(manifest) {
  const declarations = new Map();
  for (const [type, values] of [
    ['dependency', manifest.dependencies ?? {}],
    ['peer', manifest.peerDependencies ?? {}],
    ['optional', manifest.optionalDependencies ?? {}],
  ]) {
    for (const [name, requested] of Object.entries(values)) {
      if (type === 'dependency' && Object.hasOwn(manifest.optionalDependencies ?? {}, name)) continue;
      declarations.set(`${type}\0${name}`, {
        name,
        requested,
        type,
        optionalPeer: type === 'peer' && manifest.peerDependenciesMeta?.[name]?.optional === true,
      });
    }
  }
  return [...declarations.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

export function packageContentDigestForEntries(files) {
  return `sha256:${sha256(canonicalJson(files))}`;
}

async function packageContentDigest(directory) {
  const files = [];
  const visit = async (current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      // npm tarballs do not own package-manager launchers. pnpm materializes
      // these below an installed package when one of its dependencies exposes
      // a bin, so comparing them with archive contents would reject an exact
      // install. No other node_modules content is exempt: bundled dependencies
      // and unexpected installed bytes remain part of the digest.
      if (entry.isDirectory() && relative(directory, path).split(sep).join('/') === 'node_modules/.bin') continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile())
        files.push({
          path: relative(directory, path).split(sep).join('/'),
          executableMode: (await stat(path)).mode & 0o111,
          sha256: `sha256:${sha256(await readFile(path))}`,
        });
      else throw new Error(`installed npm package contains a non-regular entry: ${path}`);
    }
  };
  await visit(directory);
  return packageContentDigestForEntries(files);
}

function declaredBinNames(manifest) {
  if (typeof manifest.bin === 'string') return [String(manifest.name).split('/').at(-1)];
  if (manifest.bin !== null && typeof manifest.bin === 'object' && !Array.isArray(manifest.bin)) {
    return Object.keys(manifest.bin);
  }
  return [];
}

async function verifyMaterializedBinLaunchers(packageDirectory, expectedNames, candidateId) {
  const binDirectory = join(packageDirectory, 'node_modules', '.bin');
  let entries;
  try {
    entries = await readdir(binDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') entries = [];
    else throw error;
  }
  const expected = new Set(expectedNames);
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new Error(`${candidateId}: installed package-manager bin entry is not a file: ${entry.name}`);
    }
    const baseName = entry.name.replace(/\.(?:cmd|ps1)$/u, '');
    if (!expected.has(baseName)) {
      throw new Error(`${candidateId}: installed package-manager bin entry is undeclared: ${entry.name}`);
    }
    seen.add(baseName);
  }
  const missing = [...expected].filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw new Error(`${candidateId}: installed package-manager bin entries are missing: ${missing.join(', ')}`);
  }
}

async function verifiedNpmPackageDigest(source, fetchImpl) {
  if (
    typeof source?.tarball !== 'string' ||
    typeof source.integrity !== 'string' ||
    !source.integrity.startsWith('sha512-') ||
    typeof source.tarballSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(source.tarballSha256)
  )
    throw new Error('npm package source is not checksum-bound');
  const response = await fetchImpl(source.tarball);
  if (!response.ok) throw new Error(`${source.tarball}: artifact download failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha512').update(bytes).digest('base64') !== source.integrity.slice('sha512-'.length)) {
    throw new Error(`${source.tarball}: sha512 did not match discovered evidence`);
  }
  if (sha256(bytes) !== source.tarballSha256) throw new Error(`${source.tarball}: sha256 did not match discovered evidence`);
  const scratch = await mkdtemp(join(tmpdir(), 'termwright-npm-package-'));
  try {
    await safeExtractTarGz(bytes, scratch, { stripComponents: 1 });
    return await packageContentDigest(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Prove that pnpm executed the checksum-resolved graph recorded at discovery. */
export async function verifyInstalledNpmClosure(candidate, probeDirectory, { fetchImpl = fetch } = {}) {
  if (candidate.source?.closureComplete !== true) throw new Error(`${candidate.id}: candidate closure is incomplete`);
  const expectedNodes = new Map(candidate.source.dependencyClosure.map((node) => [`${node.name}@${node.version}`, node]));
  const probeRequire = createRequire(join(probeDirectory, 'package.json'));
  const rootEntry = probeRequire.resolve(candidate.package);
  const rootPackage = await packageRootForEntry(rootEntry, candidate.package);
  if (rootPackage.manifest.version !== candidate.version) {
    throw new Error(`${candidate.id}: installed root is ${rootPackage.manifest.version}, expected ${candidate.version}`);
  }
  const rootExpectedDigest = await verifiedNpmPackageDigest(candidate.source, fetchImpl);
  if ((await packageContentDigest(rootPackage.directory)) !== rootExpectedDigest) {
    throw new Error(`${candidate.id}: installed root content does not match the checksum-verified tarball`);
  }
  const reachableExpected = new Set();
  const visitExpected = (edges) => {
    for (const edge of edges) {
      const key = `${edge.packageName}@${edge.version}`;
      const expected = expectedNodes.get(key);
      if (expected === undefined) throw new Error(`${candidate.id}: expected npm closure contains an unresolved edge to ${key}`);
      if (reachableExpected.has(key)) continue;
      reachableExpected.add(key);
      visitExpected(expected.dependencies);
    }
  };
  visitExpected(candidate.source.dependencyRoots);
  const unreachableExpected = [...expectedNodes.keys()].filter((key) => !reachableExpected.has(key));
  if (unreachableExpected.length > 0) throw new Error(`${candidate.id}: expected npm closure contains unreachable nodes: ${unreachableExpected.join(', ')}`);
  const visited = new Set();
  const visitedNodes = new Set();
  const visit = async (parent, expectedEdges) => {
    const expectedBinNames = new Set();
    const actualDeclarations = installedDeclarations(parent.manifest);
    const normalizedExpected = expectedEdges
      .map(({ packageName: _packageName, version: _version, ...declaration }) => declaration)
      .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
    if (canonicalJson(actualDeclarations) !== canonicalJson(normalizedExpected)) {
      throw new Error(`${candidate.id}: installed declarations changed for ${parent.manifest.name}@${parent.manifest.version}`);
    }
    for (const edge of expectedEdges) {
      let child;
      try {
        child = await installedDependencyFrom(parent.directory, edge.name);
      } catch (error) {
        if (edge.type === 'optional' || edge.optionalPeer === true) continue;
        throw new Error(`${candidate.id}: installed graph cannot resolve ${edge.name} from ${parent.manifest.name}`, { cause: error });
      }
      if (child.manifest.name !== edge.packageName) {
        throw new Error(`${candidate.id}: installed ${edge.name} resolved package ${String(child.manifest.name)}, expected ${edge.packageName}`);
      }
      if (child.manifest.version !== edge.version) {
        throw new Error(`${candidate.id}: installed ${edge.name} resolved ${child.manifest.version}, expected ${edge.version}`);
      }
      for (const name of declaredBinNames(child.manifest)) expectedBinNames.add(name);
      const key = `${child.manifest.name}@${child.manifest.version}`;
      const expected = expectedNodes.get(key);
      if (expected === undefined) throw new Error(`${candidate.id}: installed graph contains unbound ${key}`);
      if (!visitedNodes.has(key)) {
        const expectedDigest = await verifiedNpmPackageDigest(expected, fetchImpl);
        if ((await packageContentDigest(child.directory)) !== expectedDigest) {
          throw new Error(`${candidate.id}: installed ${key} content does not match the checksum-verified tarball`);
        }
        visitedNodes.add(key);
      }
      const visitKey = `${child.directory}\0${key}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      await visit(child, expected.dependencies);
    }
    await verifyMaterializedBinLaunchers(parent.directory, expectedBinNames, candidate.id);
  };
  await visit(rootPackage, candidate.source.dependencyRoots);
  return {
    package: rootPackage.manifest.name,
    version: rootPackage.manifest.version,
    resolvedNodes: visitedNodes.size,
  };
}

export async function deriveHookInstrumentationProfile(candidate, archiveBytes, sourceRevision) {
  if (candidate.frameworkId !== 'ink' || candidate.hookStrategy !== 'exact-source') throw new Error(`${candidate.id}: no deterministic exact-source hook profile generator`);
  const scratch = await mkdtemp(join(tmpdir(), 'termwright-hook-source-'));
  await safeExtractTarGz(archiveBytes, scratch, { stripComponents: 1 });
  const binding = {
    framework: candidate.frameworkId,
    version: candidate.version,
    candidateDigest: candidate.candidateDigest,
    sourceRevision,
  };
  const renderer = await readFile(join(scratch, 'build/renderer.js'));
  const core = await readFile(join(scratch, 'build/ink.js'));
  return {
    ...binding,
    rendererSha256: sha256(renderer),
    coreSha256: sha256(core),
    sources: {
      renderer: renderer.toString('utf8'),
      core: core.toString('utf8'),
    },
  };
}

export function verifyDerivedInkTransforms(candidateId, instrumentation, profile) {
  const sourceRoot = '/termwright-candidate/node_modules/ink/build';
  if (
    instrumentation.instrumentInkRenderer(`${sourceRoot}/renderer.js`, profile.sources.renderer) === undefined ||
    instrumentation.instrumentInkCore(`${sourceRoot}/ink.js`, profile.sources.core) === undefined
  ) {
    throw new Error(`${candidateId}: exact Ink transform anchors no longer apply`);
  }
}

function withoutSha256Prefix(value) {
  return typeof value === 'string' && value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}

export function verifyCandidateEvidence(candidate, report, behavioralCertification) {
  if (behavioralCertification?.passed !== true) {
    throw new Error(`${candidate.id}: patch report is not behaviorally certified for stable publication`);
  }
  const evidence = report.candidates?.find((entry) => entry.module === candidate.package && entry.upstreamVersion === candidate.version);
  if (evidence === undefined) throw new Error(`${candidate.id}: patch certifier produced no exact candidate evidence`);
  if (candidate.registry === 'go') {
    if (
      evidence.material?.sum !== candidate.source.sum ||
      evidence.material?.goModSum !== candidate.source.goModSum ||
      withoutSha256Prefix(evidence.material?.zipDigest) !== candidate.source.zipSha256
    )
      throw new Error(`${candidate.id}: certified Go source does not match the discovered checksums`);
  } else if (withoutSha256Prefix(evidence.material?.checksum) !== candidate.source.checksum || withoutSha256Prefix(evidence.material?.archiveDigest) !== candidate.source.checksum)
    throw new Error(`${candidate.id}: certified crates.io source does not match the discovered checksum`);
}

export async function verifyPreparedUpdateInvariant({ directory, bundle, patchTreeDigest }) {
  if (!Buffer.from(await readFile(join(directory, 'bundle.json'))).equals(Buffer.from(bundle))) {
    throw new Error('generated patch bundle changed after trusted preparation');
  }
  if ((await digestTree(join(directory, 'patch'))) !== patchTreeDigest) {
    throw new Error('generated patch tree changed after trusted preparation');
  }
}

export function candidateToolchainBlock(candidate, approvedGoVersion) {
  if (candidate.source?.toolchainSupported !== false) return null;
  if (typeof candidate.source.requiredGoVersion !== 'string') throw new Error(`${candidate.id}: unsupported toolchain evidence has no required Go version`);
  return `${candidate.id}: requires Go >= ${candidate.source.requiredGoVersion}; trusted certification is pinned to Go ${approvedGoVersion}`;
}

export async function assertCandidateSemanticSession(session, candidateId) {
  const contract = await session.settled();
  if (contract.capabilities['semantic-tree'].status !== 'supported' || session.semanticTree()?.v !== 2) {
    throw new Error(`${candidateId}: candidate application produced no supported semantic tree`);
  }
}

export function selectCharmCandidateComposition(candidate, patchSets, tea, bubbles) {
  if (candidate.package !== tea && candidate.package !== bubbles) {
    throw new Error(`${candidate.id}: unsupported Charm module candidate`);
  }
  const capabilityCandidate =
    candidate.mode === 'capability' && candidate.package === bubbles && candidate.capability === 'bubbles-private-state' && candidate.capabilityStrategy === 'compile-conformance';
  if (!capabilityCandidate && !patchSets.some((entry) => entry.name === candidate.package && entry.version === candidate.version)) {
    throw new Error(`${candidate.id}: exact candidate patch declaration is missing`);
  }
  const latest = (module) =>
    patchSets
      .filter((entry) => entry.name === module)
      .map((entry) => entry.version)
      .sort((left, right) => compareVersions(right, left))[0];
  const teaVersion = candidate.package === tea ? candidate.version : latest(tea);
  const bubblesVersion = candidate.package === bubbles ? candidate.version : latest(bubbles);
  if (teaVersion === undefined || bubblesVersion === undefined) {
    throw new Error(`${candidate.id}: no exact certified Charm companion exists for candidate-specific behavior`);
  }
  return { teaVersion, bubblesVersion };
}

export function isSupportedCompileCapabilityCandidate(candidate) {
  if (candidate.mode !== 'capability' || candidate.capabilityStrategy !== 'compile-conformance') return false;
  if (candidate.frameworkId === 'tview') {
    return (
      (candidate.package === 'github.com/rivo/tview' && candidate.capability === 'tview-private-state') ||
      (candidate.package === 'github.com/gdamore/tcell/v2' && candidate.capability === 'tcell-same-writer-marker')
    );
  }
  return candidate.frameworkId === 'charm' && ['github.com/charmbracelet/bubbles', 'charm.land/bubbles/v2'].includes(candidate.package) && candidate.capability === 'bubbles-private-state';
}

export async function bindLocalTermwrightGoClient(moduleDir, env = process.env, clientDir = join(root, 'clients/go')) {
  const canonicalClientDir = await realpath(clientDir);
  await run(
    'go',
    ['mod', 'edit', `-replace=github.com/gorce-ai/termwright/clients/go=${canonicalClientDir}`],
    env,
    moduleDir,
  );
  return canonicalClientDir;
}

export async function certifyGoCandidateBehavior(candidate) {
  const scratch = await mkdtemp(join(tmpdir(), 'termwright-go-behavior-'));
  const app = join(scratch, 'app');
  await mkdir(app);
  const env = trustedGoEnvironment({
    GOWORK: 'off',
    GOFLAGS: '',
    TERMWRIGHT_CACHE_DIR: join(scratch, 'cache'),
  });
  let launcherPackage;
  let source;
  let frameworkVersion;
  let tviewModules;
  if (candidate.frameworkId === 'tview') {
    if (!['github.com/rivo/tview', 'github.com/gdamore/tcell/v2'].includes(candidate.package)) {
      throw new Error(`${candidate.id}: unsupported tview module candidate`);
    }
    launcherPackage = join(root, 'packages/probe-tview/dist/index.js');
    await run('cp', ['-R', `${join(root, 'packages/probe-tview/src/testing/fixture-app')}/.`, app]);
    await run('go', ['mod', 'edit', `-require=${candidate.package}@${candidate.version}`], env, app);
    await bindLocalTermwrightGoClient(app, env);
  } else if (candidate.frameworkId === 'charm') {
    launcherPackage = join(root, 'packages/probe-charm/dist/index.js');
    const v2 = candidate.package.startsWith('charm.land/');
    const tea = v2 ? 'charm.land/bubbletea/v2' : 'github.com/charmbracelet/bubbletea';
    const bubbles = v2 ? 'charm.land/bubbles/v2' : 'github.com/charmbracelet/bubbles';
    const compatibility = JSON.parse(await readFile(join(root, 'compatibility/registry.json'), 'utf8'));
    const patchSets = compatibility.frameworks.find((entry) => entry.id === 'charm')?.instrumentation?.patchSets;
    if (!Array.isArray(patchSets)) throw new Error(`${candidate.id}: certified Charm patch declarations are missing`);
    const { teaVersion, bubblesVersion } = selectCharmCandidateComposition(candidate, patchSets, tea, bubbles);
    source = v2
      ? `package main\nimport (\n "fmt"\n tea "${tea}"\n "${bubbles}/spinner"\n)\ntype model struct { Spinner spinner.Model }\nfunc initial() model { return model{Spinner:spinner.New()} }\nfunc (m model) Init() tea.Cmd { return m.Spinner.Tick }\nfunc (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) { var c tea.Cmd; m.Spinner,c=m.Spinner.Update(msg); return m,c }\nfunc (m model) View() tea.View { return tea.NewView(fmt.Sprintf("candidate %s",m.Spinner.View())) }\nfunc main(){ _,_ = tea.NewProgram(initial()).Run() }\n`
      : `package main\nimport (\n "fmt"\n tea "${tea}"\n "${bubbles}/spinner"\n)\ntype model struct { Spinner spinner.Model }\nfunc initial() model { return model{Spinner:spinner.New()} }\nfunc (m model) Init() tea.Cmd { return m.Spinner.Tick }\nfunc (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) { var c tea.Cmd; m.Spinner,c=m.Spinner.Update(msg); return m,c }\nfunc (m model) View() string { return fmt.Sprintf("candidate %s\\n",m.Spinner.View()) }\nfunc main(){ if _,err:=tea.NewProgram(initial()).Run(); err!=nil { panic(err) } }\n`;
    await writeFile(join(app, 'go.mod'), `module example.com/termwright-candidate\n\ngo 1.25\n\nrequire (\n\t${tea} ${teaVersion}\n\t${bubbles} ${bubblesVersion}\n)\n`);
    await writeFile(join(app, 'main.go'), source);
  } else throw new Error(`${candidate.id}: no candidate-specific Go behavioral profile`);
  await run('go', ['mod', 'tidy'], env, app);
  if (candidate.frameworkId === 'tview') {
    frameworkVersion = (await run('go', ['list', '-m', '-f', '{{.Version}}', 'github.com/rivo/tview'], { ...env, GOWORK: 'off' }, app)).stdout.trim();
    const tcellVersion = (await run('go', ['list', '-m', '-f', '{{.Version}}', 'github.com/gdamore/tcell/v2'], { ...env, GOWORK: 'off' }, app)).stdout.trim();
    tviewModules = [
      { name: 'github.com/rivo/tview', version: frameworkVersion },
      { name: 'github.com/gdamore/tcell/v2', version: tcellVersion },
    ];
  }
  const launcher = await import(pathToFileURL(launcherPackage).href);
  const prepared = await launcher.prepareInstrumentedBuild({
    moduleDir: app,
    env,
  });
  const binary = join(scratch, candidateExecutableName());
  await run('go', ['build', ...prepared.goArgs, '-o', binary, '.'], prepared.env, app);
  const driver = await import(pathToFileURL(join(root, 'packages/driver/dist/index.js')).href);
  const session = await driver.launchTerminal({
    command: [binary],
    columns: 80,
    rows: 24,
    requiredCapabilities: ['semantic-tree'],
  });
  try {
    await session.waitForText(candidate.frameworkId === 'tview' ? 'readme.md' : 'candidate');
    await assertCandidateSemanticSession(session, candidate.id);
    if (candidate.frameworkId === 'tview') {
      await session.getByRole('button', { name: 'Save' }).waitFor({ state: 'attached' });
      const initial = await session.waitForCommittedObservation();
      if (initial.semanticRevision === null) throw new Error(`${candidate.id}: initial semantic tree has no committed revision`);
      await session.press('r');
      await session.waitForText('status: ready redraw:1');
      const redrawn = await session.waitForCommittedObservation();
      if (redrawn.semanticRevision === null || redrawn.semanticRevision <= initial.semanticRevision) {
        throw new Error(`${candidate.id}: causal redraw did not publish a newer semantic tree`);
      }
      await assertCandidateSemanticSession(session, candidate.id);
      await session.press('Tab');
    } else {
      const spinner = session.getByRole('status');
      await spinner.waitFor({ state: 'attached' });
      const state = await spinner.semanticState();
      if (!Number.isSafeInteger(state?.positionInSet) || !Number.isSafeInteger(state?.setSize)) {
        throw new Error(`${candidate.id}: Bubbles private spinner state was not observed through the compiled owned accessor contract`);
      }
    }
  } finally {
    await session.close();
  }
  const modules =
    candidate.frameworkId === 'tview'
      ? tviewModules
      : [
          { name: prepared.flavour.module, version: prepared.flavour.version },
          ...prepared.injectedModules
            .slice()
            .sort()
            .map((name) => ({
              name,
              version: prepared.flavour.companions[name],
              optional: true,
            })),
        ];
  if (!Array.isArray(modules) || (candidate.frameworkId === 'tview' && typeof frameworkVersion !== 'string')) {
    throw new Error(`${candidate.id}: executable framework resolution is incomplete`);
  }
  if (!modules.some((module) => module.name === candidate.package && module.version === candidate.version)) {
    throw new Error(`${candidate.id}: exact candidate was not on the executed instrumented path`);
  }
  return {
    passed: true,
    resolution: {
      frameworkVersion: candidate.frameworkId === 'tview' ? frameworkVersion : prepared.flavour.version,
      modules,
    },
  };
}

export async function certifyRustCandidateBehavior(candidate) {
  if (candidate.frameworkId !== 'ratatui' || !['ratatui-core', 'ratatui-widgets', 'ratatui-crossterm'].includes(candidate.package))
    throw new Error(`${candidate.id}: no candidate-specific Rust behavioral profile`);
  const compatibility = JSON.parse(await readFile(join(root, 'compatibility/registry.json'), 'utf8'));
  const framework = compatibility.frameworks.find((entry) => entry.id === 'ratatui');
  const currentVariant = framework?.instrumentation?.variants?.slice().sort((left, right) => compareVersions(right.frameworkVersion, left.frameworkVersion))[0];
  if (currentVariant === undefined) throw new Error(`${candidate.id}: no certified Ratatui framework variant exists`);
  const versions = Object.fromEntries(currentVariant.modules.map((module) => [module.name, module.version]));
  versions[candidate.package] = candidate.version;
  const scratch = await mkdtemp(join(tmpdir(), 'termwright-rust-behavior-'));
  await mkdir(join(scratch, 'src'));
  await writeFile(join(scratch, 'src/main.rs'), 'fn main() {}\n');
  await writeFile(
    join(scratch, 'Cargo.toml'),
    `[package]\nname = "termwright-candidate-prefetch"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\nratatui = "=${currentVariant.frameworkVersion}"\nratatui-core = "=${versions['ratatui-core']}"\nratatui-widgets = "=${versions['ratatui-widgets']}"\nratatui-crossterm = "=${versions['ratatui-crossterm']}"\n`,
  );
  await run('cargo', ['fetch', '--manifest-path', join(scratch, 'Cargo.toml')]);
  const env = {
    ...process.env,
    TERMWRIGHT_REQUIRE_RATATUI: '1',
    TERMWRIGHT_CANDIDATE_RATATUI: currentVariant.frameworkVersion,
    TERMWRIGHT_CANDIDATE_RATATUI_CORE: versions['ratatui-core'],
    TERMWRIGHT_CANDIDATE_RATATUI_WIDGETS: versions['ratatui-widgets'],
    TERMWRIGHT_CANDIDATE_RATATUI_CROSSTERM: versions['ratatui-crossterm'],
  };
  const test =
    candidate.package === 'ratatui-widgets'
      ? 'a_list_publishes_its_items_and_the_selected_row'
      : candidate.package === 'ratatui-core'
        ? 'an_annotated_custom_widget_merges_full_intent_without_physical_overrides'
        : 'crossterm_commits_after_frame_bytes_on_the_exact_same_writer';
  const testCommand = ['test', '--manifest-path', 'clients/rust-probe/Cargo.toml', '--test', 'patchset', test];
  const listed = await run('cargo', [...testCommand, '--', '--list', '--format', 'terse'], env);
  assertRustTestDiscovered(listed.stdout, test, candidate.id);
  await run('cargo', [...testCommand, '--', '--exact', '--nocapture'], env);
  return {
    passed: true,
    resolution: {
      frameworkVersion: currentVariant.frameworkVersion,
      modules: [
        { name: 'ratatui-core', version: versions['ratatui-core'] },
        { name: 'ratatui-widgets', version: versions['ratatui-widgets'] },
        { name: 'ratatui-crossterm', version: versions['ratatui-crossterm'] },
      ],
    },
  };
}

async function main(argv) {
  let registryPath;
  let candidateId;
  let output;
  let expectedPlatform;
  let initializeOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--registry') registryPath = resolve(argv[++i]);
    else if (argv[i] === '--candidate') candidateId = argv[++i];
    else if (argv[i] === '--output') output = resolve(argv[++i]);
    else if (argv[i] === '--platform') expectedPlatform = argv[++i];
    else if (argv[i] === '--initialize-only') initializeOnly = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (registryPath === undefined || candidateId === undefined || output === undefined || expectedPlatform === undefined) {
    throw new Error('--registry, --candidate, --platform and --output are required');
  }
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const candidate = registry.candidates.find((entry) => entry.id === candidateId);
  if (candidate === undefined) throw new Error(`candidate registry has no ${candidateId}`);
  const revision = process.env.GITHUB_SHA ?? 'local-unpinned';
  await writeVerdict(output, candidate, 'red', 'Certification did not complete; inspect the job log.', revision);
  const actualPlatform = certificationPlatform();
  if (expectedPlatform !== actualPlatform) {
    throw new Error(`${candidate.id}: expected ${expectedPlatform} certification but host is ${actualPlatform}`);
  }
  if (initializeOnly) return;
  const toolchainBlock = candidateToolchainBlock(candidate, process.env.TERMWRIGHT_UPSTREAM_GO_VERSION ?? 'unknown');
  if (toolchainBlock !== null) {
    await writeVerdict(output, candidate, 'red', toolchainBlock, revision);
    throw new Error(toolchainBlock);
  }
  if (candidate.mode === 'capability') {
    try {
      if (candidate.registry !== 'go' || !isSupportedCompileCapabilityCandidate(candidate)) {
        throw new Error(`${candidate.id}: unsupported capability/compile-conformance candidate`);
      }
      const behavioral = await certifyGoCandidateBehavior(candidate);
      await runPnpm(['run', 'test:compatibility']);
      await runPnpm(['--filter', '@termwright/conformance', 'run', 'conformance', '--require-no-skipped-areas'], { ...process.env, TERMWRIGHT_REQUIRE_RATATUI: '1' });
      await writeVerdict(
        output,
        candidate,
        'green',
        'Owned add-only units compiled against the candidate and candidate-specific real-process behavioral conformance passed.',
        revision,
        behavioral.resolution,
      );
      return;
    } catch (error) {
      await writeVerdict(output, candidate, 'red', error instanceof Error ? error.message : String(error), revision);
      throw error;
    }
  }
  if (candidate.mode === 'hook') {
    try {
      if (candidate.registry === 'npm') {
        if (candidate.source.closureComplete !== true)
          throw new Error(`${candidate.id}: production dependency closure is not fully pinned: ${JSON.stringify(candidate.source.unresolvedDependencyDeclarations ?? [])}`);
        if (candidate.monitorDependencyClosure === true) {
          const current = await resolveNpmSource({ id: candidate.streamId, monitorDependencyClosure: true }, candidate.source, { reuseSource: candidate.source });
          if (current.closureDigest !== candidate.source.closureDigest) throw new Error(`${candidate.id}: npm dependency closure changed after discovery`);
        }
        const probe = candidate.frameworkId === 'ink' ? '@termwright/probe-ink' : '@termwright/probe-opentui';
        const material = await mkdtemp(join(tmpdir(), 'termwright-npm-candidate-'));
        const archive = join(material, 'candidate.tgz');
        const archiveBytes = await downloadVerifiedNpmTarball(candidate.source);
        await writeFile(archive, archiveBytes);
        if (!['exact-source', 'runtime'].includes(candidate.hookStrategy)) {
          throw new Error(`${candidate.id}: hook candidate has no explicit certification strategy`);
        }
        const profile =
          candidate.hookStrategy === 'exact-source'
            ? await deriveHookInstrumentationProfile(candidate, archiveBytes, revision)
            : {
                framework: candidate.frameworkId,
                version: candidate.version,
                candidateDigest: candidate.candidateDigest,
                sourceRevision: revision,
              };
        const runtimeProfile =
          candidate.hookStrategy === 'exact-source'
            ? {
                framework: profile.framework,
                version: profile.version,
                candidateDigest: profile.candidateDigest,
                sourceRevision: profile.sourceRevision,
                rendererSha256: profile.rendererSha256,
                coreSha256: profile.coreSha256,
              }
            : profile;
        const certificationEnv = {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          GITHUB_SHA: revision,
          TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: candidate.candidateDigest,
          TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: revision,
          TERMWRIGHT_CERTIFICATION_HOOK_PROFILE: JSON.stringify(runtimeProfile),
          TERMWRIGHT_REQUIRE_RATATUI: '1',
        };
        const previous = Object.fromEntries(Object.keys(certificationEnv).map((key) => [key, process.env[key]]));
        Object.assign(process.env, certificationEnv);
        try {
          if (candidate.hookStrategy === 'exact-source') {
            const instrumentation = await import(pathToFileURL(join(root, `packages/probe-${candidate.frameworkId}/dist/instrumentation.js`)).href);
            verifyDerivedInkTransforms(candidate.id, instrumentation, profile);
          }
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
        await runPnpm(['--filter', probe, 'add', '--save-dev', '--save-exact', '--lockfile=false', '--ignore-scripts', archive], certificationEnv);
        if (candidate.monitorDependencyClosure === true) {
          await verifyInstalledNpmClosure(candidate, join(root, `packages/probe-${candidate.frameworkId}`));
        }
        if (candidate.frameworkId === 'opentui') await run('bun', ['--version'], certificationEnv);
        await runPnpm(['--filter', probe, 'run', 'test'], certificationEnv);
        await runPnpm(['--filter', '@termwright/conformance', 'run', 'conformance', '--require-no-skipped-areas'], certificationEnv);
      } else if (candidate.registry === 'pypi') {
        await run('python', ['-m', 'pip', 'install', `${candidate.source.url}#sha256=${candidate.source.sha256}`]);
        const certificationEnv = {
          ...process.env,
          TERMWRIGHT_REQUIRE_RATATUI: '1',
        };
        await run('python', ['-m', 'pytest', 'clients/python/tests'], certificationEnv);
        await runPnpm(['--filter', '@termwright/conformance', 'run', 'conformance', '--require-no-skipped-areas'], certificationEnv);
      } else {
        throw new Error(`${candidate.id}: unsupported hook registry ${candidate.registry}`);
      }
      await writeVerdict(
        output,
        candidate,
        'green',
        `${candidate.hookStrategy === 'runtime' ? 'Runtime capability/behavior' : 'Exact source-hook'} framework artifact and full conformance passed.`,
        revision,
      );
      return;
    } catch (error) {
      await writeVerdict(output, candidate, 'red', error instanceof Error ? error.message : String(error), revision);
      throw error;
    }
  }
  try {
    let proposedRegistry;
    let preparedUpdate;
    if (candidate.patch.status === 'needs-patch') {
      const updateDirectory = await mkdtemp(join(tmpdir(), 'termwright-candidate-update-'));
      const sourceLease = await materializeCandidateSource(candidate);
      let prepared;
      let hasPreparationError = false;
      let preparationError;
      try {
        prepared = await preparePatchBundle({
          rootDir: root,
          candidate,
          sourceRoot: sourceLease.sourceRoot,
          outputDirectory: updateDirectory,
          sourceRevision: revision,
        });
      } catch (error) {
        hasPreparationError = true;
        preparationError = error;
      }
      await finishWithCleanups({
        hasPrimary: hasPreparationError,
        primaryError: preparationError,
        cleanups: [async () => removeMaterializedCandidateSource(sourceLease)],
        message: `${candidate.id}: patch preparation and source cleanup failed`,
      });
      preparedUpdate = {
        directory: updateDirectory,
        bundle: await readFile(join(updateDirectory, 'bundle.json')),
        patchTreeDigest: prepared.metadata.patchTreeDigest,
      };
      const targetDirectory = join(root, prepared.metadata.targetPath);
      await mkdir(dirname(targetDirectory), { recursive: true });
      await run('cp', ['-R', prepared.destination, targetDirectory]);
      const registryPath = join(root, 'compatibility/registry.json');
      proposedRegistry = proposeCompatibilityUpdate(JSON.parse(await readFile(registryPath, 'utf8')), candidate, prepared.manifest);
      await writeFile(registryPath, canonicalJson(proposedRegistry));
    } else if (candidate.patch.status === 'ready') {
      const registryPath = join(root, 'compatibility/registry.json');
      const manifest = JSON.parse(await readFile(join(root, candidate.patch.path), 'utf8'));
      proposedRegistry = proposeCompatibilityUpdate(JSON.parse(await readFile(registryPath, 'utf8')), candidate, manifest);
      await writeFile(registryPath, canonicalJson(proposedRegistry));
    } else {
      throw new Error(`${candidate.id}: unsupported patch state ${candidate.patch.status}`);
    }
    const evidenceDirectory = await mkdtemp(join(tmpdir(), 'termwright-patch-evidence-'));
    await run('node', ['scripts/certify-upstream-patches.mjs', '--ecosystem', candidate.ecosystem, '--source-revision', revision, '--output', evidenceDirectory]);
    const behavioral =
      candidate.registry === 'go' ? await certifyGoCandidateBehavior(candidate) : candidate.registry === 'crates.io' ? await certifyRustCandidateBehavior(candidate) : { passed: false };
    verifyCandidateEvidence(candidate, JSON.parse(await readFile(join(evidenceDirectory, 'candidate-report.json'), 'utf8')), behavioral);
    proposedRegistry = recordExecutableVariant(proposedRegistry, candidate, behavioral.resolution);
    await writeFile(join(root, 'compatibility/registry.json'), canonicalJson(proposedRegistry));
    await runPnpm(['run', 'test:compatibility']);
    await runPnpm(['--filter', '@termwright/conformance', 'run', 'conformance', '--require-no-skipped-areas'], { ...process.env, TERMWRIGHT_REQUIRE_RATATUI: '1' });
    if (preparedUpdate !== undefined) await verifyPreparedUpdateInvariant(preparedUpdate);
    await writeVerdict(output, candidate, 'green', 'Exact source, deterministic patching, candidate-specific real-process behavior, and full conformance passed.', revision, behavioral.resolution);
  } catch (error) {
    await writeVerdict(output, candidate, 'red', error instanceof Error ? error.message : String(error), revision);
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
