import { AlertTriangle, ArrowRight, Clock3, GitCommitHorizontal, History, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DataSource } from '../../data-source.js';
import type { RunManifest, RunSummaryEntry, RunTest } from '../../runs.js';

export function RunsPage({ source, selectedRunId, onSelectedRunId }: {
  readonly source: DataSource;
  readonly selectedRunId: string | null;
  readonly onSelectedRunId: (runId: string | null) => void;
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

  useEffect(() => {
    let active = true;
    setOpened(null);
    setError(null);
    if (selectedRunId === null) {
      return () => { active = false; };
    }
    void source.run(selectedRunId).then((detail) => {
      if (!active) return;
      if (detail.state === 'complete') setOpened(detail);
      else setError(healthDescription(detail));
    }).catch((cause: unknown) => { if (active) setError(describe(cause)); });
    return () => { active = false; };
  }, [selectedRunId, source]);

  const openRun = (id: string) => {
    setError(null);
    onSelectedRunId(id);
    /* Loading is owned by the selectedRunId effect so popstate and clicks use one path. */
  };

  return (
    <section className="tw-runs-page">
      <div className="tw-page-intro">
        <div><h2>Runs</h2><p>Native-host results and the health of every retained transaction.</p></div>
      </div>
      {error === null ? null : <p className="tw-inline-error">{error}</p>}
      {opened === null ? (
        <div className="tw-run-cards">
          {runs.length === 0 ? <div className="tw-page-empty"><History aria-hidden="true" /><strong>No run history yet</strong></div> : runs.map((run) => (
            run.state === 'complete' ? (
              <button type="button" className="tw-run-card" key={run.id} onClick={() => openRun(run.id)}>
                <span className="tw-run-card-icon" data-health={run.summary.status}><Clock3 aria-hidden="true" /></span>
                <span>
                  <strong>{run.git?.message ?? run.id}</strong>
                  <small><time dateTime={new Date(run.startedAt).toISOString()}>{formatStartedAt(run.startedAt)}</time><span>{run.testCount} cases · {format(run.summary.durationMs)}</span></small>
                </span>
                {run.git === null ? null : <span className="tw-commit"><GitCommitHorizontal aria-hidden="true" size={13} /> {run.git.commit.slice(0, 7)}</span>}
                <span className="tw-history-counts"><b>{run.summary.passed} passed</b><b>{run.summary.failed} failed</b><b>{run.summary.skipped} skipped</b></span>
                <ArrowRight aria-hidden="true" />
              </button>
            ) : (
              <article className="tw-run-card" data-health={run.state} key={`${run.state}:${run.id}`}>
                <span className="tw-run-card-icon" data-failed><AlertTriangle aria-hidden="true" /></span>
                <span><strong>{healthTitle(run)}</strong><small>{healthDescription(run)}</small></span>
                <code>{run.id}</code>
              </article>
            )
          ))}
        </div>
      ) : (
        <div className="tw-run-detail">
          <button type="button" className="tw-back-button" onClick={() => onSelectedRunId(null)}>← All runs</button>
          <h3>{opened.git?.message ?? opened.id}</h3>
          <time className="tw-run-detail-time" dateTime={new Date(opened.startedAt).toISOString()}>{formatStartedAt(opened.startedAt)}</time>
          <div className="tw-history-tests">
            {opened.tests.map((test) => (
              <article key={test.id} data-status={test.status}>
                <span>{test.status}</span>
                <div>
                  <strong>{test.title}</strong>
                  <small>{test.file} · {formatNullable(test.durationMs)} · {attemptLabel(test)}</small>
                  {test.flaky ? <span className="tw-history-warning"><RefreshCw aria-hidden="true" size={12} /> Passed after a retry</span> : null}
                  {test.attempts.length < 2 ? null : (
                    <details className="tw-history-attempts"><summary>{test.attempts.length} exact attempts</summary>
                      <ol>{test.attempts.map((attempt) => <li key={attempt.attemptId}><b>repeat {attempt.repeat}, retry {attempt.retry}</b><span>{attempt.status} · {formatNullable(attempt.durationMs)} · {attempt.attemptId}</span></li>)}</ol>
                    </details>
                  )}
                </div>
                <em>Recording not retained in native manifest</em>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function healthTitle(run: Exclude<RunSummaryEntry, { readonly state: 'complete' }>): string {
  if (run.state === 'incomplete') return 'Incomplete run transaction';
  if (run.state === 'corrupt') return 'Corrupt run history';
  return 'Unsupported run-history version';
}
function healthDescription(run: Exclude<RunSummaryEntry, { readonly state: 'complete' }>): string {
  if (run.state === 'incomplete' || run.state === 'corrupt') return run.reason;
  return `Manifest version ${run.version ?? 'unknown'} is not supported by this Runner.`;
}
function format(timeMs: number): string { return timeMs >= 1_000 ? `${(timeMs / 1_000).toFixed(1)}s` : `${timeMs}ms`; }
function formatNullable(timeMs: number | null): string { return timeMs === null ? 'duration unavailable' : format(timeMs); }
function attemptLabel(test: RunTest): string { return `${test.attempts.length} ${test.attempts.length === 1 ? 'attempt' : 'attempts'}`; }
function formatStartedAt(startedAt: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(startedAt));
}
function describe(value: unknown): string { return value instanceof Error ? value.message : String(value); }
