import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packTrace, unpackTrace } from './archive.js';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { TraceError } from './errors.js';
import { inspectTrace, openTrace } from './reader.js';
import { TRACE_FILES } from './types.js';
import { createTraceWriter } from './writer.js';
import { rewriteCommittedMember } from './__fixtures__/committed.js';

const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'twtrace-read-'));
  temporaries.push(dir);
  return dir;
}

/** A recording with two steps, one failing, and a tree per step. */
async function recordSample(dir: string): Promise<void> {
  const session = new FakeSession('sess-r');
  const writer = createTraceWriter(session, {
    dir,
    command: ['demo'],
    columns: 40,
    rows: 5,
    now: session.now,
  });

  session.semantic(snapshot(1, [node({ id: 'n1', role: 'button', name: 'Submit' })], 'sess-r'));
  session.output('first');
  const first = writer.addStep('first step');
  session.tick(1_000);
  session.output('|second');
  first.end('passed');

  const second = writer.addStep('second step');
  session.tick(1_000);
  session.semantic(
    snapshot(
      2,
      [node({ id: 'n1', role: 'button', name: 'Submit', state: { disabled: true } })],
      'sess-r',
    ),
  );
  session.output('|third');
  session.tick(500);
  session.resize(60, 10);
  second.end('failed', 'button stayed disabled');
  session.exit(1);

  await writer.finalize();
}

describe('openTrace', () => {
  it('classifies complete, incomplete, corrupt, and unsupported artifacts', async () => {
    const root = await workspace();
    const completeDir = join(root, 'complete.twtrace');
    await recordSample(completeDir);
    const complete = await inspectTrace(completeDir);
    expect(complete.status).toBe('complete');
    if (complete.status === 'complete') await complete.reader.close();

    const incompleteDir = join(root, 'incomplete.twtrace');
    await recordSample(incompleteDir);
    await unlink(join(incompleteDir, TRACE_FILES.commit));
    expect((await inspectTrace(incompleteDir)).status).toBe('incomplete');

    const corruptDir = join(root, 'corrupt.twtrace');
    await recordSample(corruptDir);
    await writeFile(join(corruptDir, TRACE_FILES.events), 'tampered\n');
    expect((await inspectTrace(corruptDir)).status).toBe('corrupt');

    const futureDir = join(root, 'future-status.twtrace');
    await recordSample(futureDir);
    const meta = JSON.parse(await readFile(join(futureDir, TRACE_FILES.meta), 'utf8')) as Record<
      string,
      unknown
    >;
    await rewriteCommittedMember(futureDir, TRACE_FILES.meta, JSON.stringify({ ...meta, v: 99 }));
    expect((await inspectTrace(futureDir)).status).toBe('unsupported-version');
  });

  it('separates "you named the wrong thing" from "this archive is broken"', async () => {
    const root = await workspace();

    // Nothing there at all.
    await expect(openTrace(join(root, 'missing'))).rejects.toMatchObject({
      code: 'not-found',
    });

    // A directory that exists but holds no archive — the caller pointed at
    // the wrong place, so it is the same class of mistake.
    await expect(openTrace(root)).rejects.toMatchObject({ code: 'not-found' });

    // A file that exists and is not a readable zip: it might be a truncated
    // artifact rather than a mistyped path, so it stays a protocol violation.
    await writeFile(join(root, 'notatrace'), 'nope');
    await expect(openTrace(join(root, 'notatrace'))).rejects.toMatchObject({
      code: 'protocol-violation',
    });
    await expect(openTrace(join(root, 'notatrace'))).rejects.toThrow(/not a readable zip/);
  });

  it('rejects an unsupported archive version', async () => {
    const root = await workspace();
    const dir = join(root, 'future.twtrace');
    await recordSample(dir);
    const meta = JSON.parse(await readFile(join(dir, TRACE_FILES.meta), 'utf8')) as {
      v: number;
    };
    await rewriteCommittedMember(dir, TRACE_FILES.meta, JSON.stringify({ ...meta, v: 99 }));
    // A real archive that lies about itself is a protocol violation, not a
    // missing one.
    await expect(openTrace(dir)).rejects.toMatchObject({ code: 'protocol-violation' });
    await expect(openTrace(dir)).rejects.toThrow(/unsupported trace version 99/);
  });

  it('exposes steps with both wall and cast offsets', async () => {
    const root = await workspace();
    const dir = join(root, 'steps.twtrace');
    await recordSample(dir);
    const trace = await openTrace(dir);
    try {
      const steps = await trace.steps();
      expect(steps.map((step) => [step.title, step.status])).toEqual([
        ['first step', 'passed'],
        ['second step', 'failed'],
      ]);
      expect(steps[1]?.error).toBe('button stayed disabled');
      expect(steps[0]?.castOffset).toBe(0);
      expect(steps[1]?.castOffset).toBe(1_000);
      expect(steps[1]?.castEndOffset).toBe(2_500);
    } finally {
      await trace.close();
    }
  });
});

