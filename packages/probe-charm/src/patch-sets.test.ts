/**
 * Both Charm patch sets, applied to the real frameworks and compiled.
 *
 * The two majors get separate patch sets because they are separate modules
 * with different shapes, and the test runs each rather than assuming the
 * second follows from the first.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  applyPatchSet,
  ensureUpstreamModule,
  materializeUpstream,
  prepareGoToolExec,
  readManifest,
  writeWorkspace,
} from '@termwright/probe-go';
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { goTestCapability } from '../../../scripts/test-support/go-toolchain.mjs';
import { BUBBLETEA_MODULES, type CharmMajor } from './detect.js';

const run = promisify(execFile);
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });

async function runGo(
  args: readonly string[],
  options: Parameters<typeof run>[2],
): Promise<{ stdout: string }> {
  try {
    const result = await run('go', [...args], options);
    return { stdout: String(result.stdout) };
  } catch (error) {
    const failure = error as Error & {
      readonly stdout?: string;
      readonly stderr?: string;
    };
    throw new Error(`${failure.message}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`);
  }
}
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', '..', '..', 'clients', 'go');

/** Where each major's pristine source sits in the module cache. */
const UPSTREAM: Readonly<Record<CharmMajor, { version: string; path: readonly string[] }>> = {
  v1: {
    version: 'v1.3.10',
    path: ['github.com', 'charmbracelet', 'bubbletea@v1.3.10'],
  },
  v2: { version: 'v2.0.8', path: ['charm.land', 'bubbletea', 'v2@v2.0.8'] },
};

const V2_PROFILES = [
  { version: 'v2.0.8', path: ['charm.land', 'bubbletea', 'v2@v2.0.8'] },
  { version: 'v2.0.9', path: ['charm.land', 'bubbletea', 'v2@v2.0.9'] },
] as const;

async function goAvailable(): Promise<boolean> {
  return goTestCapability(
    async () => {
      await run('go', ['version']);
      return true;
    },
    false,
    'Go certification toolchain',
  );
}

const hasGo = await goAvailable();
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function patchSetFor(major: CharmMajor, version = UPSTREAM[major].version): string {
  return join(here, '..', 'upstream-patches', 'bubbletea', version);
}

async function instrumentedCopy(
  major: CharmMajor,
  upstream = UPSTREAM[major],
): Promise<{ copy: string; workspace: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `tw-charm-${major}-`)));
  roots.push(dir);

  const copy = join(dir, 'bubbletea');
  await materializeUpstream(
    await ensureUpstreamModule({
      module: BUBBLETEA_MODULES[major],
      version: upstream.version,
      cachePath: upstream.path,
    }),
    copy,
  );
  await applyPatchSet(copy, patchSetFor(major, upstream.version));

  const workspace = await writeWorkspace(join(dir, 'probe.work'), {
    moduleDir: copy,
    inherited: { uses: [], replaces: [] },
    replaces: [
      {
        from: 'github.com/gorce-ai/termwright/clients/go',
        to: await realpath(CLIENT),
      },
    ],
  });
  return { copy, workspace };
}

describe('the runtime capability declarations', () => {
  it.each([
    { major: 'v1', version: 'v1.3.10' },
    ...V2_PROFILES.map(({ version }) => ({ major: 'v2' as const, version })),
  ] as const)(
    'declares the exact honest capabilities in $major $version',
    async ({ major, version }) => {
      const source = await readFile(
        join(patchSetFor(major, version), 'add', 'termwright_probe.go'),
        'utf8',
      );
      const literal = /Capabilities:\s*\[\]protocol\.Capability\{(?<body>[\s\S]*?)\n\s*\}/u.exec(
        source,
      )?.groups?.['body'];
      expect(literal).toBeDefined();

      const capabilities = [...(literal?.matchAll(/protocol\.(Cap[A-Za-z]+)/gu) ?? [])].map(
        (match) => match[1],
      );
      expect(capabilities).toEqual([
        'CapTree',
        'CapStates',
        'CapFocusState',
        'CapActions',
        'CapRenderRevisions',
      ]);

      // This is a different capability vocabulary: it describes facts the
      // framework exposes, not message kinds the adapter can send.
      expect(source).toContain(`frameworkVersion = "${version}"`);
      expect(source).toContain('Framework:        "charm"');
      expect(source).toMatch(/IdentityKind:\s+protocol\.ProbeIdentityFrameLocal/u);
      const probeLiteral =
        /Capabilities:\s*\[\]protocol\.ProbeCapability\{(?<body>[\s\S]*?)\n\s*\}/u.exec(source)
          ?.groups?.['body'];
      expect(
        [...(probeLiteral?.matchAll(/protocol\.(ProbeCap[A-Za-z]+)/gu) ?? [])].map(
          (match) => match[1],
        ),
      ).toEqual(['ProbeCapAnnotations']);
    },
  );
});

