import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  GitCommitHorizontal,
  History,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DataSource } from '../../data-source.js';
import type { RunManifest, RunSummaryEntry, RunTest } from '../../runs.js';

export function RunsPage({
  source,
  selectedRunId,
  onSelectedRunId,
}: {
  readonly source: DataSource;
  readonly selectedRunId: string | null;
  readonly onSelectedRunId: (runId: string | null) => void;
}) {
  const [runs, setRuns] = useState<readonly RunSummaryEntry[]>([]);
  const [opened, setOpened] = useState<RunManifest | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const filteredRuns = runs.filter((run) =>
    [
      run.id,
      run.state,
      ...(run.state === 'complete'
        ? [run.git?.message, run.git?.commit, run.summary.status]
        : [healthTitle(run), healthDescription(run)]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError(null);
    void source
      .runs()
      .then((result) => {
        if (active) setRuns(result.runs);
      })
      .catch((cause: unknown) => {
        if (active) setListError(describe(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source, refresh]);

  useEffect(() => {
    let active = true;
    setOpened(null);
    setDetailError(null);
    if (selectedRunId === null) {
      return () => {
        active = false;
      };
    }
    void source
      .run(selectedRunId)
      .then((detail) => {
        if (!active) return;
        if (detail.state === 'complete') setOpened(detail);
        else setDetailError(healthDescription(detail));
      })
      .catch((cause: unknown) => {
        if (active) setDetailError(describe(cause));
      });
    return () => {
      active = false;
    };
  }, [selectedRunId, source, refresh]);

  const openRun = (id: string) => {
    setDetailError(null);
    onSelectedRunId(id);
    /* Loading is owned by the selectedRunId effect so popstate and clicks use one path. */
  };

  return (
    <section className="tw-runs-page">
      <div className="tw-page-intro">
        <div>
          <h2>Runs</h2>
          <p>Browse previous runs, their results and retry attempts.</p>
        </div>
        <button
          type="button"
          className="tw-secondary-button"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
          aria-label="Refresh run history"
        >
          <RefreshCw aria-hidden="true" size={14} /> Refresh
        </button>
      </div>
      {selectedRunId === null ? (
        <div className="tw-history-toolbar">
          <label className="tw-search-box">
            <Search aria-hidden="true" size={14} />
            <span className="sr-only">Search run history</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search run ID, commit or result"
            />
            {query !== '' ? (
              <button
                type="button"
                className="tw-clear-search"
                aria-label="Clear history search"
                onClick={() => setQuery('')}
              >
                <X aria-hidden="true" size={14} />
              </button>
            ) : null}
          </label>
        </div>
      ) : (
        <button type="button" className="tw-back-button" onClick={() => onSelectedRunId(null)}>
          ← All runs
        </button>
      )}
      {(selectedRunId === null ? listError : detailError) === null ? null : (
        <div className="tw-inline-error" role="alert">
          <p>{selectedRunId === null ? listError : detailError}</p>
          <button
            type="button"
            className="tw-secondary-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {selectedRunId !== null && (opened === null || opened.id !== selectedRunId) ? (
        detailError === null ? (
          <p role="status" className="tw-filter-count">
            Loading run details…
          </p>
        ) : null
      ) : selectedRunId === null ? (
        <div className="tw-run-cards">
          {loading && runs.length === 0 ? (
            <p role="status" className="tw-filter-count">
              Loading run history…
            </p>
          ) : listError !== null && runs.length === 0 ? null : filteredRuns.length === 0 ? (
            <div className="tw-page-empty">
              <History aria-hidden="true" />
              <strong>{query.trim() !== '' ? 'No matching runs' : 'No run history yet'}</strong>
              <p>
                {query.trim() !== ''
                  ? 'Try another run ID, commit or result.'
                  : 'Completed test runs will appear here. Refresh after running tests.'}
              </p>
            </div>
          ) : (
            filteredRuns.map((run) =>
              run.state === 'complete' ? (
                <button
                  type="button"
                  className="tw-run-card"
                  key={run.id}
                  onClick={() => openRun(run.id)}
                >
                  <span className="tw-run-card-icon" data-health={run.summary.status}>
                    <Clock3 aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{run.git?.message ?? run.id}</strong>
                    <small>
                      <time dateTime={new Date(run.startedAt).toISOString()}>
                        {formatStartedAt(run.startedAt)}
                      </time>
                      <span>
                        {run.summary.status.replaceAll('-', ' ')} · {run.testCount}{' '}
                        {run.testCount === 1 ? 'case' : 'cases'} · {format(run.summary.durationMs)}
                      </span>
                    </small>
                  </span>
                  {run.git === null ? null : (
                    <span className="tw-commit">
                      <GitCommitHorizontal aria-hidden="true" size={13} />{' '}
                      {run.git.commit.slice(0, 7)}
                    </span>
                  )}
                  <span className="tw-history-counts">
                    <b data-status="passed">{run.summary.passed} passed</b>
                    <b data-status="failed">{run.summary.failed} failed</b>
                    <b data-status="skipped">{run.summary.skipped} skipped</b>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </button>
              ) : (
                <article
                  className="tw-run-card"
                  data-health={run.state}
                  key={`${run.state}:${run.id}`}
                >
                  <span className="tw-run-card-icon" data-failed>
                    <AlertTriangle aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{healthTitle(run)}</strong>
                    <small>{healthDescription(run)}</small>
                  </span>
                  <code>{run.id}</code>
                </article>
              ),
            )
          )}
        </div>
      ) : opened === null ? null : (
        <div className="tw-run-detail">
          <h3>{opened.git?.message ?? opened.id}</h3>
          <time className="tw-run-detail-time" dateTime={new Date(opened.startedAt).toISOString()}>
            {formatStartedAt(opened.startedAt)}
          </time>
          <p className="tw-filter-count">Recording not retained in native manifest</p>
          <div className="tw-history-tests">
            {opened.tests.map((test) => (
              <article key={test.id} data-status={test.status}>
                <span>{test.status}</span>
                <div>
                  <strong>{test.title}</strong>
                  <small>
                    {test.file} · {formatNullable(test.durationMs)} · {attemptLabel(test)}
                  </small>
                  {test.flaky ? (
                    <span className="tw-history-warning">
                      <RefreshCw aria-hidden="true" size={12} /> Passed after a retry
                    </span>
                  ) : null}
                  {test.attempts.length < 2 ? null : (
                    <details className="tw-history-attempts">
                      <summary>{test.attempts.length} exact attempts</summary>
                      <ol>
                        {test.attempts.map((attempt) => (
                          <li key={attempt.attemptId}>
                            <b>
                              repeat {attempt.repeat}, retry {attempt.retry}
                            </b>
                            <span>
                              {attempt.status} · {formatNullable(attempt.durationMs)} ·{' '}
                              {attempt.attemptId}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
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
function format(timeMs: number): string {
  return timeMs >= 1_000 ? `${(timeMs / 1_000).toFixed(1)}s` : `${timeMs}ms`;
}
function formatNullable(timeMs: number | null): string {
  return timeMs === null ? 'duration unavailable' : format(timeMs);
}
function attemptLabel(test: RunTest): string {
  return `${test.attempts.length} ${test.attempts.length === 1 ? 'attempt' : 'attempts'}`;
}
function formatStartedAt(startedAt: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(startedAt),
  );
}
function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
