import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { assertArtifactSha256, assertGoDownloadBinding, collectTcellConsoleProfileEvidence, preparePatchBundle, preparePatchBundles, proposeCompatibilityUpdate, recordExecutableVariant, selectTcellConsoleProfiles } from './prepare-framework-candidate.mjs';

const sha = (value) => `sha256:${value.repeat(64)}`;
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const tcellTemplates = join(repositoryRoot, 'packages/probe-tview/upstream-patch-templates/tcell');

async function fixture(source = 'before\nanchor\nafter\n') {
  const rootDir = await mkdtemp(join(tmpdir(), 'tw-prepare-'));
  const template = join(rootDir, 'patches/example/2.0.0');
  const sourceRoot = join(rootDir, 'source');
  await mkdir(join(template, 'patches'), { recursive: true });
  await mkdir(join(template, 'add'), { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, 'source.txt'), source);
  await writeFile(join(template, 'patches/source.patch'), '--- a/source.txt\n+++ b/source.txt\n@@ -1,3 +1,4 @@\n before\n anchor\n+injected\n after\n');
  await writeFile(join(template, 'add/version.txt'), 'framework=2.0.0\n');
  await writeFile(join(template, 'manifest.json'), JSON.stringify({ framework: 'example', frameworkVersion: '2.0.0', patchSetVersion: 9, patched: [{ path: 'source.txt', patch: 'patches/source.patch', sha256Before: sha('a'), sha256After: sha('b') }], added: [{ path: 'version.txt', source: 'add/version.txt', sha256: sha('c') }] }));
  const candidate = { id: 'example@2.0.1', mode: 'patch', version: '2.0.1', candidateDigest: sha('d'), patch: { status: 'needs-patch', path: 'patches/example/2.0.1/manifest.json' } };
  return { rootDir, sourceRoot, candidate };
}

async function tcellSource(profile) {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'tw-tcell-ast-'));
  await writeFile(join(sourceRoot, 'screen.go'), `package tcell
type screenImpl interface{}
type baseScreen struct { screenImpl screenImpl }
`);
  const hasVten = profile === 'old-vten' || profile === 'ambiguous';
  const requiresVT = ['vt-required', 'ambiguous', 'wrong-mode-source', 'wrong-order', 'wrong-receiver', 'wrong-writer', 'nested-return'].includes(profile);
  const hasCommonShape = profile !== 'unsupported';
  const modeSetup = profile === 'wrong-mode-source'
    ? 'var om uint32\n var actual uint32\n s.setOutMode(modeVtOutput)\n s.getOutMode(&actual)'
    : profile === 'wrong-order'
      ? 'var om uint32\n s.getOutMode(&om)\n s.setOutMode(modeVtOutput)'
      : profile === 'wrong-receiver'
        ? 'var om uint32\n var other cScreen\n other.setOutMode(modeVtOutput)\n other.getOutMode(&om)'
      : 'var om uint32\n s.setOutMode(modeVtOutput)\n s.getOutMode(&om)';
  const failure = profile === 'nested-return'
    ? 'if om&modeVtOutput != modeVtOutput { _ = func() error { return errors.New("nested") }; return nil }'
    : 'if om&modeVtOutput != modeVtOutput { return errors.New("VT required") }';
  await writeFile(join(sourceRoot, 'console_win.go'), `package tcell
import (
 "errors"
 "sync"
 "syscall"
)
const modeVtOutput uint32 = 1
type cScreen struct {
 out syscall.Handle
 fini bool
 ${hasVten ? 'vten bool' : ''}
 sync.Mutex
}
func NewConsoleScreen() (any, error) { return &baseScreen{screenImpl: &cScreen{}}, nil }
func (s *cScreen) setOutMode(uint32) {}
func (s *cScreen) getOutMode(*uint32) {}
func (s *cScreen) Init() error {
 ${hasVten ? 'var oldMode uint32\n s.setOutMode(modeVtOutput)\n s.getOutMode(&oldMode)\n if oldMode&modeVtOutput == modeVtOutput { s.vten = true }' : ''}
 ${requiresVT ? `${modeSetup}\n ${failure}` : ''}
 return nil
}
func (s *cScreen) ${profile === 'wrong-writer' ? 'Show' : 'emitVtString'}() {
 ${hasCommonShape ? 'syscall.WriteConsole(s.out, nil, 0, nil, nil)' : ''}
}
`);
  return sourceRoot;
}

