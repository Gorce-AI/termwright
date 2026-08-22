/**
 * What the panel knows about a spec file beyond its name: when it last
 * changed, how long it usually takes, and how its last few runs went.
 *
 * These are facts about the project on disk and about the runs already
 * recorded — not events of a run in progress — which is why they are served
 * over HTTP and are absent from the event protocol. A page asks once when the
 * list is shown, and again when it has reason to think the answer changed.
 *
 * @packageDocumentation
 */

import { stat } from 'node:fs/promises';
import { readRunHistory, readRunManifest } from './runs.js';
import type { SpecFacts, SpecRun } from './spec-tree.js';

/** How many past runs a spec's dots and average are drawn from. */
const RUNS_CONSIDERED = 4;

/** Runs read while assembling the answer, so a long history stays bounded. */
const MANIFESTS_READ = 20;

/**
 * Reads the facts for every spec file named.
 *
 * @param files - absolute paths, as the producer reports them.
 * @param runsDir - directory holding run manifests.
 */
export async function readSpecFacts(
  files: readonly string[],
  runsDir: string,
): Promise<readonly SpecFacts[]> {
  const history = await readRecentResults(runsDir);
  return Promise.all(
    files.map(async (file) => {
      const results = history.get(file) ?? [];
      const latest = results.slice(0, RUNS_CONSIDERED);
      const durations = results
        .slice(0, RUNS_CONSIDERED)
        .map((entry) => entry.durationMs)
        .filter((value): value is number => value !== null);
      return {
        file,
        modifiedMs: await modifiedAt(file),
        averageMs:
          durations.length === 0
            ? null
            : Math.round(durations.reduce((total, value) => total + value, 0) / durations.length),
        latest: latest.map(({ runId, status }): SpecRun => ({ runId, status })),
      };
    }),
  );
}

/** One test result as the history recorded it, for averaging and for dots. */
interface Recorded extends SpecRun {
  readonly durationMs: number | null;
}

/**
 * Results per file across the recent runs, newest first.
 *
 * A run that touched a file several times (several tests in it) contributes
 * one entry per *run*, not per test: the dots are a history of runs, and a
 * file with forty tests would otherwise fill them from a single afternoon.
 */
async function readRecentResults(runsDir: string): Promise<Map<string, Recorded[]>> {
  const byFile = new Map<string, Recorded[]>();
  const runs = (await readRunHistory(runsDir)).slice(0, MANIFESTS_READ);

  for (const summary of runs) {
    // Health records are surfaced by Runs. They are deliberately excluded
    // from performance/result facts because they do not certify test results.
    if (summary.state !== 'complete') continue;
    const manifest = await readRunManifest(runsDir, summary.id);
    if (manifest.state !== 'complete') continue;

    const perFile = new Map<string, { failed: boolean; skipped: boolean; durationMs: number }>();
    for (const test of manifest.tests) {
      if (test.file === '') continue;
      if (test.status === 'incomplete' || test.status === 'not-run') continue;
      const seen = perFile.get(test.file) ?? { failed: false, skipped: true, durationMs: 0 };
      perFile.set(test.file, {
        // One failure makes the file's run a failure, which is how a person
        // reads a spec file's result.
        failed: seen.failed || test.status === 'failed',
        skipped: seen.skipped && test.status === 'skipped',
        durationMs: seen.durationMs + (test.durationMs ?? 0),
      });
    }

    for (const [file, result] of perFile) {
      const list = byFile.get(file) ?? [];
      list.push({
        runId: manifest.id,
        status: result.failed ? 'failed' : result.skipped ? 'skipped' : 'passed',
        durationMs: result.durationMs,
      });
      byFile.set(file, list);
    }
  }
  return byFile;
}

/** Modification time, or `null` for a file this process cannot see. */
async function modifiedAt(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    // A test whose file was deleted, renamed, or reported as a virtual path:
    // the row still belongs in the list, just without an age.
    return null;
  }
}
