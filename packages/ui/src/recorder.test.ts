import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeHarness, node, snapshot } from './__fixtures__/fake-session.js';
import { startRecorder, type RecorderSession } from './recorder.js';
import type { EffectiveSessionContract, EvidenceProvenance } from '@termwright/protocol';

const pointerEvidence: EvidenceProvenance = {
  source: 'application',
  method: 'native',
  strength: 'authoritative',
  providerId: 'app.router',
};

const tree = snapshot(3, [
  node({ id: 'd1', role: 'dialog', name: 'Permission' }),
  node({ id: 'b1', role: 'button', name: 'Approve', parentId: 'd1' }),
]);

async function record(): Promise<{
  harness: FakeHarness;
  recorder: RecorderSession;
}> {
  const harness = new FakeHarness('rec');
  const recorder = await startRecorder({
    command: ['node', 'agent.js'],
    artifactSecurity: { mode: 'raw' },
    launch: async () => harness.asHarness(),
  });
  return { harness, recorder };
}

function enableAuthoritativePointer(harness: FakeHarness, target = 'b1'): void {
  const unsupported = {
    status: 'unsupported',
    reason: 'framework-unobservable',
  } as const;
  harness.negotiatedContract = {
    contractId: 'rec:0',
    sessionId: 's1',
    epoch: 0,
    protocol: 'termwright/3',
    framework: null,
    providers: [
      {
        id: 'app.router',
        kind: 'application',
        version: '1',
        method: 'native',
        capabilities: ['pointer-regions', 'hit-test'],
      },
    ],
    capabilities: {
      'semantic-tree': { status: 'supported', evidence: pointerEvidence },
      'stable-identity': unsupported,
      'intended-geometry': unsupported,
      'clipped-geometry': unsupported,
      'painted-region': unsupported,
      'pointer-geometry': { status: 'supported', evidence: pointerEvidence },
      'pointer-hit-testing': { status: 'supported', evidence: pointerEvidence },
      focus: unsupported,
      scroll: unsupported,
      'render-order': unsupported,
      'action-strategies': unsupported,
      'keyboard-input': { status: 'supported', evidence: pointerEvidence },
      'pointer-input': { status: 'supported', evidence: pointerEvidence },
      'focus-input': unsupported,
      'paired-revisions': { status: 'supported', evidence: pointerEvidence },
    },
    terminal: {
      profile: 'default',
      platform: 'linux',
      mouseModesObservable: true,
    },
  } satisfies EffectiveSessionContract;
  harness.semantic({
    ...tree,
    hitGrid: {
      status: 'known',
      evidence: pointerEvidence,
      value: {
        regions: [
          {
            recipientId: target,
            rect: { row: 2, column: 4, width: 8, height: 1 },
          },
        ],
      },
    },
  });
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('recorder', () => {
  it('withholds a typed sentinel from events and generated source by default', async () => {
    const secret = 'TW_SENTINEL_recorder_f4a6';
    const harness = new FakeHarness('secure-rec');
    const recorder = await startRecorder({
      command: ['node', 'agent.js'],
      launch: async () => harness.asHarness(),
    });
    await recorder.handleInput(encode(secret));
    expect(harness.writtenText()).toBe(secret);
    expect(JSON.stringify(recorder.events)).not.toContain(secret);
    expect(recorder.source()).not.toContain(secret);
    expect(recorder.events.at(-1)).toMatchObject({
      kind: 'withheld-input',
      inputKind: 'type',
    });
  });
  it('forwards input to the child and records it as readable actions', async () => {
    const { harness, recorder } = await record();
    await recorder.handleInput(encode('ls'));
    await recorder.handleInput(encode(' -la'));
    await recorder.handleInput(encode('\r'));

    expect(harness.writtenText()).toBe('ls -la\r');
    expect(recorder.events.slice(1)).toEqual([
      { kind: 'type', text: 'ls -la', t: expect.any(Number) },
      { kind: 'press', keys: 'Enter', t: expect.any(Number) },
    ]);
  });

  it('holds input back while the inspector is picking', async () => {
    const { harness, recorder } = await record();
    recorder.setPickMode(true);
    await recorder.handleInput(encode('x'));
    expect(harness.writtenText()).toBe('');
    expect(recorder.events).toHaveLength(1);

    recorder.setPickMode(false);
    await recorder.handleInput(encode('x'));
    expect(harness.writtenText()).toBe('x');
  });

  it('records a click as the narrowest selector for the node', async () => {
    const { harness, recorder } = await record();
    enableAuthoritativePointer(harness);
    const selector = recorder.recordClick('b1');
    expect(selector?.expression).toBe("app.getByRole('button', { name: 'Approve' })");
    expect(recorder.source()).toContain(
      "await app.getByRole('button', { name: 'Approve' }).click();",
    );
  });

  it('refuses to record a click when there is no tree to name the node with', async () => {
    const { recorder } = await record();
    expect(recorder.recordClick('b1')).toBeUndefined();
    expect(recorder.events).toHaveLength(1);
  });

  it('refuses semantic codegen for inspector-only nodes without authoritative hit ownership', async () => {
    const { harness, recorder } = await record();
    harness.semantic(tree);
    expect(recorder.recordClick('b1')).toBeUndefined();

    enableAuthoritativePointer(harness, 'd1');
    expect(recorder.recordClick('b1')).toBeUndefined();
    expect(recorder.events).toHaveLength(1);
  });

  it('rejects a hit grid whose provider differs from the frozen contract', async () => {
    const { harness, recorder } = await record();
    enableAuthoritativePointer(harness);
    harness.semantic({
      ...tree,
      hitGrid: {
        status: 'known',
        evidence: { ...pointerEvidence, providerId: 'forged.router' },
        value: {
          regions: [
            {
              recipientId: 'b1',
              rect: { row: 2, column: 4, width: 8, height: 1 },
            },
          ],
        },
      },
    });
    expect(recorder.recordClick('b1')).toBeUndefined();
  });

  it('accepts a negotiated application provider hit grid bound to the current revision', async () => {
    const { harness, recorder } = await record();
    enableAuthoritativePointer(harness);
    harness.semantic({
      ...tree,
      hitGrid: {
        status: 'unsupported',
        capability: 'pointer-hit-grid',
        reason: 'framework-unobservable',
      },
      providerEvidence: [
        {
          providerId: 'app.router',
          sessionId: 's1',
          revision: tree.revision,
          status: 'available',
          evidence: pointerEvidence,
          pointerRegions: [],
          hitGrid: {
            regions: [
              {
                recipientId: 'b1',
                rect: { row: 3, column: 5, width: 3, height: 1 },
              },
            ],
          },
        },
      ],
    });
    expect(recorder.recordClick('b1')?.expression).toContain("getByRole('button'");
  });

  it('records assertions on demand', async () => {
    const { harness, recorder } = await record();
    harness.semantic(tree);
    recorder.recordAssertSnapshot();
    recorder.recordAssertVisible('b1');
    recorder.recordAssertText('running');
    const source = recorder.source();
    expect(source).toContain('await expect(app).toMatchSemanticSnapshot();');
    expect(source).toContain(
      "await expect(app.getByRole('button', { name: 'Approve' })).toBeVisible();",
    );
    expect(source).toContain("await expect(app).toHaveText('running');");
  });

  it('writes the generated test to disk', async () => {
    const { recorder } = await record();
    await recorder.handleInput(encode('\r'));
    const file = join(await mkdtemp(join(tmpdir(), 'termwright-codegen-')), 'recorded.test.ts');
    expect(await recorder.save(file)).toBe(file);
    expect(await readFile(file, 'utf8')).toContain("await app.press('Enter');");
  });

  it('refuses to save without a destination', async () => {
    const { recorder } = await record();
    await expect(recorder.save()).rejects.toThrow(/no output file/);
  });

  it('closes the session it launched', async () => {
    const { harness, recorder } = await record();
    await recorder.close();
    expect(harness.closed).toBe(true);
  });
});