function tcellCandidate(version = 'v2.12.0') {
  return {
    id: `tcell-v2@${version}`,
    streamId: 'tcell-v2',
    frameworkId: 'tview',
    registry: 'go',
    package: 'github.com/gdamore/tcell/v2',
    mode: 'patch',
    version,
    candidateDigest: sha('e'),
    patch: {
      status: 'needs-patch',
      path: `packages/probe-tview/upstream-patches/tcell/${version}/manifest.json`,
    },
  };
}

const tcellFixtureProfiles = [
  'old-vten',
  'vt-required',
  'unsupported',
  'ambiguous',
  'wrong-mode-source',
  'wrong-order',
  'wrong-receiver',
  'wrong-writer',
  'nested-return',
];
const tcellFixtureEntries = await Promise.all(tcellFixtureProfiles.map(async (profile) => [profile, await tcellSource(profile)]));
const tcellSources = new Map(tcellFixtureEntries);
// Fixture collection mirrors production: one ordered AST process classifies
// the complete bounded matrix, then pure tests inspect its exact evidence.
const tcellEvidence = await collectTcellConsoleProfileEvidence(tcellFixtureEntries.map(([, sourceRoot]) => sourceRoot));
const tcellEvidenceByProfile = new Map(tcellFixtureProfiles.map((profile, index) => [profile, tcellEvidence[index]]));
const oldOutput = await mkdtemp(join(tmpdir(), 'tw-tcell-old-bundle-'));
const newOutputOne = await mkdtemp(join(tmpdir(), 'tw-tcell-new-bundle-'));
const newOutputTwo = await mkdtemp(join(tmpdir(), 'tw-tcell-new-bundle-'));
const [oldPrepared, newPreparedOne, newPreparedTwo] = await preparePatchBundles([
  { rootDir: repositoryRoot, candidate: tcellCandidate('v2.11.0'), sourceRoot: tcellSources.get('old-vten'), outputDirectory: oldOutput, sourceRevision: 'abcdef123' },
  { rootDir: repositoryRoot, candidate: tcellCandidate(), sourceRoot: tcellSources.get('vt-required'), outputDirectory: newOutputOne, sourceRevision: 'abcdef123' },
  { rootDir: repositoryRoot, candidate: tcellCandidate(), sourceRoot: tcellSources.get('vt-required'), outputDirectory: newOutputTwo, sourceRevision: 'abcdef123' },
]);

