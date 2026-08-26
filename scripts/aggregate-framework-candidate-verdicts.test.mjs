import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateCandidate, writeTrustedRuntimeUpdate } from './aggregate-framework-candidate-verdicts.mjs';

const revision = 'a'.repeat(40);
const candidate = {
  id: 'opentui@0.5.7',
  frameworkId: 'opentui',
  version: '0.5.7',
  mode: 'hook',
  hookStrategy: 'runtime',
  candidateDigest: `sha256:${'b'.repeat(64)}`,
};

const runtimeUpdate = `candidate-update-runtime-${'b'.repeat(16)}`;

async function fixture(states, updateName = null) {
  const root = await mkdtemp(join(tmpdir(), 'termwright-platform-verdicts-'));
  const inputs = join(root, 'inputs');
  const output = join(root, 'output');
  for (const [platform, state] of Object.entries(states)) {
    const directory = join(inputs, `framework-candidate-result-0-${platform}`);
    await mkdir(directory, { recursive: true });
    if (updateName !== null) await mkdir(join(directory, updateName), { recursive: true });
    await writeFile(join(directory, 'verdict-0.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision: revision,
      state,
      detail: `${platform} detail`,
    }));
    if (updateName !== null) await writeFile(join(directory, updateName, 'bundle.json'), '{"same":true}\n');
  }
  return { inputs, output };
}

describe('framework candidate platform aggregation', () => {
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

  it('preserves the executable resolution required by patch reconciliation', async () => {
    const patchCandidate = {
      ...candidate,
      id: 'tview@0.43.0',
      frameworkId: 'tview',
      mode: 'patch',
      patch: { status: 'ready' },
    };
    const { inputs, output } = await fixture({ linux: 'green' }, null);
    const verdictPath = join(inputs, 'framework-candidate-result-0-linux', 'verdict-0.json');
    const executableResolution = { frameworkVersion: '0.43.0', modules: [{ name: 'github.com/rivo/tview', version: 'v0.43.0' }] };
    await writeFile(verdictPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: patchCandidate.id,
      candidateDigest: patchCandidate.candidateDigest,
      sourceRevision: revision,
      state: 'green',
      detail: 'linux detail',
      executableResolution,
    }));

    const verdict = await aggregateCandidate({
      candidate: patchCandidate, slot: 0, inputs, output, sourceRevision: revision,
    });

    expect(verdict.executableResolution).toEqual(executableResolution);
    expect(JSON.parse(await readFile(join(output, 'verdict-0.json'), 'utf8')).executableResolution)
      .toEqual(executableResolution);
  });

  it('rejects a generated namespace from an untrusted green needs-patch process', async () => {
    const updateName = `candidate-update-${'b'.repeat(16)}`;
    const patchCandidate = {
      ...candidate,
      id: 'tview@0.43.0',
      frameworkId: 'tview',
      mode: 'patch',
      patch: { status: 'needs-patch' },
    };
    const { inputs, output } = await fixture({ linux: 'green' }, updateName);
    const verdictPath = join(inputs, 'framework-candidate-result-0-linux', 'verdict-0.json');
    await writeFile(verdictPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: patchCandidate.id,
      candidateDigest: patchCandidate.candidateDigest,
      sourceRevision: revision,
      state: 'green',
      detail: 'linux detail',
      executableResolution: { frameworkVersion: '0.43.0', modules: [] },
    }));
    await expect(aggregateCandidate({ candidate: patchCandidate, slot: 0, inputs, output, sourceRevision: revision }))
      .rejects.toThrow(/unexpected artifact shape/u);
  });

  it('rejects every extra artifact emitted by the untrusted Textual certifier process', async () => {
    const textual = {
      id: 'textual@8.2.9', frameworkId: 'textual', registry: 'pypi',
      candidateDigest: `sha256:${'c'.repeat(64)}`,
    };
    const root = await mkdtemp(join(tmpdir(), 'termwright-textual-verdict-'));
    const inputs = join(root, 'inputs');
    const output = join(root, 'output');
    const directory = join(inputs, 'framework-candidate-result-0-linux');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'verdict-0.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: textual.id,
      candidateDigest: textual.candidateDigest,
      sourceRevision: revision,
      state: 'green',
      detail: 'linux detail',
    }));
    await expect(aggregateCandidate({ candidate: textual, slot: 0, inputs, output, sourceRevision: revision })).resolves.toMatchObject({ state: 'green' });
    await writeFile(join(directory, 'forged-uv.lock'), 'forged\n');
    await expect(aggregateCandidate({ candidate: textual, slot: 0, inputs, output, sourceRevision: revision }))
      .rejects.toThrow(/unexpected artifact shape/u);
  });

  it('reserves the trusted Textual namespace against every other raw candidate artifact', async () => {
    const { inputs, output } = await fixture({ linux: 'green', macos: 'green' });
    for (const platform of ['linux', 'macos']) {
      const forged = join(inputs, `framework-candidate-result-0-${platform}`, 'candidate-update-textual-forged');
      await mkdir(forged, { recursive: true });
      await writeFile(join(forged, 'bundle.json'), '{"forged":true}\n');
    }
    await expect(aggregateCandidate({ candidate, slot: 0, inputs, output, sourceRevision: revision }))
      .rejects.toThrow(/unexpected artifact shape/u);
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