describe.skipIf(!hasGo)('the patch sets', () => {
  it.each(V2_PROFILES)(
    'instruments exact $version with a single anchor and compiles',
    async (profile) => {
      const { copy, workspace } = await instrumentedCopy('v2', profile);

      const tea = await readFile(join(copy, 'tea.go'), 'utf8');
      // Program.render captures the model-aware semantic frame, while the
      // renderer's successful flush is the only commit boundary.
      expect(tea.match(/termwrightRenderAndObserve\(p, model\)/gu)).toHaveLength(1);
      const renderer = await readFile(join(copy, 'cursed_renderer.go'), 'utf8');
      expect(renderer).toContain('termwrightTryBeginOutputCommit()');
      expect(renderer).toContain('if !termwrightCommit.proceed');
      expect(renderer).not.toContain('termwrightOutputCommitMu');
      expect(renderer).toContain('termwrightAfterRendererFlush(s, false)');
      expect(renderer).toContain('termwrightAfterRendererFlush(s, true)');
      if (profile.version === 'v2.0.9') {
        expect(renderer).toContain('!s.pendingErase');
        expect(renderer.indexOf('!s.pendingErase')).toBeLessThan(
          renderer.indexOf('termwrightAfterRendererFlush(s, true)'),
        );
      }
      expect(renderer).toContain('written != int64(outputLen)');
      expect(renderer).toContain('err = io.ErrShortWrite');
      expect(renderer.lastIndexOf('termwrightAfterRendererFlush(s, true)')).toBeGreaterThan(
        renderer.indexOf('io.Copy(s.w, &buf)'),
      );
      expect(renderer.indexOf('termwrightAfterRendererFlush(s, false)')).toBeGreaterThan(
        renderer.indexOf('s.scr.Flush()'),
      );
      const probe = await readFile(join(copy, 'termwright_probe.go'), 'utf8');
      expect(probe).toContain('termwrightOutputCommitActive.CompareAndSwap(false, true)');
      expect(probe).not.toContain('termwrightOutputCommitMu');
      expect(probe).toContain('termwrightProbeMode.Load() != termwrightProbeModeActive');
      expect(probe).toContain('termwrightProbeMode.Store(termwrightProbeModeDormant)');
      expect(probe).not.toContain('termwrightCurrentProbe');
      const dormantLookup = probe.slice(
        probe.indexOf('func termwrightProbeForRender()'),
        probe.indexOf('func newTermwrightProbe()'),
      );
      expect(dormantLookup).toContain('termwrightProbeMode.Load()');
      expect(dormantLookup).not.toMatch(/Lock\(|FromEnv|go func|Dial|Start\(/u);
      expect(probe).toContain('p.publish(renderer, renderer.w, frame)');
      expect(probe).toContain('publisher.ReadyAfterDrop');
      expect(probe).toContain('publisher.ReadyAfterBusy');
      expect(probe).toContain('frame.program.Send(termwrightRecoveryMsg{renderer: renderer})');
      expect(probe).toContain('termwrightRenderAndObserveMode(program, model, true)');
      expect(probe).toContain('protocol.NewPublicationQueue(client, 2)');
      expect(probe).toContain('publication.try(frame.snapshot)');
      expect(probe).not.toContain('p.client.Publish(frame.snapshot)');
      expect(probe).toContain('p.rendering.CompareAndSwap(false, true)');
      expect(probe).not.toContain('renderMu');
      expect(probe).not.toContain('publishMu');
      expect(probe).not.toContain('frameMu');
      expect(probe).toContain('p.recoveryAdmission.TryRLock()');
      expect(probe).toContain('defer p.recoveryAdmission.RUnlock()');
      expect(probe).toContain('"custom-container-enumeration"');
      expect(probe).toContain('FrameworkType: "opaque-container"');
      expect(probe).toContain(
        'p.failOutput("Bubble Tea renderer did not commit the complete terminal frame")',
      );
      expect(probe).not.toContain('os.Stdout');
      const replay = probe.slice(
        probe.indexOf('func (p *termwrightProbeState) replayLatestFrames()'),
      );
      expect(replay.indexOf('renderer.mu.Lock()')).toBeLessThan(
        replay.indexOf('frame := state.latest.Load()'),
      );
      expect(replay.indexOf('frame := state.latest.Load()')).toBeLessThan(
        replay.indexOf('frame.sequence > state.published.Load()'),
      );

      await expect(
        run('go', ['build', './...'], {
          cwd: copy,
          env: { ...process.env, GOWORK: workspace },
        }),
      ).resolves.toBeDefined();
      const { stdout } = await runGo(
        ['test', '-race', '-run', 'Termwright', '-count=1', '-v', '.'],
        {
          cwd: copy,
          env: { ...process.env, GOWORK: workspace },
        },
      );
      expect(stdout).toContain('PASS: TestTermwrightSemanticKeysStabiliseIDsAndResolveRelations');
    },
    900_000,
  );

  it.each([
    { source: V2_PROFILES[0], patch: V2_PROFILES[1] },
    { source: V2_PROFILES[1], patch: V2_PROFILES[0] },
  ])(
    'refuses the $patch.version profile for exact source $source.version',
    async ({ source, patch }) => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-v2-cross-')));
      roots.push(dir);
      const copy = join(dir, 'bubbletea');
      await materializeUpstream(
        await ensureUpstreamModule({
          module: BUBBLETEA_MODULES.v2,
          version: source.version,
          cachePath: source.path,
        }),
        copy,
      );

      await expect(applyPatchSet(copy, patchSetFor('v2', patch.version))).rejects.toThrow(
        /does not match charm\.land\/bubbletea\/v2 v2\.0\.[89]/u,
      );
    },
    600_000,
  );

  it('instruments v1 at all three call sites and compiles', async () => {
    const { copy, workspace } = await instrumentedCopy('v1');

    const tea = await readFile(join(copy, 'tea.go'), 'utf8');
    // Three, and not because of style: v1 hands the renderer a string, so a
    // probe anchored in renderer.write would get the frame without the model
    // and have nothing to read. The model is only in scope where View() is
    // called.
    expect(tea.match(/termwrightRenderAndObserve\(p, model\)/gu)).toHaveLength(3);
    expect(tea).not.toContain('p.renderer.write(model.View())');
    const renderer = await readFile(join(copy, 'standard_renderer.go'), 'utf8');
    expect(renderer).toContain('termwrightTryBeginOutputCommit()');
    expect(renderer).toContain('if !termwrightCommit.proceed');
    expect(renderer).not.toContain('termwrightOutputCommitMu');
    expect(renderer.indexOf('termwrightAfterRendererFlush(r, writeErr == nil')).toBeGreaterThan(
      renderer.indexOf('r.out.Write(buf.Bytes())'),
    );
    expect(renderer).toContain('writeErr == nil && written == buf.Len()');
    const probe = await readFile(join(copy, 'termwright_probe.go'), 'utf8');
    expect(probe).toContain('termwrightOutputCommitActive.CompareAndSwap(false, true)');
    expect(probe).not.toContain('termwrightOutputCommitMu');
    expect(probe).toContain('termwrightProbeMode.Load() != termwrightProbeModeActive');
    expect(probe).toContain('termwrightProbeMode.Store(termwrightProbeModeDormant)');
    expect(probe).not.toContain('termwrightCurrentProbe');
    const dormantLookup = probe.slice(
      probe.indexOf('func termwrightProbeForRender()'),
      probe.indexOf('func newTermwrightProbe()'),
    );
    expect(dormantLookup).toContain('termwrightProbeMode.Load()');
    expect(dormantLookup).not.toMatch(/Lock\(|FromEnv|go func|Dial|Start\(/u);
    expect(probe).toContain('p.publish(r, r.out, frame)');
    expect(probe).toContain('publisher.ReadyAfterDrop');
    expect(probe).toContain('publisher.ReadyAfterBusy');
    expect(probe).toContain('frame.program.Send(termwrightRecoveryMsg{renderer: renderer})');
    expect(probe).toContain('termwrightRenderAndObserveMode(p, model, true)');
    expect(probe).toContain('protocol.NewPublicationQueue(client, 2)');
    expect(probe).toContain('publication.try(frame.snapshot)');
    expect(probe).not.toContain('p.client.Publish(frame.snapshot)');
    expect(probe).toContain('p.rendering.CompareAndSwap(false, true)');
    expect(probe).not.toContain('renderMu');
    expect(probe).not.toContain('publishMu');
    expect(probe).not.toContain('frameMu');
    expect(probe).toContain('p.recoveryAdmission.TryRLock()');
    expect(probe).toContain('defer p.recoveryAdmission.RUnlock()');
    expect(probe).toContain('"custom-container-enumeration"');
    expect(probe).toContain('FrameworkType: "opaque-container"');
    expect(probe).toContain(
      'p.failOutput("Bubble Tea renderer did not commit the complete terminal frame")',
    );
    expect(probe).not.toContain('os.Stdout');
    const replay = probe.slice(
      probe.indexOf('func (p *termwrightProbeState) replayLatestFrames()'),
    );
    expect(replay.indexOf('renderer.mtx.Lock()')).toBeLessThan(
      replay.indexOf('frame := state.latest.Load()'),
    );
    expect(replay.indexOf('frame := state.latest.Load()')).toBeLessThan(
      replay.indexOf('frame.sequence > state.published.Load()'),
    );

    await expect(
      run('go', ['build', './...'], {
        cwd: copy,
        env: { ...process.env, GOWORK: workspace },
      }),
    ).resolves.toBeDefined();
    const { stdout } = await runGo(['test', '-race', '-run', 'Termwright', '-count=1', '-v', '.'], {
      cwd: copy,
      env: { ...process.env, GOWORK: workspace },
    });
    expect(stdout).toContain('PASS: TestTermwrightSemanticKeysStabiliseIDsAndResolveRelations');
  }, 900_000);

  it('keeps the majors on separate patch sets, keyed by their own module path', async () => {
    const [v1, ...v2] = await Promise.all([
      readFile(join(patchSetFor('v1'), 'manifest.json'), 'utf8'),
      ...V2_PROFILES.map(({ version }) =>
        readFile(join(patchSetFor('v2', version), 'manifest.json'), 'utf8'),
      ),
    ]);

    expect(JSON.parse(v1).framework).toBe(BUBBLETEA_MODULES.v1);
    expect(v2.map((manifest) => JSON.parse(manifest).framework)).toEqual([
      BUBBLETEA_MODULES.v2,
      BUBBLETEA_MODULES.v2,
    ]);
  });

  it('refuses to apply one major to the other', async () => {
    // The checksums are what make this legible: without them the v1 patch
    // would fail somewhere inside a diff context on v2's tea.go.
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-cross-')));
    roots.push(dir);
    const copy = join(dir, 'bubbletea');
    await materializeUpstream(
      await ensureUpstreamModule({
        module: BUBBLETEA_MODULES.v2,
        version: UPSTREAM.v2.version,
        cachePath: UPSTREAM.v2.path,
      }),
      copy,
    );

    await expect(applyPatchSet(copy, patchSetFor('v1'))).rejects.toThrow(
      /(?:does not match|not) github\.com\/charmbracelet\/bubbletea v1\.3\.10/u,
    );
  }, 600_000);
});

describe.skipIf(!hasGo)('the Bubbles patch sets', () => {
  const BUBBLES: Readonly<
    Record<CharmMajor, { module: string; version: string; path: readonly string[] }>
  > = {
    v1: {
      module: 'github.com/charmbracelet/bubbles',
      version: 'v1.0.0',
      path: ['github.com', 'charmbracelet', 'bubbles@v1.0.0'],
    },
    v2: {
      module: 'charm.land/bubbles/v2',
      version: 'v2.1.1',
      path: ['charm.land', 'bubbles', 'v2@v2.1.1'],
    },
  };

  it.each(['v1', 'v2'] as const)(
    'adds accessors to %s and still compiles',
    async (major) => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), `tw-bubbles-${major}-`)));
      roots.push(dir);

      const upstream = await ensureUpstreamModule({
        module: BUBBLES[major].module,
        version: BUBBLES[major].version,
        cachePath: BUBBLES[major].path,
      });
      const patchSet = join(here, '..', 'upstream-patches', 'bubbles', BUBBLES[major].version);
      const manifest = await readManifest(patchSet);
      const prepared = await prepareGoToolExec({
        moduleDir: upstream,
        outputDir: join(dir, 'tool executor with spaces'),
        units: await Promise.all(
          manifest.added.map(async (added) => ({
            packagePath: `${BUBBLES[major].module}/${dirname(added.path)}`,
            targetFile: 'zz_termwright_probe.go',
            source: await readFile(join(patchSet, added.source), 'utf8'),
            sourceDigest: added.sha256,
          })),
        ),
      });

      await expect(
        run('go', ['build', ...prepared.goArgs, './...'], {
          cwd: upstream,
          env: prepared.env,
        }),
      ).resolves.toBeDefined();
    },
    900_000,
  );

  it('edits no upstream file in either major', async () => {
    // Accessors are added, never spliced in. That is why a Bubbles bump costs
    // nothing here: there is no diff context to drift.
    for (const major of ['v1', 'v2'] as const) {
      const manifest = JSON.parse(
        await readFile(
          join(here, '..', 'upstream-patches', 'bubbles', BUBBLES[major].version, 'manifest.json'),
          'utf8',
        ),
      );
      expect(manifest.patched).toEqual([]);
      expect(manifest.added).toHaveLength(5);
    }
  });
});
