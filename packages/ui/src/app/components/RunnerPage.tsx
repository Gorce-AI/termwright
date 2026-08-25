import { Camera, ChevronDown, CircleStop, GripVertical, ListPlus, Maximize2, Minimize2, PanelLeftOpen, PanelRightOpen, Play, ScreenShare, SquareTerminal } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { nextSpeed } from '../../playback.js';
import type { AppAction } from '../domain/reducer.js';
import { currentRunCases, nodesForSelected, selectedCase, selectedSession } from '../domain/selectors.js';
import type { AppState, CompactWorkspace, ExecutionNode, SessionRecord } from '../domain/model.js';
import { highlightExecutionTarget, highlightSemanticNode, type TerminalHighlight } from '../domain/terminal-highlight.js';
import type { TraceStatePayload } from '../../trace-source.js';
import type { UiActionability } from '../../events.js';
import { usePreferences } from '../preferences.js';
import { ExecutionRail } from './ExecutionRail.js';
import { InspectorPanel } from './InspectorPanel.js';
import { ReplayControls } from './ReplayControls.js';
import { StatusBadge } from './StatusBadge.js';
import { TerminalStage } from './TerminalStage.js';
import { Tooltip } from './Tooltip.js';

interface RunnerPageProps {
  readonly state: AppState;
  readonly dispatch: (action: AppAction) => void;
  readonly onRun: (targets: readonly string[]) => void;
  readonly onStop: () => void;
  readonly onInput: (sessionId: string, data: string) => void;
  readonly onOpenReplay: (executionId: string) => void;
  readonly onSelectExecution: (executionId: string) => void;
  readonly onTraceStateAt: (timeMs: number) => Promise<TraceStatePayload>;
  readonly onInspectActionability?: (sessionId: string, nodeId: string) => Promise<readonly UiActionability[]>;
  readonly interactive: boolean;
  readonly recorder?: {
    readonly active: boolean;
    readonly busy: boolean;
    readonly onStop: () => void;
    readonly onStep: (title: string) => void;
    readonly onSnapshot: () => void;
    readonly onClickNode: (nodeId: string) => void;
    readonly onAssertNode: (nodeId: string) => void;
  };
}

