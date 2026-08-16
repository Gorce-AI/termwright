/**
 * Run history: what happened last time, and the time before that.
 *
 * A runner that forgets every run the moment it ends makes you re-run a suite
 * to answer "what failed yesterday". Each run writes a small manifest — its
 * counters, its tests, and the archive each test left behind — into
 * `.termwright/runs/<id>/manifest.json`, and the panel lists them.
 *
 * The manifest holds paths, not archives: the traces are already on disk where
 * the fixtures wrote them, and copying them would double the size of a CI
 * artifact for nothing.
 *
 * @packageDocumentation
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UiRunSummary, UiTestStatus } from './events.js';

/** Format version of `manifest.json`. */
export const RUN_MANIFEST_VERSION = 1;

/** Default directory runs are written to, relative to the project. */
export const DEFAULT_RUNS_DIR = '.termwright/runs';

/** Maximum runs a listing returns. */
const MAX_RUNS = 100;
/** Maximum tests kept in one manifest. */
const MAX_TESTS = 10_000;

/** One test, as a run recorded it. */
export interface RunTest {
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly status: UiTestStatus;
  readonly durationMs: number;
  readonly flaky: boolean;
  /** Path to the `.twtrace` this test left, when one was retained. */
  readonly traceRef?: string;
  readonly error?: string;
}

/** One finished run. */
export interface RunManifest {
  readonly v: typeof RUN_MANIFEST_VERSION;
  /** Directory name: a sortable timestamp. */
  readonly id: string;
  /** Unix epoch milliseconds. */
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly summary: UiRunSummary;
  readonly tests: readonly RunTest[];
}

/** A run as the history list shows it, without its tests. */
export interface RunSummaryEntry {
  readonly id: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly summary: UiRunSummary;
  /** Tests the run recorded, for the list's count. */
  readonly testCount: number;
}

/** Builds the sortable directory name for a run that started at `startedAt`. */
export function runId(startedAt: number): string {
  return new Date(startedAt).toISOString().replace(/[:.]/g, '-');
}

/**
 * Writes a run's manifest.
 *
 * @param runsDir - directory holding all runs.
 * @returns the path written.
 */
export async function writeRunManifest(runsDir: string, manifest: RunManifest): Promise<string> {
  const directory = join(runsDir, manifest.id);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'manifest.json');
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * Lists the runs on disk, newest first.
 *
 * A directory that is not a readable manifest is skipped rather than failing
 * the listing: half-written runs happen when a suite is interrupted, and the
 * runs around them are still worth showing.
 */
export async function readRunHistory(runsDir: string): Promise<readonly RunSummaryEntry[]> {
  let entries: string[];
  try {
    entries = (await readdir(runsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return []; // no runs yet is not an error
  }

  const runs: RunSummaryEntry[] = [];
  for (const id of entries.sort().reverse().slice(0, MAX_RUNS)) {
    const manifest = await readRunManifest(runsDir, id);
    if (manifest === null) continue;
    runs.push({
      id: manifest.id,
      startedAt: manifest.startedAt,
      finishedAt: manifest.finishedAt,
      summary: manifest.summary,
      testCount: manifest.tests.length,
    });
  }
  return runs;
}

/**
 * Reads one run's manifest.
 *
 * @returns the manifest, or `null` when it is missing, unreadable, or written
 * by a version this build does not know. A manifest is a file on disk and is
 * validated like one.
 */
export async function readRunManifest(runsDir: string, id: string): Promise<RunManifest | null> {
  // The id names a directory; a caller must not be able to walk out of the
  // runs directory with one.
  if (id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) return null;
  let raw: string;
  try {
    raw = await readFile(join(runsDir, id, 'manifest.json'), 'utf8');
  } catch {
    return null;
  }
  return parseRunManifest(raw);
}

/** Validates a manifest's text. Exported for the tests that hand it garbage. */
export function parseRunManifest(raw: string): RunManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value['v'] !== RUN_MANIFEST_VERSION) return null;

  const id = text(value['id']);
  const startedAt = finite(value['startedAt']);
  const finishedAt = finite(value['finishedAt']);
  const summary = parseSummary(value['summary']);
  if (id === null || startedAt === null || finishedAt === null || summary === null) return null;

  return { v: RUN_MANIFEST_VERSION, id, startedAt, finishedAt, summary, tests: parseTests(value['tests']) };
}

function parseSummary(value: unknown): UiRunSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const counts = ['total', 'passed', 'failed', 'skipped', 'flaky', 'durationMs'].map((key) =>
    finite(record[key]),
  );
  if (counts.some((count) => count === null)) return null;
  const [total, passed, failed, skipped, flaky, durationMs] = counts as number[];
  return {
    total: total as number,
    passed: passed as number,
    failed: failed as number,
    skipped: skipped as number,
    flaky: flaky as number,
    durationMs: durationMs as number,
  };
}

function parseTests(value: unknown): readonly RunTest[] {
  if (!Array.isArray(value)) return [];
  const tests: RunTest[] = [];
  for (const entry of value.slice(0, MAX_TESTS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = text(record['id']);
    const title = text(record['title']);
    const status = record['status'];
    if (id === null || title === null) continue;
    if (status !== 'passed' && status !== 'failed' && status !== 'skipped') continue;
    const traceRef = text(record['traceRef']);
    const error = text(record['error']);
    tests.push({
      id,
      title,
      file: text(record['file']) ?? '',
      status,
      durationMs: finite(record['durationMs']) ?? 0,
      flaky: record['flaky'] === true,
      ...(traceRef === null ? {} : { traceRef }),
      ...(error === null ? {} : { error }),
    });
  }
  return tests;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
