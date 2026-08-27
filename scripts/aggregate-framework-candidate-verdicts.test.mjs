import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { aggregateCandidate, requiredPlatforms, writeTrustedPatchUpdates, writeTrustedRuntimeUpdate } from './aggregate-framework-candidate-verdicts.mjs';

const revision = 'a'.repeat(40);
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const candidate = {
  id: 'opentui@0.5.7',
  frameworkId: 'opentui',
  version: '0.5.7',
  mode: 'hook',
  hookStrategy: 'runtime',
  candidateDigest: `sha256:${'b'.repeat(64)}`,
};

const runtimeUpdate = `candidate-update-runtime-${'b'.repeat(16)}`;
const tcellCandidate = {
  ...candidate,
  id: 'tcell-v2@v2.9.0',
  frameworkId: 'tview',
  package: 'github.com/gdamore/tcell/v2',
  version: 'v2.9.0',
  mode: 'capability',
  capabilityStrategy: 'compile-conformance',
};

const charmPatchCandidate = {
  ...candidate,
  id: 'bubbletea@v2.0.9',
  frameworkId: 'charm',
  package: 'charm.land/bubbletea/v2',
  version: 'v2.0.9',
  mode: 'patch',
  patch: { status: 'ready' },
};

async function fixture(states, updateName = null, fixtureCandidate = candidate) {
  const root = await mkdtemp(join(tmpdir(), 'termwright-platform-verdicts-'));
  const inputs = join(root, 'inputs');
  const output = join(root, 'output');
  for (const [platform, state] of Object.entries(states)) {
    const directory = join(inputs, `framework-candidate-result-0-${platform}`);
    await mkdir(directory, { recursive: true });
    if (updateName !== null) await mkdir(join(directory, updateName), { recursive: true });
    await writeFile(
      join(directory, 'verdict-0.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'termwright-framework-candidate-verdict',
        candidateId: fixtureCandidate.id,
        candidateDigest: fixtureCandidate.candidateDigest,
        sourceRevision: revision,
        platform,
        state,
        detail: `${platform} detail`,
      }),
    );
    if (updateName !== null) await writeFile(join(directory, updateName, 'bundle.json'), '{"same":true}\n');
  }
  return { inputs, output };
}