export function RunnerPage({ state, dispatch, onRun, onStop, onInput, onOpenReplay, onSelectExecution, onTraceStateAt, onInspectActionability, recorder, interactive }: RunnerPageProps) {
  const { preferences, updatePreferences } = usePreferences();
  const runBusy = state.pendingRunTargets !== null || state.run.status === 'running' || state.run.status === 'stopping';
  const cases = currentRunCases(state);
  const selected = selectedCase(state);
  const session = selectedSession(state);
  const nodes = nodesForSelected(state);
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<TerminalHighlight | null>(null);
  const [pinnedTarget, setPinnedTarget] = useState<TerminalHighlight | null>(null);
  const [railWidth, setRailWidth] = useState(340);
  const [inspectorWidth, setInspectorWidth] = useState(310);
  const [evidenceMaximized, setEvidenceMaximized] = useState(false);
  const [stepTitle, setStepTitle] = useState('');
  const workspaceRef = useRef<HTMLDivElement>(null);
  const railDrag = useRef<ResizeGesture | null>(null);
  const inspectorDrag = useRef<ResizeGesture | null>(null);
  const replay = state.evidence.kind === 'replay' ? state.evidence.replay : null;
  const shownTimeMs = previewMs ?? replay?.timeMs ?? 0;
  const previousSelection = useRef(state.selectedExecutionId);
  const targetRequest = useRef(0);
  const previousRevision = useRef<number | null>(null);
  const timelineCollapsed = preferences.timelineCollapsed;
  const inspectorCollapsed = preferences.inspectorCollapsed;

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace === null) return;
    const resize = () => {
      const width = workspace.clientWidth;
      if (width <= 0) return;
      const nextInspector = clampPixels(preferences.inspectorShare * width, INSPECTOR_MIN, Math.min(INSPECTOR_MAX, width - EVIDENCE_MIN - SPLITTER_SIZE));
      const railMaximum = Math.min(RAIL_MAX, width - nextInspector - EVIDENCE_MIN - SPLITTER_SIZE * 2);
      setInspectorWidth(nextInspector);
      setRailWidth(clampPixels(preferences.railShare * width, RAIL_MIN, railMaximum));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [preferences.inspectorShare, preferences.railShare]);

  useEffect(() => {
    if (previousSelection.current === state.selectedExecutionId) return;
    previousSelection.current = state.selectedExecutionId;
    setPreviewMs(null);
    setPinnedNodeId(null);
    setHoveredTarget(null);
    setPinnedTarget(null);
    targetRequest.current += 1;
  }, [state.selectedExecutionId]);
  const terminal = useMemo(() => {
    if (replay !== null) return {
      identity: `replay:${replay.traceRef}`,
      mode: 'replay' as const,
      columns: replay.overview.columns,
      rows: replay.overview.rows,
      profile: replay.overview.terminalProfile ?? 'recorded default',
      liveChunks: [] as readonly string[],
      replayFrames: replay.frames.frames,
      replayTimeMs: shownTimeMs,
      writable: false,
    };
    if (session !== null) return {
      identity: `live:${session.runId}:${session.sessionId}`,
      mode: 'live' as const,
      columns: session.columns,
      rows: session.rows,
      profile: session.terminalProfile,
      liveChunks: session.output,
      replayFrames: [] as const,
      replayTimeMs: 0,
      writable: session.writable,
    };
    return {
      identity: 'empty',
      mode: 'empty' as const,
      columns: 80,
      rows: 24,
      profile: 'no profile',
      liveChunks: [] as const,
      replayFrames: [] as const,
      replayTimeMs: 0,
      writable: false,
    };
  }, [replay, session, shownTimeMs]);
  const inspectorSession = useMemo<SessionRecord | null>(() => replay === null
    ? session
    : {
        runId: state.evidence.kind === 'replay' ? state.evidence.runId : 'replay',
        sessionId: replay.overview.sessionId,
        columns: replay.traceState?.columns ?? replay.overview.columns,
        rows: replay.traceState?.rows ?? replay.overview.rows,
        terminalProfile: replay.overview.terminalProfile ?? 'recorded default',
        command: replay.overview.command,
        writable: false,
        output: [],
        // A replay inspector describes the selected moment. Showing records
        // from later in the archive would leak future evidence into the past.
        logs: replay.logs.records.filter((log) => log.t <= shownTimeMs),
        revision: replay.traceState?.revision ?? null,
        snapshot: replay.traceState?.snapshot ?? null,
      }, [replay, session, shownTimeMs, state.evidence]);
  const inspectorHidden = inspectorCollapsed;

  useEffect(() => {
    const revision = inspectorSession?.revision ?? null;
    if (previousRevision.current !== null && revision !== previousRevision.current) setPinnedTarget(null);
    previousRevision.current = revision;
  }, [inspectorSession?.revision]);
  useEffect(() => {
    const clearPinned = (event: KeyboardEvent | globalThis.PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof globalThis.PointerEvent && (event.target as Element | null)?.closest('[data-highlight-source], .tw-terminal-highlight') !== null) return;
      targetRequest.current += 1;
      setHoveredTarget(null);
      setPinnedTarget(null);
      setPinnedNodeId(null);
    };
    document.addEventListener('keydown', clearPinned);
    document.addEventListener('pointerdown', clearPinned, true);
    return () => {
      document.removeEventListener('keydown', clearPinned);
      document.removeEventListener('pointerdown', clearPinned, true);
    };
  }, []);

  const pinNode = (node: ExecutionNode) => {
    setPinnedNodeId(node.nodeId);
    setPreviewMs(null);
    if (replay !== null) dispatch({ type: 'replay-time', timeMs: node.startMs });
    void resolveCommandTarget(node, true);
  };
  const previewNode = (node: ExecutionNode | null) => {
    if (node === null) {
      targetRequest.current += 1;
      setHoveredTarget(null);
      if (replay !== null && !replay.playing) setPreviewMs(null);
      return;
    }
    if (replay !== null && replay.playing) return;
    if (replay !== null) setPreviewMs(node.startMs);
    void resolveCommandTarget(node, false);
  };
  const resolveCommandTarget = async (node: ExecutionNode, pinned: boolean) => {
    const request = ++targetRequest.current;
    let snapshot: SemanticSnapshot | null = session?.snapshot ?? null;
    if (replay !== null) {
      try {
        snapshot = (await onTraceStateAt(node.startMs)).snapshot;
      } catch {
        snapshot = null;
      }
    }
    if (request !== targetRequest.current) return;
    const target = highlightExecutionTarget(node, snapshot, pinned);
    if (pinned) setPinnedTarget(target);
    else setHoveredTarget(target);
  };
  const previewSemanticNode = (node: SemanticNode | null, snapshot: SemanticSnapshot | null) => {
    if (node === null || snapshot === null) {
      setHoveredTarget(null);
      return;
    }
    setHoveredTarget(highlightSemanticNode(node, snapshot, false));
  };
  const pinSemanticNode = (node: SemanticNode, snapshot: SemanticSnapshot) => {
    targetRequest.current += 1;
    setPinnedNodeId(null);
    setPinnedTarget(highlightSemanticNode(node, snapshot, true));
  };

  return (
    <div className="tw-runner-page">
      {state.run.diagnosticGaps === 0 ? null : (
        <div className="tw-diagnostic-gap" role="alert">
          Runner diagnostics incomplete: {state.run.diagnosticGaps} projected messages were dropped. The canonical run history remains authoritative.
        </div>
      )}
      {state.run.status !== 'finished' || state.run.summary === null ||
       (state.run.summary.verdict !== 'passed-with-skips' && state.run.summary.verdict !== 'skipped') ? null : (
        <div className="tw-run-skip-warning" role="status">
          {state.run.summary.verdict === 'skipped'
            ? 'All selected cases were skipped; this run is not certification evidence.'
            : `Run passed with skipped cases${state.run.summary.skipped === 0 ? '' : ` (${state.run.summary.skipped})`}; it is not plain-green certification.`}
        </div>
      )}
      <CompactTabs current={state.compactWorkspace} onSelect={(workspace) => {
        if (workspace === 'inspect') updatePreferences({ inspectorCollapsed: false });
        if (workspace === 'steps') updatePreferences({ timelineCollapsed: false });
        dispatch({ type: 'compact-workspace', workspace });
      }} />

      <div
        className="tw-workspace"
        data-compact-view={state.compactWorkspace}
        data-evidence-maximized={evidenceMaximized}
        data-timeline-collapsed={timelineCollapsed}
        data-inspector-collapsed={inspectorHidden}
        ref={workspaceRef}
        style={{
          '--tw-rail-width': `${railWidth}px`,
          '--tw-inspector-width': `${inspectorWidth}px`,
        } as CSSProperties}
      >
        {timelineCollapsed ? null : (
          <ExecutionRail
            cases={cases}
            allCaseCount={state.catalog.filter((test) => test.provider !== null).length}
            selectedExecutionId={state.selectedExecutionId}
            nodes={nodes}
            pinnedNodeId={pinnedNodeId}
            evidence={state.evidence}
            autoFollow={preferences.autoFollowCurrentAction}
            density={preferences.timelineDensity}
            canRun={interactive && state.canRun}
            connected={state.connected}
            runBusy={runBusy}
            runStatus={state.run.status}
            onRun={onRun}
            onStop={onStop}
            onCollapse={() => updatePreferences({ timelineCollapsed: true })}
            onSelectCase={onSelectExecution}
            onPreviewNode={previewNode}
            onPinNode={pinNode}
          />
        )}

        {timelineCollapsed || evidenceMaximized ? null : <div
          className="tw-workspace-splitter"
          role="separator"
          aria-label="Resize execution narrative and terminal"
          aria-orientation="vertical"
          aria-valuemin={RAIL_MIN}
          aria-valuemax={RAIL_MAX}
          aria-valuenow={Math.round(railWidth)}
          tabIndex={0}
          onPointerDown={(event) => beginResize(event, railDrag, railWidth, evidenceWidth(workspaceRef.current))}
          onPointerMove={(event) => resizeRail(event, railDrag, setRailWidth)}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            const settledWidth = railDrag.current?.lastWidth ?? railWidth;
            railDrag.current = null;
            rememberPaneShare(workspaceRef.current, settledWidth, (railShare) => updatePreferences({ railShare }));
          }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home'
              ? RAIL_MIN
              : event.key === 'End'
                ? Math.min(RAIL_MAX, railWidth + evidenceWidth(workspaceRef.current) - EVIDENCE_MIN)
                : clampPixels(railWidth + (event.key === 'ArrowRight' ? 10 : -10), RAIL_MIN, Math.min(RAIL_MAX, railWidth + evidenceWidth(workspaceRef.current) - EVIDENCE_MIN));
            setRailWidth(next);
            rememberPaneShare(workspaceRef.current, next, (railShare) => updatePreferences({ railShare }));
          }}
        >
          <GripVertical aria-hidden="true" size={17} />
        </div>}

        <section className="tw-evidence" aria-label="Terminal evidence">
          <div className="tw-evidence-heading">
            <div>
              <span className="tw-eyebrow">{evidenceLabel(state)}</span>
              <h2>{selected?.title ?? 'No case selected'}</h2>
            </div>
            <div className="tw-selected-outcome">
              {timelineCollapsed ? <button type="button" className="tw-evidence-expand" aria-label="Expand execution timeline" onClick={() => updatePreferences({ timelineCollapsed: false })}><PanelLeftOpen aria-hidden="true" size={14} /> Steps</button> : null}
              {inspectorHidden ? <Tooltip label="Expand inspector"><button type="button" className="tw-evidence-expand" aria-label="Expand inspector" onClick={() => updatePreferences({ inspectorCollapsed: false })}><PanelRightOpen aria-hidden="true" size={14} /> Inspect</button></Tooltip> : null}
              {selected === null ? null : <>
                <StatusBadge status={selected.status} />
                {selected.traceRef !== undefined && replay === null && state.evidence.kind !== 'replay-loading' ? <button type="button" className="tw-evidence-expand tw-replay-button" onClick={() => onOpenReplay(selected.executionId)}><Play aria-hidden="true" size={14} /> Replay</button> : null}
                {selected.sessionIds.length < 2 ? null : (
                  <label className="tw-session-switcher"><span className="sr-only">Terminal session</span><select aria-label="Terminal session" value={state.selectedSessionId ?? ''} onChange={(event) => dispatch({ type: 'select-session', sessionId: event.currentTarget.value })}>
                    {selected.sessionIds.map((sessionId, index) => {
                      const key = `${selected.runId ?? 'run:unknown'}:${sessionId}`;
                      return <option key={sessionId} value={key}>{sessionLabel(state.sessions[key], index)}</option>;
                    })}
                  </select></label>
                )}
                {selected.source.line === undefined ? null : <span>line {selected.source.line}</span>}
                <button
                  type="button"
                  className="tw-evidence-expand"
                  aria-pressed={evidenceMaximized}
                  onClick={() => setEvidenceMaximized((value) => !value)}
                >
                  {evidenceMaximized ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
                  {evidenceMaximized ? 'Restore' : 'Maximize'}
                </button>
              </>}
            </div>
          </div>
          <TerminalStage
            {...terminal}
            highlight={hoveredTarget ?? pinnedTarget}
            {...(session === null ? {} : { onInput: (data: string) => onInput(session.sessionId, data) })}
          />
          {replay === null || (replay.overview.crash === null && replay.overview.lostLogRecords === 0) ? null : (
            <div className="tw-replay-notices">
              {replay.overview.crash === null ? null : <button type="button" className="tw-crash-reason" onClick={() => dispatch({ type: 'replay-time', timeMs: replay.overview.crash?.castOffset ?? 0 })}>
                <span>Recorded process crashed</span><strong>{replay.overview.crash.cause}</strong><small>Jump to {formatReplayTime(replay.overview.crash.castOffset)}</small>
              </button>}
              {replay.overview.lostLogRecords === 0 ? null : <div className="tw-lost-logs"><span>Incomplete logs</span><strong>{replay.overview.lostLogRecords} application log {replay.overview.lostLogRecords === 1 ? 'record was' : 'records were'} dropped while recording</strong></div>}
            </div>
          )}
          {recorder?.active === true ? (
            <div className="tw-recorder-strip" aria-label="Recorder authoring controls">
              <span className="tw-rec-badge"><i /> REC</span>
              <label><span className="sr-only">Step title</span><input value={stepTitle} onChange={(event) => setStepTitle(event.currentTarget.value)} placeholder="Name the next step" /></label>
              <button type="button" disabled={stepTitle.trim() === ''} onClick={() => { recorder.onStep(stepTitle.trim()); setStepTitle(''); }}><ListPlus aria-hidden="true" size={14} /> Add step</button>
              <button type="button" onClick={recorder.onSnapshot}><Camera aria-hidden="true" size={14} /> Assert snapshot</button>
              <button type="button" className="tw-record-stop" disabled={recorder.busy} onClick={recorder.onStop}><CircleStop aria-hidden="true" size={14} /> Stop recording</button>
            </div>
          ) : replay === null ? (
            <div className="tw-live-strip">
              <span className="tw-pulse-dot" />
              <strong>{state.run.status === 'running' ? 'Following the selected terminal' : 'Live surface ready'}</strong>
              <span>Grid dimensions remain immutable while the browser scales the machine.</span>
            </div>
          ) : (
            <ReplayControls
              replay={{ ...replay, timeMs: shownTimeMs }}
              onPlaying={(playing) => dispatch({ type: 'replay-playing', playing })}
              onSeek={(timeMs) => { setHoveredTarget(null); setPinnedTarget(null); setPinnedNodeId(null); dispatch({ type: 'replay-time', timeMs }); }}
              onSpeed={() => dispatch({ type: 'replay-speed', speed: nextSpeed(replay.speed) })}
            />
          )}
        </section>

        {inspectorHidden || evidenceMaximized ? null : <div
          className="tw-inspector-splitter"
          role="separator"
          aria-label="Resize terminal and inspector"
          aria-orientation="vertical"
          aria-valuemin={INSPECTOR_MIN}
          aria-valuemax={INSPECTOR_MAX}
          aria-valuenow={Math.round(inspectorWidth)}
          tabIndex={0}
          onPointerDown={(event) => beginResize(event, inspectorDrag, inspectorWidth, evidenceWidth(workspaceRef.current))}
          onPointerMove={(event) => resizeInspector(event, inspectorDrag, setInspectorWidth)}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            const settledWidth = inspectorDrag.current?.lastWidth ?? inspectorWidth;
            inspectorDrag.current = null;
            rememberPaneShare(workspaceRef.current, settledWidth, (inspectorShare) => updatePreferences({ inspectorShare }));
          }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home'
              ? INSPECTOR_MIN
              : event.key === 'End'
                ? Math.min(INSPECTOR_MAX, inspectorWidth + evidenceWidth(workspaceRef.current) - EVIDENCE_MIN)
                : clampPixels(inspectorWidth + (event.key === 'ArrowLeft' ? 10 : -10), INSPECTOR_MIN, Math.min(INSPECTOR_MAX, inspectorWidth + evidenceWidth(workspaceRef.current) - EVIDENCE_MIN));
            setInspectorWidth(next);
            rememberPaneShare(workspaceRef.current, next, (inspectorShare) => updatePreferences({ inspectorShare }));
          }}
        >
          <GripVertical aria-hidden="true" size={17} />
        </div>}

        {inspectorHidden ? null : <InspectorPanel
          session={inspectorSession}
          onCollapsed={(collapsed) => updatePreferences({ inspectorCollapsed: collapsed })}
          onPreviewNode={previewSemanticNode}
          onPinNode={pinSemanticNode}
          {...(replay === null && onInspectActionability !== undefined ? { onInspectActionability } : {})}
          {...(recorder?.active === true ? {
            recorder: { onClickNode: recorder.onClickNode, onAssertNode: recorder.onAssertNode },
          } : {})}
        />}
      </div>
    </div>
  );
}

