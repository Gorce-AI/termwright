import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeHarness, node, snapshot } from './__fixtures__/fake-session.js';
import { startRecorder, type RecorderSession } from './recorder.js';

const tree = snapshot(3, [
  node({ id: 'd1', role: 'dialog', name: 'Permission' }),
  node({ id: 'b1', role: 'button', name: 'Approve', parentId: 'd1' }),
]);

async function record(): Promise<{ harness: FakeHarness; recorder: RecorderSession }> {
  const harness = new FakeHarness('rec');
  const recorder = await startRecorder({
    command: ['node', 'agent.js'],
    launch: async () => harness.asHarness(),
  });
  return { harness, recorder };
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('recorder', () => {
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
    harness.semantic(tree);
    const selector = recorder.recordClick('b1');
    expect(selector?.expression).toBe("app.getByRole('button', { name: 'Approve' })");
    expect(recorder.source()).toContain("await app.getByRole('button', { name: 'Approve' }).click();");
  });

  it('refuses to record a click when there is no tree to name the node with', async () => {
    const { recorder } = await record();
    expect(recorder.recordClick('b1')).toBeUndefined();
    expect(recorder.events).toHaveLength(1);
  });

  it('records assertions on demand', async () => {
    const { harness, recorder } = await record();
    harness.semantic(tree);
    recorder.recordAssertSnapshot();
    recorder.recordAssertVisible('b1');
    recorder.recordAssertText('running');
    const source = recorder.source();
    expect(source).toContain('await expect(app).toMatchSemanticSnapshot();');
    expect(source).toContain("await expect(app.getByRole('button', { name: 'Approve' })).toBeVisible();");
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
