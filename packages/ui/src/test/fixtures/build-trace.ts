/**
 * Materialises canonical `.twtrace` archives for UI and time-travel tests.
 * Writer durability is covered by `@termwright/trace`; consumers should not
 * pay for production fsyncs every time they need an isolated read fixture.
 */

import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodeGeometryObservations, Rect, SemanticSnapshot } from '@termwright/protocol';

const ARCHIVES = fileURLToPath(new URL('./archives', import.meta.url));
const TRACE_MEMBERS = [
  'meta.json',
  'session.cast',
  'events.jsonl',
  'semantics.jsonl',
  'logs.jsonl',
];

const unknownGeometry = (): NodeGeometryObservations => ({
  displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
  intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
  visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
});

const visibleGeometry = (rect: Rect): NodeGeometryObservations => ({
  displayed: {
    status: 'known',
    value: true,
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'ui-fixture',
    },
  },
  intendedRect: {
    status: 'known',
    value: { ...rect },
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'ui-fixture',
    },
  },
  visibleRect: {
    status: 'known',
    value: { ...rect },
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'ui-fixture',
    },
  },
});

const snapshotFacts = {
  coordinateSpace: { status: 'unknown' as const, reason: 'awaiting-revision-pair' as const },
  hitGrid: {
    status: 'unsupported' as const,
    capability: 'pointer-hit-grid',
    reason: 'framework-unobservable' as const,
  },
};

/** The tree published at each of the fixture's two revisions. */
export const FIXTURE_TREES: readonly SemanticSnapshot[] = [
  {
    v: 3,
    sessionId: 'trace-session',
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['d1'],
    nodes: [
      {
        id: 'd1',
        role: 'dialog',
        name: 'Permission',
        state: { modal: true },
        geometry: unknownGeometry(),
      },
      {
        id: 'b1',
        role: 'button',
        name: 'Approve',
        parentId: 'd1',
        geometry: visibleGeometry({ row: 3, column: 4, width: 9, height: 1 }),
      },
    ],
    ...snapshotFacts,
  },
  {
    v: 3,
    sessionId: 'trace-session',
    revision: 2,
    columns: 80,
    rows: 24,
    rootIds: ['s1'],
    nodes: [{ id: 's1', role: 'status', name: 'running: ls -la', geometry: unknownGeometry() }],
    ...snapshotFacts,
  },
];

/**
 * Writes a two-step archive: output at 0 ms, a tree, a step around a second
 * chunk of output, a second tree, and an exit.
 *
 * @returns the archive directory.
 */
export async function buildFixtureTrace(
  options: { readonly columns?: number; readonly rows?: number } = {},
): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'termwright-ui-')), 'session.twtrace');
  const columns = options.columns ?? 80;
  const rows = options.rows ?? 24;
  await cp(join(ARCHIVES, 'complete'), dir, { recursive: true });
  if (columns !== 80 || rows !== 24) await resizeFixture(dir, columns, rows);
  return dir;
}

/**
 * Writes an archive of a session that died on its own: output, a tree, then a
 * `crash` event followed by the exit — the order the driver emits them in, so
 * the writer stamps `meta.crash.castOffset` the way it does in a real run.
 *
 * @returns the archive directory.
 */
export async function buildCrashedFixtureTrace(): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'termwright-ui-crash-')), 'crashed.twtrace');
  await cp(join(ARCHIVES, 'crashed'), dir, { recursive: true });
  return dir;
}

async function resizeFixture(dir: string, columns: number, rows: number): Promise<void> {
  const metaPath = join(dir, 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
  await writeFile(metaPath, `${JSON.stringify({ ...meta, columns, rows }, null, 2)}\n`, 'utf8');

  const castPath = join(dir, 'session.cast');
  const castLines = (await readFile(castPath, 'utf8')).trimEnd().split('\n');
  const header = JSON.parse(castLines[0] ?? '{}') as Record<string, unknown>;
  castLines[0] = JSON.stringify({ ...header, term: { cols: columns, rows } });
  await writeFile(castPath, `${castLines.join('\n')}\n`, 'utf8');

  const semanticsPath = join(dir, 'semantics.jsonl');
  const semantics = (await readFile(semanticsPath, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => {
      const record = JSON.parse(line) as { snapshot: Record<string, unknown> };
      return JSON.stringify({
        ...record,
        snapshot: { ...record.snapshot, columns, rows },
      });
    });
  await writeFile(semanticsPath, `${semantics.join('\n')}\n`, 'utf8');

  const checksums: Record<string, string> = {};
  for (const name of TRACE_MEMBERS) {
    try {
      const body = await readFile(join(dir, name), 'utf8');
      checksums[name] = createHash('sha256').update(body).digest('hex');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await writeFile(join(dir, 'COMMITTED'), `${JSON.stringify({ v: 1, checksums })}\n`, 'utf8');
}