const RAIL_MIN = 280;
const RAIL_MAX = 420;
const INSPECTOR_MIN = 280;
const INSPECTOR_MAX = 420;
const EVIDENCE_MIN = 480;
const SPLITTER_SIZE = 8;

interface ResizeGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly paneWidth: number;
  readonly evidenceWidth: number;
  lastWidth: number;
}

function beginResize(
  event: ReactPointerEvent<HTMLDivElement>,
  gesture: { current: ResizeGesture | null },
  paneWidth: number,
  currentEvidenceWidth: number,
): void {
  event.currentTarget.setPointerCapture(event.pointerId);
  gesture.current = { pointerId: event.pointerId, startX: event.clientX, paneWidth, evidenceWidth: currentEvidenceWidth, lastWidth: paneWidth };
}

function resizeRail(
  event: ReactPointerEvent<HTMLDivElement>,
  gestureRef: { current: ResizeGesture | null },
  update: (value: number) => void,
): void {
  const gesture = gestureRef.current;
  if (!event.currentTarget.hasPointerCapture(event.pointerId) || gesture === null || gesture.pointerId !== event.pointerId) return;
  const delta = event.clientX - gesture.startX;
  const maximum = Math.min(RAIL_MAX, gesture.paneWidth + gesture.evidenceWidth - EVIDENCE_MIN);
  gesture.lastWidth = clampPixels(gesture.paneWidth + delta, RAIL_MIN, maximum);
  update(gesture.lastWidth);
}

