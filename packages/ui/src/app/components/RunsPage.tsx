import { AlertTriangle, ArrowRight, Clock3, GitCommitHorizontal, History, Play, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DataSource } from '../../data-source.js';
import type { RunManifest, RunSummaryEntry, RunTest } from '../../runs.js';

export function RunsPage({ source, onOpen }: {
  readonly source: DataSource;
  readonly onOpen: (run: RunManifest, test: RunTest, index: number) => void;
}) {
  const [runs, setRuns] = useState<readonly RunSummaryEntry[]>([]);
  const [opened, setOpened] = useState<RunManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void source.runs().then((result) => { if (active) setRuns(result.runs); }).catch((cause: unknown) => {
      if (active) setError(describe(cause));
    });
    return () => { active = false; };
  }, [source]);

  const openRun = async (id: string) => {
    try { setOpened(await source.run(id)); }
    catch (cause) { setError(describe(cause)); }
  };

  return (
    <section className="tw-runs-page">
      <div className="tw-page-intro">
        <div><h2>Runs</h2><p>Open a retained execution without interrupting a live run.</p></div>
      </div>
      {error === null ? null : <p className="tw-inline-error">{error}</p>}
      {opened === null ? (
        <div className="tw-run-cards">
          {runs.length === 0 ? <div className="tw-page-empty"><History aria-hidden="true" /><strong>No run history yet</strong></div> : runs.map((run) => (
            <button type="button" className="tw-run-card" key={run.id} onClick={() => void openRun(run.id)}>
              <span className="tw-run-card-icon" data-failed={run.summary.failed > 0}><Clock3 aria-hidden="true" /></span>
              <span>
                <strong>{run.git?.message ?? 'Local test run'}</strong>
                <small><time dateTime={new Date(run.startedAt).toISOString()}>{formatStartedAt(run.startedAt)}</time><span>{run.testCount} cases · {format(run.summary.durationMs)}</span></small>
              </span>
              {run.git === undefined ? null : <span className="tw-commit"><GitCommitHorizontal aria-hidden="true" size={13} /> {run.git.commit.slice(0, 7)}</span>}
              <span className="tw-history-counts"><b>{run.summary.passed} passed</b><b>{run.summary.failed} failed</b></span>
              <ArrowRight aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="tw-run-detail">
          <button type="button" className="tw-back-button" onClick={() => setOpened(null)}>← All runs</button>
          <h3>{opened.git?.message ?? opened.id}</h3>
          <time className="tw-run-detail-time" dateTime={new Date(opened.startedAt).toISOString()}>{formatStartedAt(opened.startedAt)}</time>
          <div className="tw-history-tests">
            {opened.tests.map((test, index) => (
              <article key={`${test.id}:${index}`} data-status={test.status}>
                <span>{test.status}</span>
                <div>
                  <strong>{test.title}</strong>
                  <small>{test.file} · {format(test.durationMs)} · attempt {finalAttempt(test)}</small>
                  {test.flaky ? <span className="tw-history-warning"><RefreshCw aria-hidden="true" size={12} /> Passed after a retry</span> : null}
                  {test.lostLogRecords > 0 ? <span className="tw-history-warning"><AlertTriangle aria-hidden="true" size={12} /> {test.lostLogRecords} application log {test.lostLogRecords === 1 ? 'record was' : 'records were'} dropped</span> : null}
                  {test.attempts === undefined || test.attempts.length < 2 ? null : (
                    <details className="tw-history-attempts"><summary>{test.attempts.length - 1} earlier {test.attempts.length === 2 ? 'attempt' : 'attempts'} failed</summary>
                      <ol>{test.attempts.slice(0, -1).map((attempt) => <li key={attempt.attempt}><b>Attempt {attempt.attempt}</b><span>{attempt.errors[0] ?? 'Failure reason was not retained.'}</span></li>)}</ol>
                    </details>
                  )}
                  {test.error === undefined ? null : <pre className="tw-history-error">{test.error}</pre>}
                </div>
                {test.traceRef === undefined ? <em>No recording retained</em> : test.traceAvailable === false ? <em title="The recording path stored by this run no longer exists.">Recording unavailable</em> : (
                  <button type="button" onClick={() => onOpen(opened, test, index)}><Play aria-hidden="true" size={13} /> Replay</button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function format(timeMs: number): string { return timeMs >= 1_000 ? `${(timeMs / 1_000).toFixed(1)}s` : `${timeMs}ms`; }
function finalAttempt(test: RunTest): number { return test.attempts?.at(-1)?.attempt ?? 1; }
function formatStartedAt(startedAt: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(startedAt));
}
function describe(value: unknown): string { return value instanceof Error ? value.message : String(value); }
