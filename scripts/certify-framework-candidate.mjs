#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, compareVersions, downloadVerifiedNpmTarball, resolveNpmSource, trustedGoEnvironment } from './discover-framework-candidates.mjs';
import { materializeCandidateSource, preparePatchBundle, proposeCompatibilityUpdate, recordExecutableVariant } from './prepare-framework-candidate.mjs';
import { safeExtractTarGz } from './safe-tar.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function writeVerdict(path, candidate, state, detail, sourceRevision, executableResolution) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson({
    schemaVersion: 1,
    kind: 'termwright-framework-candidate-verdict',
    candidateId: candidate.id,
    candidateDigest: candidate.candidateDigest,
    sourceRevision,
    state,
    detail: String(detail).slice(-12_000),
    ...(executableResolution === undefined ? {} : { executableResolution }),
  }));
}

async function run(command, args, env = process.env, cwd = root) {
  try {
    const result = await exec(command, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
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

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function filesBelow(directory) {
  const found = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  await visit(directory);
  return found.sort();
}

export async function deriveHookInstrumentationProfile(candidate, archiveBytes, sourceRevision) {
  if (!['ink', 'opentui'].includes(candidate.frameworkId)) throw new Error(`${candidate.id}: no deterministic hook profile generator`);
  const scratch = await mkdtemp(join(tmpdir(), 'termwright-hook-source-'));
  await safeExtractTarGz(archiveBytes, scratch, { stripComponents: 1 });
  const binding = { framework: candidate.frameworkId, version: candidate.version, candidateDigest: candidate.candidateDigest, sourceRevision };
  if (candidate.frameworkId === 'ink') {
    const renderer = await readFile(join(scratch, 'build/renderer.js'));
    const core = await readFile(join(scratch, 'build/ink.js'));
    return { ...binding, rendererSha256: sha256(renderer), coreSha256: sha256(core), sources: { renderer: renderer.toString('utf8'), core: core.toString('utf8') } };
  }
  const builds = [];
  for (const path of await filesBelow(scratch)) {
    const match = /(?:^|\/)(chunk-(node|bun)-[A-Za-z0-9_-]+\.js)$/u.exec(path);
    if (match === null) continue;
    const source = await readFile(path, 'utf8');
    if (!source.includes('pushHitGridScissorRect') || !source.includes('nativeStatus === "rendered"') || !source.includes('propagateLiveCount(delta)')) continue;
    builds.push({ id: match[1].slice('chunk-'.length, -'.js'.length), file: match[1], sha256: sha256(source), source });
  }
  if (builds.length !== 2 || new Set(builds.map((entry) => entry.id.split('-')[0])).size !== 2) {
    throw new Error(`${candidate.id}: expected exactly one Node and one Bun OpenTUI chunk, found ${builds.map((entry) => entry.file).join(', ')}`);
  }
  return { ...binding, builds: canonicalOpenTuiBuilds(builds) };
}

export function canonicalOpenTuiBuilds(builds) {
  const rank = (entry) => entry.id.startsWith('node-') ? 0 : entry.id.startsWith('bun-') ? 1 : 2;
  return [...builds].sort((left, right) => rank(left) - rank(right) || left.id.localeCompare(right.id) || left.file.localeCompare(right.file));
}

async function writeHookUpdate(output, candidate, profile, sourceRevision) {
  const directory = join(dirname(output), `candidate-update-hook-${candidate.candidateDigest.slice('sha256:'.length, 'sha256:'.length + 16)}`);
  await mkdir(directory, { recursive: true });
  const publicProfile = candidate.frameworkId === 'ink'
    ? { version: profile.version, rendererSha256: profile.rendererSha256, coreSha256: profile.coreSha256 }
    : { version: profile.version, builds: profile.builds.map(({ source: _source, ...build }) => build) };
  const metadata = {
    schemaVersion: 1,
    kind: 'termwright-generated-hook-profile',
    candidateId: candidate.id,
    candidateDigest: candidate.candidateDigest,
    sourceRevision,
    framework: candidate.frameworkId,
    profile: publicProfile,
    profileDigest: `sha256:${sha256(canonicalJson(publicProfile))}`,
  };
  await writeFile(join(directory, 'bundle.json'), canonicalJson(metadata));
}

function withoutSha256Prefix(value) {
  return typeof value === 'string' && value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}

async function eventually(assertion, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await assertion();
      if (value) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`${label}${last instanceof Error ? `: ${last.message}` : ''}`);
}

export function verifyCandidateEvidence(candidate, report, behavioralCertification) {
  if (behavioralCertification?.passed !== true) {
    throw new Error(`${candidate.id}: patch report is not behaviorally certified for stable publication`);
  }
  const evidence = report.candidates?.find((entry) => entry.module === candidate.package && entry.upstreamVersion === candidate.version);
  if (evidence === undefined) throw new Error(`${candidate.id}: patch certifier produced no exact candidate evidence`);
  if (candidate.registry === 'go') {
    if (
      evidence.material?.sum !== candidate.source.sum
      || evidence.material?.goModSum !== candidate.source.goModSum
      || withoutSha256Prefix(evidence.material?.zipDigest) !== candidate.source.zipSha256
    ) throw new Error(`${candidate.id}: certified Go source does not match the discovered checksums`);
  } else if (
    withoutSha256Prefix(evidence.material?.checksum) !== candidate.source.checksum
    || withoutSha256Prefix(evidence.material?.archiveDigest) !== candidate.source.checksum
  ) throw new Error(`${candidate.id}: certified crates.io source does not match the discovered checksum`);
}

export function candidateToolchainBlock(candidate, approvedGoVersion) {
  if (candidate.source?.toolchainSupported !== false) return null;
  if (typeof candidate.source.requiredGoVersion !== 'string') throw new Error(`${candidate.id}: unsupported toolchain evidence has no required Go version`);
  return `${candidate.id}: requires Go >= ${candidate.source.requiredGoVersion}; trusted certification is pinned to Go ${approvedGoVersion}`;
}

export async function assertCandidateSemanticSession(session, candidateId) {
  const contract = await session.settled();
  if (contract.capabilities['semantic-tree'].status !== 'supported' || session.semanticTree()?.v !== 2) {
    throw new Error(`${candidateId}: exact application produced no supported semantic tree`);
  }
}

export async function certifyGoCandidateBehavior(candidate) {
  const scratch = await mkdtemp(join(tmpdir(), 'termwright-go-behavior-'));
  const app = join(scratch, 'app');
  await mkdir(app);
  const env = trustedGoEnvironment({ GOWORK: 'off', GOFLAGS: '', TERMWRIGHT_CACHE_DIR: join(scratch, 'cache') });
  let launcherPackage;
  let source;
  if (candidate.frameworkId === 'tview') {
    launcherPackage = join(root, 'packages/probe-tview/dist/index.js');
    await run('cp', ['-R', `${join(root, 'packages/probe-tview/src/testing/fixture-app')}/.`, app]);
    await run('go', ['mod', 'edit', `-require=${candidate.package}@${candidate.version}`], env, app);
  } else if (candidate.frameworkId === 'charm') {
    launcherPackage = join(root, 'packages/probe-charm/dist/index.js');
    const v2 = candidate.package.startsWith('charm.land/');
    const tea = v2 ? 'charm.land/bubbletea/v2' : 'github.com/charmbracelet/bubbletea';
    const bubbles = v2 ? 'charm.land/bubbles/v2' : 'github.com/charmbracelet/bubbles';
    const isBubbles = candidate.package === bubbles;
    let certifiedTeaVersion;
    if (isBubbles) {
      const compatibility = JSON.parse(await readFile(join(root, 'compatibility/registry.json'), 'utf8'));
      const versions = compatibility.frameworks.find((entry) => entry.id === 'charm')?.instrumentation?.patchSets
        ?.filter((entry) => entry.name === tea)
        .map((entry) => entry.version)
        .sort((left, right) => compareVersions(right, left)) ?? [];
      [certifiedTeaVersion] = versions;
      if (certifiedTeaVersion === undefined) throw new Error(`${candidate.id}: no certified Bubble Tea companion exists for candidate-specific behavior`);
    }
    source = isBubbles
      ? (v2
        ? `package main\nimport (\n "fmt"\n tea "${tea}"\n "${bubbles}/textinput"\n)\ntype model struct { Input textinput.Model }\nfunc initial() model { i:=textinput.New(); i.Focus(); return model{Input:i} }\nfunc (m model) Init() tea.Cmd { return nil }\nfunc (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) { var c tea.Cmd; m.Input,c=m.Input.Update(msg); return m,c }\nfunc (m model) View() tea.View { return tea.NewView(fmt.Sprintf("candidate\\n%s",m.Input.View())) }\nfunc main(){ _,_ = tea.NewProgram(initial()).Run() }\n`
        : `package main\nimport (\n "fmt"\n tea "${tea}"\n "${bubbles}/textinput"\n)\ntype model struct { Input textinput.Model }\nfunc initial() model { i:=textinput.New(); i.Focus(); return model{Input:i} }\nfunc (m model) Init() tea.Cmd { return nil }\nfunc (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) { var c tea.Cmd; m.Input,c=m.Input.Update(msg); return m,c }\nfunc (m model) View() string { return fmt.Sprintf("candidate\\n%s\\n",m.Input.View()) }\nfunc main(){ if _,err:=tea.NewProgram(initial()).Run(); err!=nil { panic(err) } }\n`)
      : (v2
        ? `package main\nimport tea "${tea}"\ntype model struct { Status string }\nfunc (m model) Init() tea.Cmd{return nil}\nfunc (m model) Update(msg tea.Msg)(tea.Model,tea.Cmd){ if k,ok:=msg.(tea.KeyPressMsg); ok && k.String()=="x" {m.Status="changed"}; return m,nil }\nfunc (m model) View() tea.View{return tea.NewView(m.Status)}\nfunc main(){_,_=tea.NewProgram(model{Status:"ready"}).Run()}\n`
        : `package main\nimport tea "${tea}"\ntype model struct { Status string }\nfunc (m model) Init() tea.Cmd{return nil}\nfunc (m model) Update(msg tea.Msg)(tea.Model,tea.Cmd){ if k,ok:=msg.(tea.KeyMsg); ok && k.String()=="x" {m.Status="changed"}; return m,nil }\nfunc (m model) View() string{return m.Status+"\\n"}\nfunc main(){if _,err:=tea.NewProgram(model{Status:"ready"}).Run(); err!=nil {panic(err)}}\n`);
    await writeFile(join(app, 'go.mod'), `module example.com/termwright-candidate\n\ngo 1.24\n\nrequire (\n\t${candidate.package} ${candidate.version}\n${certifiedTeaVersion === undefined ? '' : `\t${tea} ${certifiedTeaVersion}\n`})\n`);
    await writeFile(join(app, 'main.go'), source);
  } else throw new Error(`${candidate.id}: no candidate-specific Go behavioral profile`);
  await run('go', ['mod', 'tidy'], env, app);
  const launcher = await import(pathToFileURL(launcherPackage).href);
  const prepared = await launcher.prepareInstrumentedBuild({ moduleDir: app, env });
  const binary = join(scratch, 'candidate-app');
  await run('go', ['build', '-o', binary, '.'], prepared.env, app);
  const driver = await import(pathToFileURL(join(root, 'packages/driver/dist/index.js')).href);
  const session = await driver.launchTerminal({
    command: [binary],
    columns: 80,
    rows: 24,
    requiredCapabilities: ['semantic-tree'],
  });
  try {
    await session.waitForText(candidate.frameworkId === 'tview' ? 'readme.md' : candidate.package.includes('bubbles') ? 'candidate' : 'ready');
    await assertCandidateSemanticSession(session, candidate.id);
    if (candidate.frameworkId === 'tview') {
      await eventually(async () => await session.getByRole('button', { name: 'Save' }).count() === 1, `${candidate.id}: exact tview button semantics missing`);
      await session.press('Tab');
    } else if (candidate.package.includes('bubbles')) {
      await eventually(async () => await session.getByRole('textbox').count() >= 1, `${candidate.id}: exact Bubbles component semantics missing`);
      await session.type('edge');
      await session.waitForText('edge');
    } else {
      await session.press('x');
      await session.waitForText('changed');
    }
  } finally {
    await session.close();
  }
  const modules = candidate.frameworkId === 'tview'
    ? [{ name: candidate.package, version: candidate.version }]
    : [
      { name: prepared.flavour.module, version: prepared.flavour.version },
      ...Object.keys(prepared.companionCopyDirs).sort().map((name) => ({ name, version: prepared.flavour.companions[name], optional: true })),
    ];
  if (!modules.some((module) => module.name === candidate.package && module.version === candidate.version)) throw new Error(`${candidate.id}: exact candidate was not on the executed instrumented path`);
  return { passed: true, resolution: { frameworkVersion: candidate.frameworkId === 'tview' ? candidate.version : prepared.flavour.version, modules } };
}

export async function certifyRustCandidateBehavior(candidate) {
  if (candidate.frameworkId !== 'ratatui' || !['ratatui-core', 'ratatui-widgets'].includes(candidate.package)) throw new Error(`${candidate.id}: no candidate-specific Rust behavioral profile`);
  const compatibility = JSON.parse(await readFile(join(root, 'compatibility/registry.json'), 'utf8'));
  const framework = compatibility.frameworks.find((entry) => entry.id === 'ratatui');
  const currentVariant = framework?.instrumentation?.variants
    ?.slice()
    .sort((left, right) => compareVersions(right.frameworkVersion, left.frameworkVersion))[0];
  if (currentVariant === undefined) throw new Error(`${candidate.id}: no certified Ratatui framework variant exists`);
  const versions = Object.fromEntries(currentVariant.modules.map((module) => [module.name, module.version]));
  versions[candidate.package] = candidate.version;
  const scratch = await mkdtemp(join(tmpdir(), 'termwright-rust-behavior-'));
  await mkdir(join(scratch, 'src'));
  await writeFile(join(scratch, 'src/main.rs'), 'fn main() {}\n');
  await writeFile(join(scratch, 'Cargo.toml'), `[package]\nname = "termwright-candidate-prefetch"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\nratatui = "=${currentVariant.frameworkVersion}"\nratatui-core = "=${versions['ratatui-core']}"\nratatui-widgets = "=${versions['ratatui-widgets']}"\n`);
  await run('cargo', ['fetch', '--manifest-path', join(scratch, 'Cargo.toml')]);
  const env = {
    ...process.env,
    TERMWRIGHT_REQUIRE_RATATUI: '1',
    TERMWRIGHT_CANDIDATE_RATATUI: currentVariant.frameworkVersion,
    TERMWRIGHT_CANDIDATE_RATATUI_CORE: versions['ratatui-core'],
    TERMWRIGHT_CANDIDATE_RATATUI_WIDGETS: versions['ratatui-widgets'],
  };
  const test = candidate.package === 'ratatui-core'
    ? 'a_vanilla_app_publishes_a_validated_tree'
    : 'a_list_publishes_its_items_and_the_selected_row';
  await run('cargo', ['test', '--manifest-path', 'clients/rust-probe/Cargo.toml', '--test', 'patchset', test, '--', '--nocapture'], env);
  return {
    passed: true,
    resolution: {
      frameworkVersion: currentVariant.frameworkVersion,
      modules: [
        { name: 'ratatui-core', version: versions['ratatui-core'] },
        { name: 'ratatui-widgets', version: versions['ratatui-widgets'] },
      ],
    },
  };
}

async function main(argv) {
  let registryPath;
  let candidateId;
  let output;
  let initializeOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--registry') registryPath = resolve(argv[++i]);
    else if (argv[i] === '--candidate') candidateId = argv[++i];
    else if (argv[i] === '--output') output = resolve(argv[++i]);
    else if (argv[i] === '--initialize-only') initializeOnly = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (registryPath === undefined || candidateId === undefined || output === undefined) throw new Error('--registry, --candidate and --output are required');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const candidate = registry.candidates.find((entry) => entry.id === candidateId);
  if (candidate === undefined) throw new Error(`candidate registry has no ${candidateId}`);
  const revision = process.env.GITHUB_SHA ?? 'local-unpinned';
  await writeVerdict(output, candidate, 'red', 'Certification did not complete; inspect the job log.', revision);
  if (initializeOnly) return;
  const toolchainBlock = candidateToolchainBlock(candidate, process.env.TERMWRIGHT_UPSTREAM_GO_VERSION ?? 'unknown');
  if (toolchainBlock !== null) {
    await writeVerdict(output, candidate, 'red', toolchainBlock, revision);
    throw new Error(toolchainBlock);
  }
  if (candidate.mode === 'hook') {
    try {
      if (candidate.registry === 'npm') {
        if (candidate.source.closureComplete !== true) throw new Error(`${candidate.id}: production dependency closure is not fully pinned: ${JSON.stringify(candidate.source.unresolvedDependencyDeclarations ?? [])}`);
        if (candidate.monitorDependencyClosure === true) {
          const current = await resolveNpmSource({ id: candidate.streamId, monitorDependencyClosure: true }, candidate.source, { reuseSource: candidate.source });
          if (current.closureDigest !== candidate.source.closureDigest) throw new Error(`${candidate.id}: npm dependency closure changed after discovery`);
        }
        const probe = candidate.frameworkId === 'ink' ? '@termwright/probe-ink' : '@termwright/probe-opentui';
        const material = await mkdtemp(join(tmpdir(), 'termwright-npm-candidate-'));
        const archive = join(material, 'candidate.tgz');
        const archiveBytes = await downloadVerifiedNpmTarball(candidate.source);
        await writeFile(archive, archiveBytes);
        const profile = await deriveHookInstrumentationProfile(candidate, archiveBytes, revision);
        const runtimeProfile = candidate.frameworkId === 'ink'
          ? { framework: profile.framework, version: profile.version, candidateDigest: profile.candidateDigest, sourceRevision: profile.sourceRevision, rendererSha256: profile.rendererSha256, coreSha256: profile.coreSha256 }
          : { framework: profile.framework, version: profile.version, candidateDigest: profile.candidateDigest, sourceRevision: profile.sourceRevision, builds: profile.builds.map(({ source: _source, ...build }) => build) };
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
          const instrumentation = await import(pathToFileURL(join(root, `packages/probe-${candidate.frameworkId}/dist/instrumentation.js`)).href);
          if (candidate.frameworkId === 'ink') {
            if (instrumentation.instrumentInkRenderer('ink/build/renderer.js', profile.sources.renderer) === undefined || instrumentation.instrumentInkCore('ink/build/ink.js', profile.sources.core) === undefined) {
              throw new Error(`${candidate.id}: exact Ink transform anchors no longer apply`);
            }
          } else {
            for (const build of profile.builds) {
              if (instrumentation.instrumentOpenTuiChunk(`/@opentui/core/${build.file}`, build.source) === undefined) throw new Error(`${candidate.id}: exact OpenTUI transform anchors no longer apply to ${build.file}`);
            }
          }
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
        await run('pnpm', ['--filter', probe, 'add', '--save-dev', '--save-exact', '--lockfile=false', '--ignore-scripts', archive], certificationEnv);
        await run('pnpm', ['--filter', probe, 'run', 'test'], certificationEnv);
        await run('pnpm', ['--filter', '@termwright/conformance', 'run', 'conformance', '--require-no-skipped-areas'], certificationEnv);
        await writeHookUpdate(output, candidate, profile, revision);
      } else if (candidate.registry === 'pypi') {
        await run('python', ['-m', 'pip', 'install', `${candidate.source.url}#sha256=${candidate.source.sha256}`]);
        const certificationEnv = {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          GITHUB_SHA: revision,
          TERMWRIGHT_CERTIFICATION_TEXTUAL_VERSION: candidate.version,
          TERMWRIGHT_CERTIFICATION_CANDIDATE_DIGEST: candidate.candidateDigest,
          TERMWRIGHT_CERTIFICATION_SOURCE_REVISION: revision,
          TERMWRIGHT_REQUIRE_RATATUI: '1',
        };
        await run('python', ['-m', 'pytest', 'clients/python/tests'], certificationEnv);
        await run('pnpm', ['--filter', '@termwright/conformance', 'run', 'conformance', '--require-no-skipped-areas'], certificationEnv);
      } else {
        throw new Error(`${candidate.id}: unsupported hook registry ${candidate.registry}`);
      }
      await writeVerdict(output, candidate, 'green', 'Exact hook-based framework artifact and full conformance passed.', revision);
      return;
    } catch (error) {
      await writeVerdict(output, candidate, 'red', error instanceof Error ? error.message : String(error), revision);
      throw error;
    }
  }
  try {
    let proposedRegistry;
    if (candidate.patch.status === 'needs-patch') {
      const updateDirectory = join(dirname(output), `candidate-update-${candidate.candidateDigest.slice('sha256:'.length, 'sha256:'.length + 16)}`);
      const sourceRoot = await materializeCandidateSource(candidate);
      const prepared = await preparePatchBundle({ rootDir: root, candidate, sourceRoot, outputDirectory: updateDirectory, sourceRevision: revision });
      const targetDirectory = join(root, prepared.metadata.targetPath);
      await mkdir(dirname(targetDirectory), { recursive: true });
      await run('cp', ['-R', prepared.destination, targetDirectory]);
      const registryPath = join(root, 'compatibility/registry.json');
      proposedRegistry = proposeCompatibilityUpdate(JSON.parse(await readFile(registryPath, 'utf8')), candidate, prepared.manifest);
      await writeFile(registryPath, canonicalJson(proposedRegistry));
      await writeFile(join(updateDirectory, 'compatibility-registry.json'), canonicalJson(proposedRegistry));
    } else if (candidate.patch.status === 'ready') {
      const registryPath = join(root, 'compatibility/registry.json');
      const manifest = JSON.parse(await readFile(join(root, candidate.patch.path), 'utf8'));
      proposedRegistry = proposeCompatibilityUpdate(JSON.parse(await readFile(registryPath, 'utf8')), candidate, manifest);
      await writeFile(registryPath, canonicalJson(proposedRegistry));
    } else {
      throw new Error(`${candidate.id}: unsupported patch state ${candidate.patch.status}`);
    }
    const evidenceDirectory = join(dirname(output), 'patch-evidence');
    await run('node', ['scripts/certify-upstream-patches.mjs', '--ecosystem', candidate.ecosystem, '--source-revision', revision, '--output', evidenceDirectory]);
    const behavioral = candidate.registry === 'go'
      ? await certifyGoCandidateBehavior(candidate)
      : candidate.registry === 'crates.io'
        ? await certifyRustCandidateBehavior(candidate)
        : { passed: false };
    verifyCandidateEvidence(candidate, JSON.parse(await readFile(join(evidenceDirectory, 'candidate-report.json'), 'utf8')), behavioral);
    proposedRegistry = recordExecutableVariant(proposedRegistry, candidate, behavioral.resolution);
    await writeFile(join(root, 'compatibility/registry.json'), canonicalJson(proposedRegistry));
    await run('pnpm', ['run', 'test:compatibility']);
    await run('pnpm', ['--filter', '@termwright/conformance', 'run', 'conformance', '--require-no-skipped-areas'], { ...process.env, TERMWRIGHT_REQUIRE_RATATUI: '1' });
    await writeVerdict(output, candidate, 'green', 'Exact source, deterministic patching, candidate-specific real-process behavior, and full conformance passed.', revision, behavioral.resolution);
  } catch (error) {
    await writeVerdict(output, candidate, 'red', error instanceof Error ? error.message : String(error), revision);
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
