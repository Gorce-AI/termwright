import { AlertTriangle, X } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { DataSource, ViewerState } from '../data-source.js';
import type { RunnerClient } from '../browser-client.js';
import { parseCommandLine } from '../command-line.js';
import { editorLink } from '../editor-link.js';
import { AppShell } from './components/AppShell.js';
import { RunnerPage } from './components/RunnerPage.js';
import { RecordReviewDialog, RecordStartDialog, type RecorderDraft } from './components/RecorderDialogs.js';
import { RunsPage } from './components/RunsPage.js';
import { SettingsPage } from './components/SettingsPage.js';
import { SpecsPage } from './components/SpecsPage.js';
import type { ExecutionCase } from './domain/model.js';
import { initialAppState } from './domain/model.js';
import { appReducer } from './domain/reducer.js';
import { catalogCases, selectedCase } from './domain/selectors.js';
import { usePreferences } from './preferences.js';
import { Tooltip } from './components/Tooltip.js';

export function TermwrightApp({ source, client }: { readonly source: DataSource; readonly client?: RunnerClient }) {
  const { preferences } = usePreferences();
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const initialViewer = useRef<ViewerState | null>(null);
  const activeTrace = useRef<{ readonly ref: string; readonly overview: NonNullable<ViewerState['trace']> } | null>(null);
  const replayEpoch = useRef(0);
  const replayClock = useRef(0);
  const autoReplayRequests = useRef(new Set<string>());
  const runRequestInFlight = useRef(false);
  const [recordDialog, setRecordDialog] = useState<'closed' | 'start' | 'review'>('closed');
  const [recordDraft, setRecordDraft] = useState<RecorderDraft>({ command: '', outFile: 'tests/recorded.test.ts', error: null, busy: false });
  const [recordReview, setRecordReview] = useState({ source: '', error: null as string | null, busy: false });

  useEffect(() => {
    let active = true;
    void source.state().then((viewer) => {
      if (!active) return;
      initialViewer.current = viewer;
      activeTrace.current = viewer.trace === null ? null : { ref: viewer.trace.path, overview: viewer.trace };
      if (viewer.record !== null) {
        setRecordDraft((draft) => ({
          ...draft,
          command: commandForForm(viewer.record?.command ?? []),
          outFile: viewer.record?.outFile ?? '',
        }));
      }
      dispatch({ type: 'boot-ready', viewer });
    }).catch((cause: unknown) => {
      if (active) dispatch({ type: 'boot-error', error: describe(cause) });
    });
    client?.connect(
      (message) => dispatch({ type: 'message', message }),
      (connected) => dispatch({ type: 'connected', connected }),
    );
    return () => {
      active = false;
      client?.disconnect();
    };
  }, [client, source]);

  const openReplay = useCallback(async (execution: ExecutionCase) => {
    if (execution.traceRef === undefined) return;
    const epoch = ++replayEpoch.current;
    dispatch({ type: 'replay-loading', executionId: execution.executionId, traceRef: execution.traceRef });
    try {
      const initial = initialViewer.current?.trace;
      let overview = activeTrace.current?.ref === execution.traceRef
        ? activeTrace.current.overview
        : null;
      if (overview === null && source.features.openTrace) {
        overview = (await source.openTrace(execution.traceRef)).trace;
        if (overview !== null) activeTrace.current = { ref: execution.traceRef, overview };
      } else if (overview === null) {
        overview = initial ?? null;
      }
      if (overview === null || overview === undefined) throw new Error('The recording is unavailable.');
      const [frames, commands, traceState, logs] = await Promise.all([
        source.traceFrames(),
        source.traceCommands(),
        source.traceState(0),
        source.traceLogs({ limit: 500 }),
      ]);
      if (epoch !== replayEpoch.current) return;
      dispatch({
        type: 'replay-loaded',
        executionId: execution.executionId,
        traceRef: execution.traceRef,
        overview,
        frames,
        commands,
        traceState,
        logs,
      });
    } catch (cause) {
      if (epoch === replayEpoch.current) {
        autoReplayRequests.current.delete(`${execution.executionId}:${execution.traceRef}`);
        dispatch({ type: 'replay-error', executionId: execution.executionId, traceRef: execution.traceRef, error: describe(cause) });
      }
    }
  }, [source]);

  const selected = selectedCase(state);
  const runBusy = state.pendingRunTargets !== null || state.run.status === 'running' || state.run.status === 'stopping';
  useEffect(() => {
    if (state.pendingRunTargets === null && state.run.status !== 'running' && state.run.status !== 'stopping') {
      runRequestInFlight.current = false;
    }
  }, [state.pendingRunTargets, state.run.status]);
  useEffect(() => {
    if (
      !preferences.autoLiveReplay
      ||
      selected === null
      || selected.traceRef === undefined
      || (selected.status !== 'passed' && selected.status !== 'failed')
      || state.evidence.kind !== 'live'
      || state.evidence.executionId !== selected.executionId
    ) return;
    const requestKey = `${selected.executionId}:${selected.traceRef}`;
    if (autoReplayRequests.current.has(requestKey)) return;
    autoReplayRequests.current.add(requestKey);
    void openReplay(selected);
  }, [openReplay, preferences.autoLiveReplay, selected, state.evidence]);

  const replay = state.evidence.kind === 'replay' ? state.evidence.replay : null;
  useEffect(() => {
    if (replay === null) return;
    dispatch({ type: 'replay-speed', speed: preferences.defaultReplaySpeed });
  }, [preferences.defaultReplaySpeed, replay?.traceRef]);
  replayClock.current = replay?.timeMs ?? 0;
  useEffect(() => {
    if (replay === null || !replay.playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = Math.min(
        replay.overview.durationMs,
        replayClock.current + (now - previous) * replay.speed,
      );
      previous = now;
      replayClock.current = next;
      dispatch({ type: 'replay-time', timeMs: next });
      if (next >= replay.overview.durationMs) {
        dispatch({ type: 'replay-playing', playing: false });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [replay?.overview.durationMs, replay?.playing, replay?.speed]);

  useEffect(() => {
    if (replay === null || !source.features.live) return;
    const traceRef = replay.traceRef;
    const epoch = replayEpoch.current;
    let active = true;
    const timer = window.setTimeout(() => {
      void source.traceState(replay.timeMs).then((traceState) => {
        if (active && epoch === replayEpoch.current) dispatch({ type: 'replay-state', traceRef, traceState });
      }).catch(() => undefined);
    }, 50);
    return () => { active = false; window.clearTimeout(timer); };
  }, [replay?.timeMs, replay?.traceRef, source]);

  const run = (targets: readonly string[]) => {
    if (client === undefined || !state.connected || !state.canRun || runBusy || runRequestInFlight.current) return;
    runRequestInFlight.current = true;
    dispatch({ type: 'run-requested', targets });
    void client.startRun(targets).catch((cause: unknown) => {
      // The server will normally publish a run failure; this catches a request
      // that never reached it and keeps the error in the visible live region.
      runRequestInFlight.current = false;
      dispatch({ type: 'run-request-cleared' });
      dispatch({ type: 'toast', tone: 'failure', text: runFailureText(cause) });
    });
  };
  const openSource = (execution: ExecutionCase) => {
    const file = projectFile(state.project?.root ?? '', execution.source.file);
    const location = editorLink(preferences.editor, file, execution.source.line);
    const copy = navigator.clipboard.writeText(file);
    if (location === null) {
      void copy.then(() => dispatch({ type: 'toast', tone: 'success', text: `Copied ${file}` }))
        .catch(() => dispatch({ type: 'toast', tone: 'failure', text: `Could not copy ${file}` }));
      return;
    }
    // URL schemes cannot report whether a local editor accepted them. Copying
    // the exact path first leaves a deterministic fallback without another UI.
    void copy.catch(() => undefined);
    window.location.href = location;
    dispatch({ type: 'toast', tone: 'info', text: 'Opening source in your configured editor; the path was copied as a fallback.' });
  };
  const stop = () => {
    if (client === undefined || state.run.status !== 'running') return;
    dispatch({ type: 'stop-requested' });
    void client.stopRun().catch((cause: unknown) => {
      dispatch({ type: 'toast', tone: 'failure', text: runFailureText(cause) });
    });
  };
  const startRecording = async () => {
    if (client === undefined || recordDraft.busy) return;
    try {
      const command = parseCommandLine(recordDraft.command);
      if (command.length === 0) throw new Error('Enter a command to record.');
      setRecordDraft((draft) => ({ ...draft, busy: true, error: null }));
      await client.startRecording(command, recordDraft.outFile === '' ? undefined : recordDraft.outFile);
      // Launching is complete once the server accepts the recorder. Keeping
      // this flag set for the whole session also disables Stop, leaving the
      // recorder with no way to reach review.
      setRecordDraft((draft) => ({ ...draft, busy: false, error: null }));
      setRecordDialog('closed');
      dispatch({ type: 'toast', tone: 'success', text: 'Recording started — interact with the terminal or semantic tree.' });
    } catch (cause) {
      setRecordDraft((draft) => ({ ...draft, busy: false, error: describe(cause) }));
    }
  };
  const stopRecording = async () => {
    if (client === undefined || recordReview.busy) return;
    setRecordReview((review) => ({ ...review, busy: true, error: null }));
    try {
      const { source: generated } = await client.stopRecording();
      setRecordReview({ source: generated, error: null, busy: false });
      setRecordDialog('review');
    } catch (cause) {
      setRecordReview((review) => ({ ...review, busy: false, error: describe(cause) }));
      dispatch({ type: 'toast', tone: 'failure', text: `Could not stop recording: ${describe(cause)}` });
    }
  };
  const saveRecording = async () => {
    if (client === undefined || recordReview.busy) return;
    setRecordReview((review) => ({ ...review, busy: true, error: null }));
    try {
      const { path } = await client.save(recordDraft.outFile === '' ? undefined : recordDraft.outFile);
      setRecordDialog('closed');
      setRecordReview({ source: '', error: null, busy: false });
      dispatch({ type: 'toast', tone: 'success', text: `Saved recorded test to ${path}` });
      dispatch({ type: 'route', route: 'specs' });
    } catch (cause) {
      setRecordReview((review) => ({ ...review, busy: false, error: describe(cause) }));
    }
  };
  const discardRecording = async () => {
    if (client === undefined || recordReview.busy) return;
    setRecordReview((review) => ({ ...review, busy: true, error: null }));
    try {
      await client.discardRecording();
      setRecordDialog('closed');
      setRecordReview({ source: '', error: null, busy: false });
      dispatch({ type: 'toast', tone: 'info', text: 'Recording discarded; no file was written.' });
    } catch (cause) {
      setRecordReview((review) => ({ ...review, busy: false, error: describe(cause) }));
    }
  };
  const recorderCall = (operation: () => Promise<unknown>, success: string) => {
    void operation().then(() => dispatch({ type: 'toast', tone: 'success', text: success }))
      .catch((cause: unknown) => dispatch({ type: 'toast', tone: 'failure', text: describe(cause) }));
  };
  if (state.boot === 'loading') {
    return <div className="tw-boot"><span className="tw-boot-mark" /><strong>Preparing the execution workspace</strong></div>;
  }
  if (state.boot === 'error' || state.project === null) {
    return (
      <div className="tw-fatal" role="alert">
        <AlertTriangle aria-hidden="true" />
        <h1>Termwright could not initialize</h1>
        <p>{state.bootError ?? 'The project context is unavailable.'}</p>
      </div>
    );
  }

  const project = state.project;
  const catalogue = catalogCases(state);
  return (
    <AppShell
      project={project}
      route={state.route}
      connected={state.connected}
      features={source.features}
      onRoute={(route) => dispatch({ type: 'route', route })}
    >
      {state.route === 'runner' ? (
        <RunnerPage
          state={state}
          interactive={source.features.live}
          dispatch={dispatch}
          onRun={run}
          onStop={stop}
          onInput={(sessionId, data) => {
            if (client === undefined) return;
            void client.sendInput(sessionId, data).catch((cause: unknown) => {
              dispatch({ type: 'toast', tone: 'failure', text: `Terminal input failed: ${describe(cause)}` });
            });
          }}
          {...(client === undefined ? {} : { onInspectActionability: (sessionId: string, nodeId: string) => client.inspectActionability(sessionId, nodeId) })}
          onTraceStateAt={(timeMs) => source.traceState(timeMs)}
          onOpenReplay={(executionId) => {
            const execution = state.executions.find((test) => test.executionId === executionId)
              ?? state.catalog.find((test) => test.executionId === executionId);
            if (execution !== undefined) void openReplay(execution);
          }}
          onSelectExecution={(executionId) => {
            const execution = state.executions.find((test) => test.executionId === executionId)
              ?? state.catalog.find((test) => test.executionId === executionId);
            dispatch({ type: 'select-execution', executionId });
            if (execution?.traceRef !== undefined && (execution.status === 'passed' || execution.status === 'failed')) {
              void openReplay(execution);
            }
          }}
          {...(client === undefined ? {} : {
            recorder: {
              active: state.run.mode === 'record',
              busy: recordDraft.busy || recordReview.busy,
              onStop: () => { void stopRecording(); },
              onStep: (title: string) => recorderCall(() => client.recordStep(title), `Added step “${title}”`),
              onSnapshot: () => recorderCall(() => client.recordAssert('snapshot'), 'Added semantic snapshot assertion'),
              onClickNode: (nodeId: string) => recorderCall(() => client.recordAction('click', nodeId), 'Recorded semantic click'),
              onAssertNode: (nodeId: string) => recorderCall(() => client.recordAction('assert-visible', nodeId), 'Added visibility assertion'),
            },
          })}
        />
      ) : state.route === 'specs' ? (
        <SpecsPage
          cases={catalogue}
          projectRoot={project.root}
          canRun={state.canRun}
          connected={state.connected}
          runBusy={runBusy}
          onRun={run}
          onOpenSource={openSource}
          {...(client === undefined ? {} : { newTest: {
            canRecord: state.connected && !runBusy,
            onCreateFile: () => {
              const file = projectFile(project.root, recordDraft.outFile || 'tests/new.test.ts');
              const link = editorLink(preferences.editor, file);
              void navigator.clipboard.writeText(file).catch(() => undefined);
              if (link !== null) window.location.href = link;
              else dispatch({ type: 'toast', tone: 'success', text: `Copied ${file}` });
            },
            onRecord: () => { setRecordDraft((draft) => ({ ...draft, busy: false, error: null })); setRecordDialog('start'); },
          } })}
        />
      ) : state.route === 'runs' ? (
        <RunsPage source={source} />
      ) : (
        <SettingsPage state={state} features={source.features} />
      )}
      {state.toast === null ? null : (
        <div className="tw-toast" data-tone={state.toast.tone} role="status">
          <span>{state.toast.text}</span>
          <Tooltip label="Dismiss notification"><button type="button" aria-label="Dismiss notification" onClick={() => dispatch({ type: 'toast-clear' })}><X aria-hidden="true" size={15} /></button></Tooltip>
        </div>
      )}
      {recordDialog === 'start' ? (
        <RecordStartDialog
          draft={recordDraft}
          onChange={setRecordDraft}
          onStart={() => { void startRecording(); }}
          onClose={() => setRecordDialog('closed')}
        />
      ) : recordDialog === 'review' ? (
        <RecordReviewDialog
          source={recordReview.source}
          outFile={recordDraft.outFile}
          error={recordReview.error}
          busy={recordReview.busy}
          onSave={() => { void saveRecording(); }}
          onCopy={() => { void navigator.clipboard.writeText(recordReview.source).then(() => dispatch({ type: 'toast', tone: 'success', text: 'Generated test copied.' })); }}
          onDiscard={() => { void discardRecording(); }}
        />
      ) : null}
    </AppShell>
  );
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function runFailureText(value: unknown): string {
  const detail = describe(value);
  if (/already|active|in progress|stopping|conflict/iu.test(detail)) {
    return 'Another tab already started a run. This view will follow it; use Stop in Runner.';
  }
  return `Could not start run: ${detail}`;
}

function commandForForm(command: readonly string[]): string {
  return command.map((part) => /[\s"'\\]/u.test(part) ? JSON.stringify(part) : part).join(' ');
}

function projectFile(root: string, file: string): string {
  if (file.startsWith('/')) return file;
  return `${root.replace(/\/$/u, '')}/${file.replace(/^\.\//u, '')}`;
}