describe('stateAt', () => {
  it('replays only the output up to the requested offset', async () => {
    const root = await workspace();
    const dir = join(root, 'state.twtrace');
    await recordSample(dir);
    const trace = await openTrace(dir);
    try {
      expect((await trace.stateAt(0)).castPrefix).toBe('first');
      expect((await trace.stateAt(1_000)).castPrefix).toBe('first|second');
      expect((await trace.stateAt(10_000)).castPrefix).toBe('first|second|third');
    } finally {
      await trace.close();
    }
  });

  it('returns the nearest earlier semantic revision', async () => {
    const root = await workspace();
    const dir = join(root, 'semantic.twtrace');
    await recordSample(dir);
    const trace = await openTrace(dir);
    try {
      const early = await trace.stateAt(500);
      expect(early.nearestSemanticRevision).toBe(1);
      expect(early.nearestSemantic?.snapshot.nodes[0]?.state).toBeUndefined();

      const late = await trace.stateAt(2_400);
      expect(late.nearestSemanticRevision).toBe(2);
      expect(late.nearestSemantic?.snapshot.nodes[0]?.state).toEqual({ disabled: true });
    } finally {
      await trace.close();
    }
  });

  it('applies resizes that happened before the requested offset', async () => {
    const root = await workspace();
    const dir = join(root, 'resize.twtrace');
    await recordSample(dir);
    const trace = await openTrace(dir);
    try {
      expect(await trace.stateAt(0)).toMatchObject({ columns: 40, rows: 5 });
      expect(await trace.stateAt(5_000)).toMatchObject({ columns: 60, rows: 10 });
    } finally {
      await trace.close();
    }
  });

  it('reports the step covering the requested offset', async () => {
    const root = await workspace();
    const dir = join(root, 'step-at.twtrace');
    await recordSample(dir);
    const trace = await openTrace(dir);
    try {
      expect((await trace.stateAt(500)).step?.title).toBe('first step');
      expect((await trace.stateAt(2_000)).step?.title).toBe('second step');
    } finally {
      await trace.close();
    }
  });

  it('rejects a negative offset', async () => {
    const root = await workspace();
    const dir = join(root, 'negative.twtrace');
    await recordSample(dir);
    const trace = await openTrace(dir);
    try {
      await expect(trace.stateAt(-1)).rejects.toThrow(TraceError);
    } finally {
      await trace.close();
    }
  });
});