function resizeInspector(
  event: ReactPointerEvent<HTMLDivElement>,
  gestureRef: { current: ResizeGesture | null },
  update: (value: number) => void,
): void {
  const gesture = gestureRef.current;
  if (!event.currentTarget.hasPointerCapture(event.pointerId) || gesture === null || gesture.pointerId !== event.pointerId) return;
  const delta = event.clientX - gesture.startX;
  const maximum = Math.min(INSPECTOR_MAX, gesture.paneWidth + gesture.evidenceWidth - EVIDENCE_MIN);
  gesture.lastWidth = clampPixels(gesture.paneWidth - delta, INSPECTOR_MIN, maximum);
  update(gesture.lastWidth);
}

function evidenceWidth(workspace: HTMLDivElement | null): number {
  return workspace?.querySelector<HTMLElement>('.tw-evidence')?.getBoundingClientRect().width ?? EVIDENCE_MIN;
}

function rememberPaneShare(workspace: HTMLDivElement | null, pixels: number, remember: (share: number) => void): void {
  const width = workspace?.clientWidth ?? 0;
  if (width > 0) remember(pixels / width);
}

function clampPixels(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
}

function CompactTabs({ current, onSelect }: { readonly current: CompactWorkspace; readonly onSelect: (value: CompactWorkspace) => void }) {
  const tabs: readonly { readonly id: CompactWorkspace; readonly label: string; readonly icon: typeof ChevronDown }[] = [
    { id: 'steps', label: 'Steps', icon: SquareTerminal },
    { id: 'screen', label: 'Screen', icon: ScreenShare },
    { id: 'inspect', label: 'Inspect', icon: ChevronDown },
  ];
  return (
    <div className="tw-compact-tabs" role="tablist" aria-label="Runner workspace">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="tab" aria-selected={id === current} onClick={() => onSelect(id)}>
          <Icon aria-hidden="true" size={15} /> {label}
        </button>
      ))}
    </div>
  );
}

function evidenceLabel(state: AppState): string {
  if (state.evidence.kind === 'replay') return 'pinned time travel';
  if (state.evidence.kind === 'replay-loading') return 'opening recording';
  if (state.evidence.kind === 'replay-error') return 'recording unavailable';
  if (state.evidence.kind === 'live') return 'live evidence';
  return 'evidence';
}

export function sessionLabel(session: SessionRecord | undefined, index: number): string {
  if (session === undefined) return `Terminal ${index + 1}`;
  const framework = session.contract?.framework?.name;
  const identity = framework === undefined ? 'Terminal' : framework;
  return `${identity} · ${session.terminalProfile} · ${session.columns}×${session.rows} · #${index + 1}`;
}

function formatReplayTime(timeMs: number): string {
  return `${(timeMs / 1_000).toFixed(1)}s`;
}
import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
