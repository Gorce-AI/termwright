import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createQualityCheckpoint,
  publishQualityReady,
  publishQualityTerminal,
  qualityCheckpointIsConfigured,
  readQualityCheckpointFromEnvironment,
  waitForQualityReady,
  waitForQualityTerminal,
} from './quality-performance-checkpoint.mjs';

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
  }));
});

async function checkpoint(expectedSessions = 16) {
  const value = await createQualityCheckpoint(expectedSessions);
  directories.push(value.directory);
  return value;
}

const processPids = Array.from({ length: 16 }, (_, index) => 1000 + index);

describe('quality performance checkpoint protocol', () => {
  it('validates the versioned request before a fixture publishes readiness', async () => {
    const value = await checkpoint();
    await expect(readQualityCheckpointFromEnvironment({
      TERMWRIGHT_QUALITY_CHECKPOINT_DIR: value.directory,
      TERMWRIGHT_QUALITY_CHECKPOINT_NONCE: value.nonce,
    })).resolves.toEqual(value);
    await publishQualityReady(value, processPids);
    await expect(waitForQualityReady(value)).resolves.toMatchObject({
      schemaVersion: 1,
      processPids,
    });
  });

  it('cannot lose readiness published before the collector starts waiting', async () => {
    const value = await checkpoint();
    await publishQualityReady(value, processPids);
    await expect(waitForQualityReady(value)).resolves.toMatchObject({ nonce: value.nonce });
  });

  it('cannot lose a terminal record published across watcher installation', async () => {
    const value = await checkpoint();
    const terminal = waitForQualityTerminal(value);
    await publishQualityTerminal(value, { status: 'ok', processCount: 18 });
    await expect(terminal).resolves.toMatchObject({ status: 'ok', sessions: 16, processCount: 18 });
  });

  it('delivers snapshot failure to the fixture instead of leaving its sessions held', async () => {
    const value = await checkpoint();
    const terminal = waitForQualityTerminal(value);
    await publishQualityTerminal(value, { status: 'failure', message: 'footprint rejected a live pid' });
    await expect(terminal).resolves.toEqual({
      kind: 'termwright-quality-snapshot-terminal',
      schemaVersion: 1,
      nonce: value.nonce,
      status: 'failure',
      message: 'footprint rejected a live pid',
    });
  });

  it('rejects a valid record belonging to a different nonce', async () => {
    const value = await checkpoint();
    await publishQualityReady(value, processPids);
    await expect(waitForQualityReady({ ...value, nonce: 'a'.repeat(64) }))
      .rejects.toThrow(/does not match this checkpoint/u);
  });

  it('rejects a readiness claim that does not match the immutable request', async () => {
    const value = await checkpoint();
    await expect(publishQualityReady(value, processPids.slice(1)))
      .rejects.toThrow(/expected 16 session processes, got 15/u);
  });

  it('rejects duplicate application process identities', async () => {
    const value = await checkpoint();
    await expect(publishQualityReady(value, [...processPids.slice(0, -1), processPids[0]]))
      .rejects.toThrow(/must not contain duplicate/u);
  });

  it('rejects a partially configured environment and aborts a live wait cleanly', async () => {
    expect(() => qualityCheckpointIsConfigured({ TERMWRIGHT_QUALITY_CHECKPOINT_DIR: '/tmp/checkpoint' }))
      .toThrow(/define both directory and nonce/u);
    const value = await checkpoint();
    const controller = new AbortController();
    const waiting = waitForQualityTerminal(value, { signal: controller.signal });
    controller.abort(new Error('collector stopped'));
    await expect(waiting).rejects.toThrow(/collector stopped/u);
  });

  it('fails closed for a malformed terminal record', async () => {
    const value = await checkpoint();
    await writeFile(join(value.directory, 'terminal.json'), `${JSON.stringify({
      kind: 'termwright-quality-snapshot-terminal',
      schemaVersion: 1,
      nonce: value.nonce,
      status: 'ok',
      sessions: 16,
      processCount: 18,
      unexpected: true,
    })}\n`);
    await expect(waitForQualityTerminal(value)).rejects.toThrow(/must contain exactly/u);
  });

  it('never replaces an already published terminal outcome', async () => {
    const value = await checkpoint();
    await publishQualityTerminal(value, { status: 'ok', processCount: 18 });
    await expect(publishQualityTerminal(value, { status: 'failure', message: 'late failure' }))
      .rejects.toThrow(/cannot publish immutable quality checkpoint record/u);
    await expect(waitForQualityTerminal(value)).resolves.toMatchObject({ status: 'ok' });
  });
});