describe('zip container', () => {
  it('reads a packed archive exactly like the directory', async () => {
    const root = await workspace();
    const dir = join(root, 'packed.twtrace');
    await recordSample(dir);
    const zipPath = join(root, 'packed.twtrace.zip');
    const bytes = await packTrace(dir, zipPath);
    expect(bytes).toBeGreaterThan(0);

    const fromZip = await openTrace(zipPath);
    const fromDir = await openTrace(dir);
    try {
      expect(fromZip.container).toBe('zip');
      expect(fromZip.meta).toEqual(fromDir.meta);
      expect(await fromZip.steps()).toEqual(await fromDir.steps());
      expect((await fromZip.stateAt(2_500)).castPrefix).toBe(
        (await fromDir.stateAt(2_500)).castPrefix,
      );
    } finally {
      await fromZip.close();
      await fromDir.close();
    }
  });

  it('unpacks back to a directory', async () => {
    const root = await workspace();
    const dir = join(root, 'source.twtrace');
    await recordSample(dir);
    const zipPath = join(root, 'source.zip');
    await packTrace(dir, zipPath);

    const destination = join(root, 'restored.twtrace');
    const members = await unpackTrace(zipPath, destination);
    expect([...members].sort()).toEqual(
      [
        TRACE_FILES.meta,
        TRACE_FILES.cast,
        TRACE_FILES.events,
        TRACE_FILES.semantics,
        TRACE_FILES.commit,
      ].sort(),
    );
    const restored = await openTrace(destination);
    expect(restored.meta.sessionId).toBe('sess-r');
    await restored.close();
  });

  it('refuses to pack a directory that is not an archive', async () => {
    const root = await workspace();
    await expect(packTrace(root, join(root, 'x.zip'))).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(packTrace(root, join(root, 'x.zip'))).rejects.toThrow(/not a .twtrace/);
  });

  it('refuses to package an incomplete trace', async () => {
    const root = await workspace();
    await writeFile(join(root, TRACE_FILES.meta), JSON.stringify({ v: 1 }));
    await expect(packTrace(root, join(root, 'x.zip'))).rejects.toMatchObject({
      code: 'protocol-violation',
    });
  });
});

describe('castOffset is required', () => {
  it('rejects an event line that has none instead of guessing t', async () => {
    const root = await workspace();
    const dir = join(root, 'legacy.twtrace');
    await recordSample(dir);

    // An archive from before castOffset was required: `t` alone.
    await rewriteCommittedMember(
      dir,
      TRACE_FILES.events,
      `${JSON.stringify({ t: 120, kind: 'step-start', stepId: 's1', title: 'old' })}\n`,
    );

    const trace = await openTrace(dir);
    try {
      await expect(trace.steps()).rejects.toThrow(/castOffset/);
      const drain = async (): Promise<void> => {
        for await (const _event of trace.events()) {
          // consume
        }
      };
      await expect(drain()).rejects.toThrow(TraceError);
    } finally {
      await trace.close();
    }
  });

  it('rejects a castOffset that is not a finite number', async () => {
    const root = await workspace();
    const dir = join(root, 'nonfinite.twtrace');
    await recordSample(dir);
    await rewriteCommittedMember(
      dir,
      TRACE_FILES.events,
      `${JSON.stringify({ t: 1, castOffset: null, kind: 'action', api: 'x', ok: true })}\n`,
    );

    const trace = await openTrace(dir);
    try {
      await expect(trace.steps()).rejects.toThrow(/castOffset/);
    } finally {
      await trace.close();
    }
  });

  it('names the line that is broken', async () => {
    const root = await workspace();
    const dir = join(root, 'secondline.twtrace');
    await recordSample(dir);
    await rewriteCommittedMember(
      dir,
      TRACE_FILES.events,
      [
        JSON.stringify({ t: 0, castOffset: 0, kind: 'step-start', stepId: 's1', title: 'ok' }),
        JSON.stringify({ t: 5, kind: 'step-end', stepId: 's1', title: 'ok', status: 'passed' }),
        '',
      ].join('\n'),
    );

    const trace = await openTrace(dir);
    try {
      await expect(trace.steps()).rejects.toThrow(/events\.jsonl:2/);
    } finally {
      await trace.close();
    }
  });
});
