import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateCandidate } from './aggregate-framework-candidate-verdicts.mjs';

const revision = 'a'.repeat(40);
const candidate = {
  id: 'opentui@0.5.7',
  frameworkId: 'opentui',
  candidateDigest: `sha256:${'b'.repeat(64)}`,
};

async function fixture(states) {
  const root = await mkdtemp(join(tmpdir(), 'termwright-platform-verdicts-'));
  const inputs = join(root, 'inputs');
  const output = join(root, 'output');
  for (const [platform, state] of Object.entries(states)) {
    const directory = join(inputs, `framework-candidate-result-0-${platform}`);
    await mkdir(join(directory, 'candidate-update-runtime'), { recursive: true });
    await writeFile(join(directory, 'verdict-0.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision: revision,
      state,
      detail: `${platform} detail`,
    }));
    await writeFile(join(directory, 'candidate-update-runtime', 'bundle.json'), '{"same":true}\n');
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
    expect(await readFile(join(output, 'candidate-update-runtime', 'bundle.json'), 'utf8')).toBe('{"same":true}\n');
  });

  it('fails closed when a required platform artifact is absent or disagrees', async () => {
    const missing = await fixture({ linux: 'green' });
    await expect(aggregateCandidate({ candidate, slot: 0, ...missing, sourceRevision: revision })).rejects.toThrow();

    const mismatch = await fixture({ linux: 'green', macos: 'green' });
    await writeFile(join(mismatch.inputs, 'framework-candidate-result-0-macos', 'candidate-update-runtime', 'bundle.json'), '{"same":false}\n');
    await expect(aggregateCandidate({ candidate, slot: 0, ...mismatch, sourceRevision: revision })).rejects.toThrow(/artifacts disagree/u);
  });

  it('preserves the executable resolution required by patch reconciliation', async () => {
    const patchCandidate = {
      ...candidate,
      id: 'tview@0.43.0',
      frameworkId: 'tview',
      mode: 'patch',
    };
    const { inputs, output } = await fixture({ linux: 'green' });
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
});