describe('framework candidate platform aggregation', () => {
  it('materializes every trusted exact-patch version before one ordered preparation batch', async () => {
    const candidates = ['v2.0.9', 'v2.0.10', 'v2.1.0'].map((version, index) => ({
      ...charmPatchCandidate,
      id: `bubbletea@${version}`,
      version,
      candidateDigest: `sha256:${String(index + 1).repeat(64)}`,
      patch: {
        status: 'needs-patch',
        path: `packages/probe-charm/upstream-patches/bubbletea/${version}/manifest.json`,
      },
    }));
    const leases = new Map(candidates.map((entry) => [entry.version, Object.freeze({ sourceRoot: `/source/${entry.version}` })]));
    const materialize = vi.fn(async (entry) => leases.get(entry.version));
    const freshOutput = vi.fn(async (_output, name) => `/trusted/${name}`);
    const prepare = vi.fn(async () => []);
    const cleanup = vi.fn(async () => {});

    await writeTrustedPatchUpdates({ candidates, output: '/trusted', sourceRevision: revision }, { materialize, freshOutput, prepare, cleanup });

    expect(materialize.mock.calls.map(([entry]) => entry.id)).toEqual(candidates.map((entry) => entry.id));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(
      candidates.map((entry, index) => ({
        rootDir: repositoryRoot,
        candidate: entry,
        sourceRoot: `/source/${entry.version}`,
        outputDirectory: `/trusted/candidate-update-${String(index + 1).repeat(16)}`,
        sourceRevision: revision,
      })),
    );
    expect(cleanup.mock.calls.map(([lease]) => lease)).toEqual(candidates.map((entry) => leases.get(entry.version)));

    cleanup.mockClear();
    prepare.mockRejectedValueOnce(new Error('batch failed'));
    await expect(writeTrustedPatchUpdates({ candidates, output: '/trusted', sourceRevision: revision }, { materialize, freshOutput, prepare, cleanup })).rejects.toThrow(/batch failed/u);
    expect(cleanup.mock.calls.map(([lease]) => lease)).toEqual(candidates.map((entry) => leases.get(entry.version)));

    cleanup.mockClear();
    prepare.mockRejectedValueOnce(new Error('primary batch failure'));
    cleanup.mockImplementation(async (lease) => {
      throw new Error(`cleanup failed: ${lease.sourceRoot}`);
    });
    let failure;
    try {
      await writeTrustedPatchUpdates({ candidates, output: '/trusted', sourceRevision: revision }, { materialize, freshOutput, prepare, cleanup });
    } catch (error) {
      failure = error;
    }
    expect(cleanup.mock.calls.map(([lease]) => lease)).toEqual(candidates.map((entry) => leases.get(entry.version)));
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.map((error) => error.message)).toEqual(['primary batch failure', ...candidates.map((entry) => `cleanup failed: /source/${entry.version}`)]);

    const acquisitionFailure = new Error('second materialization failed');
    materialize.mockImplementationOnce(async () => leases.get(candidates[0].version));
    materialize.mockImplementationOnce(async () => {
      throw acquisitionFailure;
    });
    cleanup.mockClear();
    cleanup.mockRejectedValueOnce(new Error('first lease cleanup failed'));
    failure = undefined;
    try {
      await writeTrustedPatchUpdates({ candidates, output: '/trusted', sourceRevision: revision }, { materialize, freshOutput, prepare, cleanup });
    } catch (error) {
      failure = error;
    }
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(leases.get(candidates[0].version));
    expect(failure.errors.map((error) => error.message)).toEqual(['second materialization failed', 'first lease cleanup failed']);
  });

  it('requires the exact bounded platform set for each integration mechanism', () => {
    expect(requiredPlatforms(candidate)).toEqual(['linux', 'macos']);
    expect(
      requiredPlatforms({
        frameworkId: 'tview',
        package: 'github.com/rivo/tview',
        mode: 'capability',
        capabilityStrategy: 'compile-conformance',
      }),
    ).toEqual(['linux', 'windows']);
    expect(requiredPlatforms(tcellCandidate)).toEqual(['linux', 'windows']);
    expect(requiredPlatforms({ frameworkId: 'charm' })).toEqual(['linux']);
  });

  it('requires both OpenTUI platforms to be green', async () => {
    const { inputs, output } = await fixture({ linux: 'green', macos: 'red' });
    const verdict = await aggregateCandidate({ candidate, slot: 0, inputs, output, sourceRevision: revision });

    expect(verdict.state).toBe('red');
    expect(verdict.detail).toContain('[linux] green');
    expect(verdict.detail).toContain('[macos] red');
  });

  it('publishes one green verdict only when platform artifacts agree', async () => {
    const { inputs, output } = await fixture({ linux: 'green', macos: 'green' });
    const verdict = await aggregateCandidate({ candidate, slot: 0, inputs, output, sourceRevision: revision });
    const written = JSON.parse(await readFile(join(output, 'verdict-0.json'), 'utf8'));

    expect(verdict.state).toBe('green');
    expect(written).toEqual(verdict);
  });

  it('fails closed when a required platform artifact is absent or disagrees', async () => {
    const missing = await fixture({ linux: 'green' });
    await expect(aggregateCandidate({ candidate, slot: 0, ...missing, sourceRevision: revision })).rejects.toThrow();

    const unexpected = await fixture({ linux: 'green', macos: 'green' }, runtimeUpdate);
    await expect(aggregateCandidate({ candidate, slot: 0, ...unexpected, sourceRevision: revision })).rejects.toThrow(/unexpected artifact shape/u);
  });

  it('preserves the executable resolution required by capability reconciliation', async () => {
    const patchCandidate = {
      ...candidate,
      id: 'tview@0.43.0',
      frameworkId: 'tview',
      mode: 'capability',
      capabilityStrategy: 'compile-conformance',
    };
    const { inputs, output } = await fixture({ linux: 'green', windows: 'green' }, null, patchCandidate);
    const executableResolution = { frameworkVersion: '0.43.0', modules: [{ name: 'github.com/rivo/tview', version: 'v0.43.0' }] };
    for (const platform of ['linux', 'windows']) {
      const verdictPath = join(inputs, `framework-candidate-result-0-${platform}`, 'verdict-0.json');
      await writeFile(
        verdictPath,
        JSON.stringify({
          schemaVersion: 1,
          kind: 'termwright-framework-candidate-verdict',
          candidateId: patchCandidate.id,
          candidateDigest: patchCandidate.candidateDigest,
          sourceRevision: revision,
          platform,
          state: 'green',
          detail: `${platform} detail`,
          executableResolution,
        }),
      );
    }

    const verdict = await aggregateCandidate({
      candidate: patchCandidate,
      slot: 0,
      inputs,
      output,
      sourceRevision: revision,
    });

    expect(verdict.executableResolution).toEqual(executableResolution);
    expect(JSON.parse(await readFile(join(output, 'verdict-0.json'), 'utf8')).executableResolution).toEqual(executableResolution);
  });

  it('requires Linux and Windows tcell verdicts and turns either red result red', async () => {
    const red = await fixture({ linux: 'green', windows: 'red' }, null, tcellCandidate);
    await expect(aggregateCandidate({ candidate: tcellCandidate, slot: 0, ...red, sourceRevision: revision })).resolves.toMatchObject({
      state: 'red',
      detail: expect.stringContaining('[windows] red'),
    });

    const missing = await fixture({ linux: 'green' }, null, tcellCandidate);
    await expect(aggregateCandidate({ candidate: tcellCandidate, slot: 0, ...missing, sourceRevision: revision })).rejects.toThrow();
  });

  it('publishes a green tcell aggregate only for the required Linux and Windows conjunction', async () => {
    const exact = await fixture({ linux: 'green', windows: 'green' }, null, tcellCandidate);
    const executableResolution = {
      frameworkVersion: 'v0.42.0',
      modules: [
        { name: 'github.com/rivo/tview', version: 'v0.42.0' },
        { name: tcellCandidate.package, version: tcellCandidate.version },
      ],
    };
    for (const platform of ['linux', 'windows']) {
      const path = join(exact.inputs, `framework-candidate-result-0-${platform}`, 'verdict-0.json');
      const verdict = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, JSON.stringify({ ...verdict, executableResolution }));
    }

    await expect(aggregateCandidate({ candidate: tcellCandidate, slot: 0, ...exact, sourceRevision: revision })).resolves.toMatchObject({ state: 'green', executableResolution });
  });

  it('rejects a forged platform label even when the artifact directory name is trusted', async () => {
    const forged = await fixture({ linux: 'green', windows: 'green' }, null, tcellCandidate);
    const windowsVerdict = join(forged.inputs, 'framework-candidate-result-0-windows', 'verdict-0.json');
    const document = JSON.parse(await readFile(windowsVerdict, 'utf8'));
    await writeFile(windowsVerdict, JSON.stringify({ ...document, platform: 'linux' }));
    await expect(aggregateCandidate({ candidate: tcellCandidate, slot: 0, ...forged, sourceRevision: revision })).rejects.toThrow(/invalid or stale windows verdict/u);
  });

  it('rejects extra forged content even when one required platform is red', async () => {
    const forged = await fixture({ linux: 'green', windows: 'red' }, null, tcellCandidate);
    await writeFile(join(forged.inputs, 'framework-candidate-result-0-windows', 'forged.json'), '{}');
    await expect(aggregateCandidate({ candidate: tcellCandidate, slot: 0, ...forged, sourceRevision: revision })).rejects.toThrow(/unexpected artifact shape/u);
  });

  it('rejects a generated namespace from an untrusted green needs-patch process', async () => {
    const updateName = `candidate-update-${'b'.repeat(16)}`;
    const patchCandidate = {
      ...candidate,
      id: 'bubbletea@v2.0.10',
      frameworkId: 'charm',
      mode: 'patch',
      patch: { status: 'needs-patch' },
    };
    const { inputs, output } = await fixture({ linux: 'green' }, updateName, patchCandidate);
    for (const platform of ['linux']) {
      const verdictPath = join(inputs, `framework-candidate-result-0-${platform}`, 'verdict-0.json');
      const verdict = JSON.parse(await readFile(verdictPath, 'utf8'));
      await writeFile(
        verdictPath,
        JSON.stringify({
          ...verdict,
          executableResolution: { frameworkVersion: 'v2.0.10', modules: [] },
        }),
      );
    }
    await expect(aggregateCandidate({ candidate: patchCandidate, slot: 0, inputs, output, sourceRevision: revision })).rejects.toThrow(/unexpected artifact shape/u);
  });

  it('rejects every extra artifact emitted by the untrusted Textual certifier process', async () => {
    const textual = {
      id: 'textual@8.2.9',
      frameworkId: 'textual',
      registry: 'pypi',
      candidateDigest: `sha256:${'c'.repeat(64)}`,
    };
    const root = await mkdtemp(join(tmpdir(), 'termwright-textual-verdict-'));
    const inputs = join(root, 'inputs');
    const output = join(root, 'output');
    const directory = join(inputs, 'framework-candidate-result-0-linux');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'verdict-0.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'termwright-framework-candidate-verdict',
        candidateId: textual.id,
        candidateDigest: textual.candidateDigest,
        sourceRevision: revision,
        platform: 'linux',
        state: 'green',
        detail: 'linux detail',
      }),
    );
    await expect(aggregateCandidate({ candidate: textual, slot: 0, inputs, output, sourceRevision: revision })).resolves.toMatchObject({ state: 'green' });
    await writeFile(join(directory, 'forged-uv.lock'), 'forged\n');
    await expect(aggregateCandidate({ candidate: textual, slot: 0, inputs, output, sourceRevision: revision })).rejects.toThrow(/unexpected artifact shape/u);
  });

  it('generates a runtime update only inside the trusted aggregate process', async () => {
    const output = await mkdtemp(join(tmpdir(), 'termwright-trusted-runtime-'));
    await writeTrustedRuntimeUpdate({ candidate, output, sourceRevision: revision });
    const bundle = JSON.parse(await readFile(join(output, runtimeUpdate, 'bundle.json'), 'utf8'));
    expect(bundle).toMatchObject({
      kind: 'termwright-generated-runtime-profile',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision: revision,
      profile: { version: '0.5.7' },
    });
  });
});
