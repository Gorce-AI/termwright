import { useEffect, useMemo, useState } from 'react';
import type { DataSource } from '../../data-source.js';
import type { RunTest } from '../../runs.js';
import type { TraceOverview, TraceStatePayload } from '../../trace-source.js';
import type { TraceFrames } from '../../trace-playback.js';
import { alignedSteps, semanticDifferences } from '../domain/comparison.js';
import { TerminalStage } from './TerminalStage.js';

interface Loaded {
  readonly source: DataSource;
  readonly overview: TraceOverview;
  readonly frames: TraceFrames;
}
export function AttemptComparison({
  source,
  test,
  onClose,
}: {
  readonly source: DataSource;
  readonly test: RunTest;
  readonly onClose: () => void;
}) {
  const options = useMemo(
    () =>
      test.attempts.flatMap((attempt, index) =>
        attempt.recordings
          .filter((recording) => recording.available)
          .map((recording, session) => ({
            key: `${attempt.attemptId}:${recording.path}`,
            path: recording.path,
            attemptId: attempt.attemptId,
            status: attempt.status,
            label: `Attempt ${index + 1} · ${attempt.status} · session ${session + 1}`,
          })),
      ),
    [test],
  );
  const [leftKey, setLeftKey] = useState(
    () => (options.find((option) => option.status === 'failed') ?? options[0])!.key,
  );
  const [rightKey, setRightKey] = useState(
    () => (options.findLast((option) => option.status === 'passed') ?? options.at(-1))!.key,
  );
  const left = useRecording(source, options.find((option) => option.key === leftKey)!.path);
  const right = useRecording(source, options.find((option) => option.key === rightKey)!.path);
  const [leftTime, setLeftTime] = useState(0);
  const [rightTime, setRightTime] = useState(0);
  const [alignment, setAlignment] = useState('end');
  const steps = useMemo(
    () => (left.data && right.data ? alignedSteps(left.data.overview, right.data.overview) : []),
    [left.data, right.data],
  );
  useEffect(() => {
    if (left.data && right.data) {
      setLeftTime(left.data.overview.durationMs);
      setRightTime(right.data.overview.durationMs);
      setAlignment('end');
    }
  }, [left.data, right.data]);
  const leftState = useMoment(left.data, leftTime);
  const rightState = useMoment(right.data, rightTime);
  const differences =
    leftState.data?.snapshot && rightState.data?.snapshot
      ? semanticDifferences(leftState.data.snapshot, rightState.data.snapshot)
      : null;
  const align = (key: string) => {
    setAlignment(key);
    const step = steps.find((item) => item.key === key);
    setLeftTime(key === 'start' ? 0 : (step?.left ?? left.data?.overview.durationMs ?? 0));
    setRightTime(key === 'start' ? 0 : (step?.right ?? right.data?.overview.durationMs ?? 0));
  };
  return (
    <section className="tw-attempt-comparison" aria-label="Attempt comparison">
      <header>
        <div>
          <h3>Compare attempts</h3>
          <p>{test.title}</p>
        </div>
        <button type="button" className="tw-secondary-button" onClick={onClose}>
          Close comparison
        </button>
      </header>
      <label className="tw-compare-alignment">
        Align recordings
        <select
          aria-label="Align recordings"
          value={alignment}
          onChange={(event) => align(event.currentTarget.value)}
          disabled={!left.data || !right.data}
        >
          <option value="start">Start</option>
          <option value="end">Outcome</option>
          {alignment === 'custom' ? <option value="custom">Independent positions</option> : null}
          {steps.map((step) => (
            <option key={step.key} value={step.key}>
              {step.title} · step end
            </option>
          ))}
        </select>
      </label>
      {left.data && right.data && steps.length === 0 ? (
        <p className="tw-filter-count">
          No matching named steps. Compare outcomes or seek each recording independently.
        </p>
      ) : null}
      <div className="tw-comparison-screens">
        <ComparisonSide
          label="Before"
          options={options}
          selected={leftKey}
          onSelect={(key) => {
            setLeftKey(key);
            setAlignment('end');
          }}
          loaded={left}
          moment={leftState}
          time={leftTime}
          onTime={(time) => {
            setLeftTime(time);
            setAlignment('custom');
          }}
        />
        <ComparisonSide
          label="After"
          options={options}
          selected={rightKey}
          onSelect={(key) => {
            setRightKey(key);
            setAlignment('end');
          }}
          loaded={right}
          moment={rightState}
          time={rightTime}
          onTime={(time) => {
            setRightTime(time);
            setAlignment('custom');
          }}
        />
      </div>
      <section className="tw-semantic-diff" aria-label="Semantic differences">
        <h4>Semantic differences</h4>
        {leftKey === rightKey ? <p>The same recording is selected on both sides.</p> : null}
        {differences === null ? (
          <p>
            {left.error || right.error || leftState.error || rightState.error
              ? 'Resolve the recording error to compare these moments.'
              : !leftState.data || !rightState.data
                ? 'Loading semantic states…'
                : 'Semantic comparison needs a recorded tree on both sides at the selected moments.'}
          </p>
        ) : (
          <>
            <p>
              {differences.differences.length} changed, added or removed elements
              {differences.ambiguous
                ? ` · ${differences.ambiguous} ambiguous identities omitted`
                : ''}
            </p>
            {differences.differences.length === 0 ? (
              <p>No differences in names, states or visible bounds.</p>
            ) : (
              differences.differences.map((change) => (
                <details key={change.key}>
                  <summary>
                    {change.kind} · {change.label}
                  </summary>
                  <div>
                    <pre aria-label="Before element">{change.before}</pre>
                    <pre aria-label="After element">{change.after}</pre>
                  </div>
                </details>
              ))
            )}
          </>
        )}
      </section>
    </section>
  );
}
function useRecording(source: DataSource, path: string) {
  const [state, setState] = useState<{ path: string; data: Loaded | null; error: string | null }>({
    path,
    data: null,
    error: null,
  });
  useEffect(() => {
    let active = true;
    setState({ path, data: null, error: null });
    const scoped = source.forTrace?.(path);
    if (scoped === undefined) {
      setState({ path, data: null, error: 'Independent replay is unavailable.' });
      return;
    }
    void scoped
      .openTrace(path)
      .then(async (result) => {
        if (result.trace === null) throw new Error('Recording unavailable.');
        const frames = await scoped.traceFrames();
        if (active)
          setState({ path, data: { source: scoped, overview: result.trace, frames }, error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ path, data: null, error: String(error) });
      });
    return () => {
      active = false;
    };
  }, [source, path]);
  return state.path === path ? state : { path, data: null, error: null };
}
function useMoment(loaded: Loaded | null, time: number) {
  const [state, setState] = useState<{
    loaded: Loaded | null;
    time: number;
    data: TraceStatePayload | null;
    error: string | null;
  }>({ loaded: null, time, data: null, error: null });
  useEffect(() => {
    let active = true;
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      void loaded.source
        .traceState(time)
        .then((data) => {
          if (active) setState({ loaded, time, data, error: null });
        })
        .catch((error: unknown) => {
          if (active) setState({ loaded, time, data: null, error: String(error) });
        });
    }, 50);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loaded, time]);
  return state.loaded === loaded && state.time === time ? state : { data: null, error: null };
}
function ComparisonSide({
  label,
  options,
  selected,
  onSelect,
  loaded,
  moment,
  time,
  onTime,
}: {
  readonly label: string;
  readonly options: readonly { key: string; label: string }[];
  readonly selected: string;
  readonly onSelect: (key: string) => void;
  readonly loaded: { data: Loaded | null; error: string | null };
  readonly moment: { data: TraceStatePayload | null; error: string | null };
  readonly time: number;
  readonly onTime: (time: number) => void;
}) {
  const data = loaded.data;
  return (
    <section aria-label={`${label} recording`}>
      <label>
        {label}
        <select
          aria-label={`${label} attempt`}
          value={selected}
          onChange={(event) => onSelect(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option value={option.key} key={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {loaded.error || moment.error ? <p role="alert">{loaded.error ?? moment.error}</p> : null}
      {data === null ? (
        loaded.error ? null : (
          <p role="status">Loading recording…</p>
        )
      ) : (
        <>
          <div className="tw-comparison-stage">
            <TerminalStage
              identity={`${label}:${data.overview.path}`}
              mode="replay"
              columns={moment.data?.columns ?? data.overview.columns}
              rows={moment.data?.rows ?? data.overview.rows}
              profile={data.overview.terminalProfile ?? 'default'}
              liveChunks={[]}
              replayFrames={data.frames.frames}
              replayTimeMs={time}
              writable={false}
              highlight={null}
            />
          </div>
          <label className="tw-compare-seek">
            {Math.round(time)}ms / {Math.round(data.overview.durationMs)}ms
            <input
              type="range"
              aria-label={`${label} replay position`}
              min={0}
              max={data.overview.durationMs}
              step="any"
              value={time}
              onChange={(event) => onTime(Number(event.currentTarget.value))}
            />
          </label>
          {data.frames.truncated ? (
            <p role="status">
              This recording is truncated; the terminal may not contain the complete output.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