describe('framework candidate patch preparation', () => {
  it('classifies the shared tcell fixture matrix in one AST helper process', () => {
    expect(selectTcellConsoleProfiles([
      tcellEvidenceByProfile.get('old-vten'),
      tcellEvidenceByProfile.get('vt-required'),
    ])).toEqual(['old-vten', 'vt-required']);
  });

  it('binds trusted Go materialization to the discovered sum, go.mod sum, and zip bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-go-download-binding-'));
    const zip = join(directory, 'module.zip');
    await writeFile(zip, 'exact module archive');
    const result = { Dir: directory, Zip: zip, Sum: 'h1:module', GoModSum: 'h1:go-mod' };
    const candidate = {
      id: 'module@v1.2.3',
      source: {
        sum: result.Sum,
        goModSum: result.GoModSum,
        zipSha256: createHash('sha256').update('exact module archive').digest('hex'),
      },
    };
    await expect(assertGoDownloadBinding(result, candidate)).resolves.toBeUndefined();
    await expect(assertGoDownloadBinding({ ...result, Sum: 'h1:other' }, candidate)).rejects.toThrow(/identity does not match/u);
    await writeFile(zip, 'changed archive');
    await expect(assertGoDownloadBinding(result, candidate)).rejects.toThrow(/archive does not match/u);
  });
  it('rejects a registry archive before extraction when its checksum differs', () => {
    expect(() => assertArtifactSha256(Buffer.from('archive'), '0'.repeat(64), 'crate@1.0.0')).toThrow(/downloaded archive hashes/u);
  });
  it('replays an audited transform reproducibly and binds it to revision and source', async () => {
    const one = await fixture();
    const two = await fixture();
    const first = await preparePatchBundle({ ...one, outputDirectory: join(one.rootDir, 'out'), sourceRevision: 'abcdef123' });
    const second = await preparePatchBundle({ ...two, outputDirectory: join(two.rootDir, 'out'), sourceRevision: 'abcdef123' });
    expect(first.metadata.patchTreeDigest).toBe(second.metadata.patchTreeDigest);
    expect(first.metadata).toMatchObject({ candidateId: 'example@2.0.1', sourceRevision: 'abcdef123', targetPath: 'patches/example/2.0.1' });
    expect(await readFile(join(first.destination, 'add/version.txt'), 'utf8')).toBe('framework=2.0.1\n');
    expect(first.manifest.patchSetVersion).toBe(9);
  });

  it('fails closed when upstream changed the audited anchor', async () => {
    const setup = await fixture('before\nchanged\nafter\n');
    await expect(preparePatchBundle({ ...setup, outputDirectory: join(setup.rootDir, 'out'), sourceRevision: 'abcdef123' })).rejects.toThrow(/no longer applies/u);
  });

  it('rejects artifact path traversal before copying or patching', async () => {
    const setup = await fixture();
    setup.candidate.patch.path = '../outside/manifest.json';
    await expect(preparePatchBundle({ ...setup, outputDirectory: join(setup.rootDir, 'out'), sourceRevision: 'abcdef123' })).rejects.toThrow(/normalized relative path/u);
  });

  it('selects the old-vten tcell template from structural Go evidence', async () => {
    const candidate = tcellCandidate('v2.11.0');
    const marker = await readFile(join(oldPrepared.destination, 'add/termwright_marker_windows.go'), 'utf8');

    expect(oldPrepared.metadata.template).toEqual({ profileId: 'old-vten', selection: 'go-ast-capability', patchSetVersion: 2 });
    expect(oldPrepared.manifest).toMatchObject({ framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 2 });
    expect(marker).toContain('if !s.vten');
  });

  it('selects the vt-required tcell template and emits no legacy field reference', async () => {
    const candidate = tcellCandidate();
    const marker = await readFile(join(newPreparedOne.destination, 'add/termwright_marker_windows.go'), 'utf8');

    expect(newPreparedOne.metadata.template).toEqual({ profileId: 'vt-required', selection: 'go-ast-capability', patchSetVersion: 3 });
    expect(newPreparedOne.manifest).toMatchObject({ framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 3 });
    expect(marker).toContain('syscall.WriteConsole(s.out');
    expect(marker).not.toContain('s.vten');
    expect(newPreparedTwo.metadata).toEqual(newPreparedOne.metadata);
    expect(newPreparedTwo.manifest).toEqual(newPreparedOne.manifest);
  });

  it('fails closed when structural evidence matches zero or multiple tcell profiles', () => {
    expect(() => selectTcellConsoleProfiles([tcellEvidenceByProfile.get('unsupported')]))
      .toThrow(/matched 0 audited profiles/u);
    expect(() => selectTcellConsoleProfiles([tcellEvidenceByProfile.get('ambiguous')]))
      .toThrow(/matched 2 audited profiles: old-vten, vt-required/u);
  });

  it.each(['wrong-mode-source', 'wrong-order', 'wrong-receiver', 'wrong-writer', 'nested-return'])(
    'rejects incomplete structural evidence: %s',
    (profile) => {
      expect(() => selectTcellConsoleProfiles([tcellEvidenceByProfile.get(profile)]))
        .toThrow(/matched 0 audited profiles/u);
    },
  );

  it('binds tcell profile generation to the exact package, stream, and version path', async () => {
    const sourceRoot = tcellSources.get('vt-required');
    const wrongPackage = { ...tcellCandidate(), package: 'example.com/not-tcell' };
    await expect(preparePatchBundle({
      rootDir: repositoryRoot,
      candidate: wrongPackage,
      sourceRoot,
      outputDirectory: await mkdtemp(join(tmpdir(), 'tw-tcell-binding-')),
      sourceRevision: 'abcdef123',
    })).rejects.toThrow(/not bound to the exact stream, package, and version/u);

    const wrongVersionPath = tcellCandidate();
    wrongVersionPath.patch.path = 'packages/probe-tview/upstream-patches/tcell/v2.13.0/manifest.json';
    await expect(preparePatchBundle({
      rootDir: repositoryRoot,
      candidate: wrongVersionPath,
      sourceRoot,
      outputDirectory: await mkdtemp(join(tmpdir(), 'tw-tcell-binding-')),
      sourceRevision: 'abcdef123',
    })).rejects.toThrow(/not bound to the exact stream, package, and version/u);

  });

  it('keeps structural templates outside manifest-based candidate seeding', async () => {
    const entries = (await readdir(tcellTemplates, { recursive: true }))
      .map((entry) => entry.replaceAll('\\', '/'));
    expect(entries.filter((entry) => entry.endsWith('manifest.json'))).toEqual([]);
    expect(entries.filter((entry) => entry.endsWith('template.json')).sort()).toEqual([
      'old-vten/template.json',
      'vt-required/template.json',
    ]);
  });

  it('separates exact patch declarations from behaviorally certified executable variants', () => {
    let registry = {
      frameworks: [{
        id: 'charm', frameworkPackage: 'Bubble Tea', probe: { packageVersion: '0.2.0' },
        versions: { policy: 'exact', declared: 'v2.1.0', verified: ['v2.1.0'] },
        certification: { ids: ['charm@v2.1.0/0.2.0'], checksumSources: ['patches/bubbles/v2.1.0/manifest.json'] },
        instrumentation: {
          patchSets: [
            { name: 'charm.land/bubbletea/v2', version: 'v2.1.0', patchSetVersion: 1 },
            { name: 'charm.land/bubbles/v2', version: 'v2.1.0', patchSetVersion: 1 },
          ],
          variants: [{ id: 'old', frameworkVersion: 'v2.1.0', modules: [
            { name: 'charm.land/bubbletea/v2', version: 'v2.1.0' },
            { name: 'charm.land/bubbles/v2', version: 'v2.1.0', optional: true },
          ] }],
        },
      }],
    };
    const candidate = { id: 'bubbletea-v2@v2.1.1', frameworkId: 'charm', package: 'charm.land/bubbletea/v2', version: 'v2.1.1', patch: { path: 'patches/bubbletea/v2.1.1/manifest.json' } };
    registry = proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 2 });
    expect(registry.frameworks[0].instrumentation.patchSets).toContainEqual({ name: candidate.package, version: 'v2.1.1', patchSetVersion: 2 });
    expect(registry.frameworks[0].certification.checksumSources).toEqual([
      'patches/bubbles/v2.1.0/manifest.json',
      'patches/bubbletea/v2.1.1/manifest.json',
    ]);
    expect(proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 2 })).toEqual(registry);
    expect(registry.frameworks[0].instrumentation.variants).toHaveLength(1);

    registry = recordExecutableVariant(registry, candidate, { frameworkVersion: 'v2.1.1', modules: [
      { name: candidate.package, version: 'v2.1.1' },
      { name: 'charm.land/bubbles/v2', version: 'v2.1.0', optional: true },
    ] });
    expect(registry.frameworks[0].instrumentation.variants).toHaveLength(2);
    expect(registry.frameworks[0].instrumentation.variants.at(-1).modules.filter((module) => module.name === candidate.package)).toHaveLength(1);
    expect(registry.frameworks[0].versions.verified).toEqual(['v2.1.0', 'v2.1.1']);
    expect(registry.frameworks[0].certification.ids).toEqual(['charm@v2.1.0/0.2.0', 'charm@v2.1.1/0.2.0']);
  });

  it('keeps 2.1, 2.1.1, 2.2 and a late 2.1.2 as distinct exact variants without a false cross-product', () => {
    let registry = { frameworks: [{ id: 'example', frameworkPackage: 'example/core', probe: { packageVersion: '1.0.0' }, versions: { policy: 'exact', declared: '2.1', verified: ['2.1'] }, certification: { ids: ['example@2.1/1.0.0'], checksumSources: [] }, instrumentation: { patchSets: [], variants: [] } }] };
    for (const version of ['2.1', '2.1.1', '2.2', '2.1.2']) {
      const candidate = { id: `example@${version}`, frameworkId: 'example', package: 'example/core', version, patch: { path: `patches/example/${version}/manifest.json` } };
      registry = proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 1 });
      registry = recordExecutableVariant(registry, candidate, { frameworkVersion: version, modules: [{ name: 'example/core', version }] });
    }
    expect(registry.frameworks[0].instrumentation.variants.map((variant) => variant.frameworkVersion).sort())
      .toEqual(['2.1', '2.1.1', '2.1.2', '2.2']);
    expect(registry.frameworks[0].instrumentation.variants.every((variant) => variant.modules.length === 1)).toBe(true);
    expect(registry.frameworks[0].certification.ids).toEqual([
      'example@2.1/1.0.0', 'example@2.1.1/1.0.0', 'example@2.1.2/1.0.0', 'example@2.2/1.0.0',
    ]);
  });

  it('does not promote a companion candidate to a framework version', () => {
    const candidate = { id: 'bubbles-v2@v2.2.0', frameworkId: 'charm', package: 'charm.land/bubbles/v2', version: 'v2.2.0', patch: { path: 'patches/bubbles/v2.2.0/manifest.json' } };
    let registry = { frameworks: [{ id: 'charm', frameworkPackage: 'Bubble Tea', probe: { packageVersion: '0.2.0' }, versions: { policy: 'exact', declared: 'v2.0.9', verified: ['v2.0.9'] }, certification: { ids: ['charm@v2.0.9/0.2.0'], checksumSources: [] }, instrumentation: { patchSets: [{ name: 'charm.land/bubbletea/v2', version: 'v2.0.9', patchSetVersion: 17 }], variants: [] } }] };
    registry = proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 1 });
    registry = recordExecutableVariant(registry, candidate, { frameworkVersion: 'v2.0.9', modules: [
      { name: 'charm.land/bubbletea/v2', version: 'v2.0.9' },
      { name: candidate.package, version: candidate.version, optional: true },
    ] });
    expect(registry.frameworks[0].versions.verified).toEqual(['v2.0.9']);
    expect(registry.frameworks[0].certification.ids).toEqual(['charm@v2.0.9/0.2.0']);
    expect(registry.frameworks[0].certification.checksumSources).toEqual(['patches/bubbles/v2.2.0/manifest.json']);
    expect(registry.frameworks[0].instrumentation.variants).toHaveLength(1);
    expect(registry.frameworks[0].instrumentation.variants[0].modules).toEqual([
      { name: 'charm.land/bubbles/v2', version: 'v2.2.0', optional: true },
      { name: 'charm.land/bubbletea/v2', version: 'v2.0.9' },
    ]);
  });

  it('does not promote a companion whose version collides with the framework version', () => {
    const candidate = { id: 'bubbles-v2@v2.0.9', frameworkId: 'charm', package: 'charm.land/bubbles/v2', version: 'v2.0.9', patch: { path: 'patches/bubbles/v2.0.9/manifest.json' } };
    let registry = { frameworks: [{ id: 'charm', frameworkPackage: 'Bubble Tea', probe: { packageVersion: '0.2.0' }, versions: { policy: 'exact', declared: 'v2.0.8', verified: ['v2.0.8'] }, certification: { ids: ['charm@v2.0.8/0.2.0'], checksumSources: [] }, instrumentation: { patchSets: [{ name: 'charm.land/bubbletea/v2', version: 'v2.0.8', patchSetVersion: 17 }], variants: [{ id: 'base', frameworkVersion: 'v2.0.8', modules: [{ name: 'charm.land/bubbletea/v2', version: 'v2.0.8' }] }] } }] };
    registry = proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 1 });
    registry = recordExecutableVariant(registry, candidate, { frameworkVersion: 'v2.0.9', modules: [
      { name: 'charm.land/bubbletea/v2', version: 'v2.0.8' },
      { name: candidate.package, version: candidate.version, optional: true },
    ] });
    expect(registry.frameworks[0].versions.verified).toEqual(['v2.0.8']);
    expect(registry.frameworks[0].certification.ids).toEqual(['charm@v2.0.8/0.2.0']);
  });

  it('does not let a new non-optional companion self-authorize as the primary module', () => {
    const candidate = { id: 'secondary@2.0.0', frameworkId: 'example', package: 'example/secondary', version: '2.0.0', patch: { path: 'patches/secondary/2.0.0/manifest.json' } };
    let registry = { frameworks: [{ id: 'example', frameworkPackage: 'Example', probe: { packageVersion: '1.0.0' }, versions: { policy: 'exact', declared: '1.0.0', verified: ['1.0.0'] }, certification: { ids: ['example@1.0.0/1.0.0'], checksumSources: [] }, instrumentation: { patchSets: [{ name: 'example/core', version: '1.0.0', patchSetVersion: 1 }], variants: [{ id: 'base', frameworkVersion: '1.0.0', modules: [{ name: 'example/core', version: '1.0.0' }] }] } }] };
    registry = proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: 1 });
    registry = recordExecutableVariant(registry, candidate, { frameworkVersion: candidate.version, modules: [
      { name: 'example/core', version: '1.0.0' },
      { name: candidate.package, version: candidate.version },
    ] });
    expect(registry.frameworks[0].versions.verified).toEqual(['1.0.0']);
    expect(registry.frameworks[0].certification.ids).toEqual(['example@1.0.0/1.0.0']);
  });

  it('binds compatibility updates to the exact manifest identity', () => {
    const candidate = { id: 'example@2.0.0', frameworkId: 'example', package: 'example/core', version: '2.0.0', patch: { path: 'patches/example/2.0.0/manifest.json' } };
    const registry = { frameworks: [{ id: 'example', certification: { checksumSources: [] }, instrumentation: { patchSets: [] } }] };
    expect(() => proposeCompatibilityUpdate(registry, candidate, { framework: 'other/core', frameworkVersion: candidate.version, patchSetVersion: 1 })).toThrow(/another exact framework artifact/u);
    expect(() => proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: '2.0.1', patchSetVersion: 1 })).toThrow(/another exact framework artifact/u);
  });

  it('records a mixed framework/companion green batch independently of reconciliation order', () => {
    const tea = { id: 'bubbletea-v2@v2.0.9', frameworkId: 'charm', package: 'charm.land/bubbletea/v2', version: 'v2.0.9', patch: { path: 'patches/tea/v2.0.9/manifest.json' } };
    const bubbles = { id: 'bubbles-v2@v2.2.0', frameworkId: 'charm', package: 'charm.land/bubbles/v2', version: 'v2.2.0', patch: { path: 'patches/bubbles/v2.2.0/manifest.json' } };
    const base = { frameworks: [{ id: 'charm', frameworkPackage: 'Bubble Tea', probe: { packageVersion: '0.2.0' }, versions: { policy: 'exact', declared: 'v2.0.8', verified: ['v2.0.8'] }, certification: { ids: ['charm@v2.0.8/0.2.0'], checksumSources: [] }, instrumentation: { patchSets: [
      { name: tea.package, version: 'v2.0.8', patchSetVersion: 17 },
      { name: bubbles.package, version: 'v2.1.1', patchSetVersion: 1 },
    ], variants: [{ id: 'base', frameworkVersion: 'v2.0.8', modules: [{ name: tea.package, version: 'v2.0.8' }, { name: bubbles.package, version: 'v2.1.1', optional: true }] }] } }] };
    const resolutions = new Map([
      [tea.id, { frameworkVersion: tea.version, modules: [{ name: tea.package, version: tea.version }, { name: bubbles.package, version: 'v2.1.1', optional: true }] }],
      [bubbles.id, { frameworkVersion: 'v2.0.8', modules: [{ name: tea.package, version: 'v2.0.8' }, { name: bubbles.package, version: bubbles.version, optional: true }] }],
    ]);
    const apply = (registry, candidate) => recordExecutableVariant(
      proposeCompatibilityUpdate(registry, candidate, { framework: candidate.package, frameworkVersion: candidate.version, patchSetVersion: candidate === tea ? 17 : 1 }),
      candidate,
      resolutions.get(candidate.id),
    );
    const teaFirst = apply(apply(base, tea), bubbles);
    const bubblesFirst = apply(apply(base, bubbles), tea);
    expect(teaFirst).toEqual(bubblesFirst);
    expect(teaFirst.frameworks[0].versions.verified).toEqual(['v2.0.8', 'v2.0.9']);
    expect(teaFirst.frameworks[0].certification.ids).toEqual(['charm@v2.0.8/0.2.0', 'charm@v2.0.9/0.2.0']);
    expect(teaFirst.frameworks[0].certification.checksumSources).toEqual(['patches/bubbles/v2.2.0/manifest.json', 'patches/tea/v2.0.9/manifest.json']);
    expect(teaFirst.frameworks[0].instrumentation.variants).toHaveLength(3);
  });
});
