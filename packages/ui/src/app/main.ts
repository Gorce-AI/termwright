/**
 * The browser app: three panes over one connection.
 *
 * State lives in this module and is rendered by lit-html; the terminal is the
 * one piece with its own imperative object, because xterm.js owns its DOM.
 * Every message that arrives updates the state and schedules one render, so the
 * panes can never disagree about what the run is doing.
 */

import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { html, render } from 'lit-html';
import type { SemanticSnapshot } from '@termwright/protocol';
import { fromBase64, type ServerMessage } from '../events.js';
import type { GeneratedSelector } from '../selector.js';
import type { TraceOverview } from '../trace-source.js';
import { RunnerClient, type ServerState } from './client.js';
import { renderInspector, type InspectorHandlers } from './inspector.js';
import {
  applyAriaAttributes,
  renderSemanticView,
  type SemanticViewHandlers,
} from './semantic-view.js';
import { isMarked, type AppLogView, type LogLevel } from '../app-log.js';
import { currentCommand, parseRef, stepCommand, type CommandRow } from '../commands.js';
import {
  advance,
  framesUpTo,
  initialPlayback,
  nextSpeed,
  revisionAt,
  type PlaybackFrame,
  type PlaybackState,
} from '../playback.js';
import { renderCommandLog, type CommandLogHandlers } from './command-log.js';
import {
  renderLogPanel,
  visibleLogs,
  type LevelFilter,
  type LogPanelHandlers,
  type LogPanelModel,
} from './log-panel.js';
import { TerminalPane, type Highlight } from './terminal-pane.js';
import { childrenOf, nextMarker, nodeAt, rootsOf } from '../view-model.js';
import { navigateTree, type TreeRow } from '../tree-nav.js';
import { renderTimeline, type TimelineHandlers } from './timeline.js';
import type { TestRow } from '../test-model.js';
import { describeCounts } from '../test-model.js';

/** A test row plus the steps reported for it. */
interface MutableTest {
  id: string;
  title: string;
  file?: string;
  status: TestRow['status'];
  startedAt?: number;
  durationMs?: number;
  flaky?: boolean;
  error?: string;
  traceRef?: string;
  sessionId?: string;
  steps: MutableStep[];
}

interface MutableStep {
  stepId: string;
  title: string;
  status: 'running' | 'passed' | 'failed';
  startedAt?: number | undefined;
  endedAt?: number | undefined;
}

interface SessionView {
  snapshot: SemanticSnapshot | null;
  revision: number | null;
}

const client = new RunnerClient();
const terminalHost = document.querySelector<HTMLElement>('#terminal');
const inspectorHost = document.querySelector<HTMLElement>('#inspector');
const timelineHost = document.querySelector<HTMLElement>('#timeline');
if (terminalHost === null || inspectorHost === null || timelineHost === null) {
  throw new Error('app shell is missing its panes');
}
const pane = new TerminalPane(terminalHost);

const state = {
  mode: 'live' as 'live' | 'post-mortem' | 'record',
  connected: false,
  sessions: new Map<string, SessionView>(),
  activeSessionId: null as string | null,
  recordSessionId: null as string | null,
  tests: [] as MutableTest[],
  testQuery: '',
  selectedTestId: null as string | null,
  now: Date.now(),
  trace: null as TraceOverview | null,
  timeMs: 0,
  /**
   * The moment that was asked for, before `stateAt` clamped it to the last
   * recorded event. The terminal shows the clamped state — that is the last
   * screen that existed — but the log panel cuts at what you asked for, so
   * jumping to a log mark shows the line you jumped to rather than stopping
   * just short of it.
   */
  requestedMs: 0,
  picking: false,
  selectedId: null as string | null,
  hoveredId: null as string | null,
  status: null as string | null,
  summary: null as string | null,
  rightTab: 'tree' as 'tree' | 'semantic' | 'logs' | 'commands',
  collapsed: new Set<string>(),
  logs: [] as AppLogView[],
  logFilter: 'all' as LevelFilter,
  logAutoscroll: true,
  logsAvailable: false,
  logsTruncated: false,
  /** Older entries exist before the window the page holds. */
  logsHasMoreBefore: false,
  logsLoadingOlder: false,
  logLevels: {} as Readonly<Partial<Record<LogLevel, number>>>,
  commands: [] as CommandRow[],
  commandsIncomplete: false,
  commandsError: null as string | null,
  selectedCommandId: null as string | null,
  frames: [] as PlaybackFrame[],
  playback: initialPlayback(),
  /** Revision boundaries, so playback knows when the tree on screen went stale. */
  revisions: [] as { t: number; revision: number }[],
  shownRevision: null as number | null,
};

/** Cap on live log rows held in the page. The archive keeps everything. */
const MAX_LIVE_LOGS = 5_000;

let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    draw();
  });
}

function active(): SessionView | undefined {
  return state.activeSessionId === null ? undefined : state.sessions.get(state.activeSessionId);
}

function draw(): void {
  const view = active();
  const snapshot = view?.snapshot ?? null;

  const logModel = logPanelModel();
  render(
    html`
      <nav class="tabs">
        <button
          class=${state.rightTab === 'tree' ? 'active' : ''}
          data-testid="tab-tree"
          @click=${() => selectTab('tree')}
        >
          Tree
        </button>
        <button
          class=${state.rightTab === 'semantic' ? 'active' : ''}
          data-testid="tab-semantic"
          title="The application rendered as accessible HTML"
          @click=${() => selectTab('semantic')}
        >
          Semantic view
        </button>
        <button
          class=${state.rightTab === 'logs' ? 'active' : ''}
          data-testid="tab-logs"
          @click=${() => selectTab('logs')}
        >
          Logs${state.logs.length === 0 ? '' : ` (${visibleLogs(logModel).length})`}
        </button>
        <button
          class=${state.rightTab === 'commands' ? 'active' : ''}
          data-testid="tab-commands"
          @click=${() => selectTab('commands')}
        >
          Commands${state.commands.length === 0 ? '' : ` (${state.commands.length})`}
        </button>
      </nav>
      <div class="tab-body">
        ${state.rightTab === 'semantic'
          ? renderSemanticView({ snapshot, selectedId: state.selectedId }, semanticViewHandlers)
          : state.rightTab === 'commands'
          ? renderCommandLog(
              {
                rows: state.commands,
                currentIndex: currentCommand(state.commands, state.timeMs, state.selectedCommandId),
                selectedId: state.selectedCommandId,
                available: state.mode === 'post-mortem' || state.commands.length > 0,
                incomplete: state.commandsIncomplete,
                ...(state.commandsError === null ? {} : { error: state.commandsError }),
              },
              commandHandlers,
            )
          : state.rightTab === 'tree'
          ? renderInspector(
              {
                snapshot,
                collapsed: state.collapsed,
                revision: view?.revision ?? null,
                selectedId: state.selectedId,
                hoveredId: state.hoveredId,
                picking: state.picking,
                recording: state.mode === 'record',
                variable: 'app',
                status: state.status,
              },
              inspectorHandlers,
            )
          : renderLogPanel(logModel, logHandlers)}
      </div>
    `,
    inspectorHost as HTMLElement,
  );
  if (state.rightTab === 'semantic') {
    applyAriaAttributes(inspectorHost as HTMLElement, snapshot);
  }
  if (state.rightTab === 'logs' && state.logAutoscroll) followLogs();
  if (state.rightTab === 'commands') revealCurrentCommand();

  render(
    renderTimeline(
      {
        mode: state.mode,
        tests: state.tests,
        trace: state.trace,
        timeMs: state.timeMs,
        connected: state.connected,
        summary: state.summary,
        logMarks: markedLogs(),
        playing: state.playback.playing,
        speed: state.playback.speed,
        testList: {
          tests: state.tests,
          query: state.testQuery,
          selectedId: state.selectedTestId,
          // A replay is a recording: there is nothing to run again.
          canRerun: state.mode !== 'post-mortem',
          now: state.now,
          steps: selectedTest()?.steps ?? [],
        },
      },
      timelineHandlers,
    ),
    timelineHost as HTMLElement,
  );

  const highlights: Highlight[] = [];
  if (snapshot !== null) {
    for (const [id, kind] of [
      [state.hoveredId, 'hover'],
      [state.selectedId, 'selected'],
    ] as const) {
      if (id === null) continue;
      const node = snapshot.nodes.find((candidate) => candidate.id === id);
      if (node?.bounds === undefined) continue;
      highlights.push({
        rect: node.bounds,
        label: node.name === '' ? node.role : `${node.role} "${node.name}"`,
        kind,
      });
    }
  }
  pane.setHighlights(highlights);
}

/** The model the log pane renders from. */
function logPanelModel(): LogPanelModel {
  return {
    logs: state.logs,
    filter: state.logFilter,
    autoscroll: state.logAutoscroll,
    available: state.logsAvailable,
    truncated: state.logsTruncated || state.logsHasMoreBefore,
    // Replays get the writer's counts (they cover the whole recording, even the
    // part evicted); a live run has no such summary, so count what arrived.
    levels: state.trace === null ? countLevels(state.logs) : state.logLevels,
    // Replaying: the log pane shows what had been logged by the moment the
    // terminal is showing, and nothing that had not happened yet.
    upToMs: state.trace === null ? null : Math.max(state.timeMs, state.requestedMs),
  };
}

/**
 * Warn/error lines, for the timeline strip.
 *
 * Deliberately *not* clipped to the scrub position: the strip is the map of the
 * whole recording, and "jump to the error" is what you want before you have
 * scrubbed anywhere near it. The panel is the view that follows the clock.
 */
function markedLogs(): AppLogView[] {
  return state.logs.filter(isMarked);
}

function countLevels(logs: readonly AppLogView[]): Partial<Record<LogLevel, number>> {
  const counts: Partial<Record<LogLevel, number>> = {};
  for (const log of logs) {
    if (log.level === null) continue;
    counts[log.level] = (counts[log.level] ?? 0) + 1;
  }
  return counts;
}

function selectTab(tab: 'tree' | 'semantic' | 'logs' | 'commands'): void {
  state.rightTab = tab;
  schedule();
}

/** Pins the log list to its newest row. */
function followLogs(): void {
  const list = document.querySelector<HTMLElement>('[data-testid="logs"]');
  if (list !== null) list.scrollTop = list.scrollHeight;
}

const logHandlers: LogPanelHandlers = {
  setFilter(filter) {
    state.logFilter = filter;
    schedule();
  },
  toggleAutoscroll() {
    state.logAutoscroll = !state.logAutoscroll;
    schedule();
  },
  seek(timeMs) {
    if (state.trace === null) return; // live: there is nothing to seek
    void seek(timeMs);
  },
};

/**
 * Refetches the log window when the replay moves outside the one held.
 *
 * The panel shows entries up to the current moment, so a scrub to the end of a
 * long recording has to fetch the entries near the end — otherwise the window
 * loaded at open (the oldest ones) stays on screen and the panel quietly lies
 * about what had been logged by then.
 */
function syncLogWindow(timeMs: number): void {
  if (state.trace === null || state.logsLoadingOlder) return;
  const first = state.logs[0]?.t;
  const last = state.logs.at(-1)?.t;
  const covered =
    first !== undefined && last !== undefined && timeMs >= first && timeMs <= last;
  if (covered) return;
  state.logsLoadingOlder = true;
  void client
    .traceLogs({ before: timeMs + 1 })
    .then((window) => {
      state.logs = [...window.records];
      state.logsHasMoreBefore = window.hasMoreBefore;
      schedule();
    })
    .catch(() => undefined)
    .finally(() => {
      state.logsLoadingOlder = false;
    });
}

/**
 * Fetches the window of log entries before the oldest one held, and prepends it.
 *
 * The page keeps a window rather than the whole log: a recording of a chatty
 * program can hold far more lines than a browser should carry, and the ones you
 * are not looking at cost the same as the ones you are.
 */
async function loadOlderLogs(): Promise<void> {
  if (state.trace === null || state.logsLoadingOlder || !state.logsHasMoreBefore) return;
  const oldest = state.logs[0]?.t;
  if (oldest === undefined) return;
  state.logsLoadingOlder = true;
  try {
    const older = await client.traceLogs({ before: oldest });
    state.logs = [...older.records, ...state.logs];
    state.logsHasMoreBefore = older.hasMoreBefore;
    schedule();
  } catch {
    // The window we have is still the window we show.
  } finally {
    state.logsLoadingOlder = false;
  }
}

// Two things ride on scrolling the log list: scrolling up says "stop
// following", and reaching the top asks for the entries before it.
inspectorHost.addEventListener(
  'scroll',
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches('[data-testid="logs"]')) return;
    const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 4;
    if (state.logAutoscroll !== atBottom) {
      state.logAutoscroll = atBottom;
      schedule();
    }
    if (target.scrollTop < 24) void loadOlderLogs();
  },
  true,
);

/** Nodes in display order, honouring collapsed subtrees — what arrows walk. */
function visibleTreeNodes(): TreeRow[] {
  const snapshot = active()?.snapshot;
  if (snapshot === undefined || snapshot === null) return [];
  const children = childrenOf(snapshot);
  const out: TreeRow[] = [];
  const walk = (node: { id: string; parentId?: string }): void => {
    const kids = children.get(node.id) ?? [];
    out.push({
      id: node.id,
      hasChildren: kids.length > 0,
      ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
    });
    if (state.collapsed.has(node.id)) return;
    for (const kid of kids) walk(kid);
  };
  for (const root of rootsOf(snapshot)) walk(root);
  return out;
}

/** Moves DOM focus to the selected row, so the tree behaves like a tree. */
function focusSelectedTreeItem(): void {
  if (state.selectedId === null) return;
  const row = document.querySelector<HTMLElement>(
    `.tree [data-node-id="${state.selectedId.replace(/["\\]/g, '\\$&')}"]`,
  );
  row?.focus();
}

const semanticViewHandlers: SemanticViewHandlers = {
  select(nodeId) {
    state.selectedId = nodeId;
    schedule();
  },
  hover(nodeId) {
    state.hoveredId = nodeId;
    schedule();
  },
};

const inspectorHandlers: InspectorHandlers = {
  select(nodeId) {
    state.selectedId = nodeId;
    schedule();
  },
  toggle(nodeId) {
    if (state.collapsed.has(nodeId)) state.collapsed.delete(nodeId);
    else state.collapsed.add(nodeId);
    schedule();
  },
  navigate(key) {
    const next = navigateTree(visibleTreeNodes(), { selectedId: state.selectedId, collapsed: state.collapsed }, key);
    state.selectedId = next.selectedId;
    state.collapsed = new Set(next.collapsed);
    schedule();
    // Selection and focus move together, which is what makes this a tree
    // rather than a list of divs that says it is one.
    requestAnimationFrame(focusSelectedTreeItem);
  },
  focusTerminal() {
    pane.focus();
  },
  hover(nodeId) {
    state.hoveredId = nodeId;
    schedule();
  },
  togglePick() {
    state.picking = !state.picking;
    pane.setPicking(state.picking);
    const sessionId = state.activeSessionId;
    if (sessionId !== null) client.send({ v: 1, type: 'pick', sessionId, enabled: state.picking });
    schedule();
  },
  copySelector(selector: GeneratedSelector) {
    void navigator.clipboard?.writeText(selector.expression);
    note(`copied ${selector.expression}`);
  },
  recordClick(nodeId) {
    void client
      .recordAction('click', nodeId)
      .then((result) => note(`recorded click on ${result.selector.expression}`))
      .catch((error: unknown) => note(describe(error)));
  },
  recordAssertVisible(nodeId) {
    void client
      .recordAction('assert-visible', nodeId)
      .then(() => note('recorded visibility assertion'))
      .catch((error: unknown) => note(describe(error)));
  },
  recordAssertSnapshot() {
    void client
      .recordAssert('snapshot')
      .then(() => note('recorded semantic snapshot assertion'))
      .catch((error: unknown) => note(describe(error)));
  },
  recordStep() {
    const title = prompt('Step title');
    if (title === null || title === '') return;
    void client
      .recordStep(title)
      .then(() => note(`step: ${title}`))
      .catch((error: unknown) => note(describe(error)));
  },
  save() {
    const file = prompt('Write the generated test to', 'recorded.test.ts');
    if (file === null || file === '') return;
    void client
      .save(file)
      .then((result) => note(`wrote ${result.path}`))
      .catch((error: unknown) => note(describe(error)));
  },
};

/**
 * Applies the recording up to `timeMs` by writing frames into the terminal.
 *
 * Forward moves write only what is new, which is what makes playback smooth;
 * moving backwards resets the emulator and replays from the start, because a
 * terminal cannot un-write.
 */
function applyFrames(timeMs: number): void {
  const { frames, cursor, rewind } = framesUpTo(state.frames, state.playback, timeMs);
  if (rewind) pane.reset();
  for (const frame of frames) {
    if (frame.kind === 'resize') {
      if (frame.columns !== undefined && frame.rows !== undefined) {
        pane.resize(frame.columns, frame.rows);
      }
    } else if (frame.dataB64 !== undefined) {
      pane.write(fromBase64(frame.dataB64));
    }
  }
  state.playback = { ...state.playback, cursor, timeMs };
  state.timeMs = timeMs;
  state.requestedMs = timeMs;
}

/**
 * Keeps the semantic tree in step with playback: when the position crosses a
 * revision boundary, the snapshot for that moment is fetched once and cached by
 * revision. Playback never blocks on it — the terminal keeps running while the
 * tree catches up.
 */
function syncTree(timeMs: number): void {
  const revision = revisionAt(state.revisions, timeMs);
  if (revision === null || revision === state.shownRevision) return;
  state.shownRevision = revision;
  const sessionId = state.activeSessionId ?? state.trace?.sessionId ?? 'trace';
  void client
    .traceState(timeMs)
    .then((traceState) => {
      if (state.shownRevision !== revision) return; // playback moved on
      state.sessions.set(sessionId, { snapshot: traceState.snapshot, revision: traceState.revision });
      schedule();
    })
    .catch(() => undefined);
}

let lastFrameAt = 0;
function playbackTick(now: number): void {
  requestAnimationFrame(playbackTick);
  const elapsed = lastFrameAt === 0 ? 0 : now - lastFrameAt;
  lastFrameAt = now;
  if (!state.playback.playing) return;
  const duration = Math.max(state.trace?.durationMs ?? 0, 1);
  const next = advance(state.playback, elapsed, duration);
  state.playback = next;
  applyFrames(next.timeMs);
  syncTree(next.timeMs);
  syncLogWindow(next.timeMs);
  schedule();
}
requestAnimationFrame(playbackTick);

/** Scrolls the current command into view without yanking the list around. */
function revealCurrentCommand(): void {
  const index = currentCommand(state.commands, state.timeMs);
  const row = state.commands[index];
  if (row === undefined) return;
  const element = document.querySelector<HTMLElement>(`[data-command-id="${row.id}"]`);
  element?.scrollIntoView({ block: 'nearest' });
}

/** Highlights the node an action targeted, from the ref it resolved to. */
function highlightRef(ref: string | undefined): void {
  if (ref === undefined) return;
  const parsed = parseRef(ref);
  if (parsed === null) return;
  const snapshot = active()?.snapshot;
  if (snapshot?.nodes.some((node) => node.id === parsed.nodeId) === true) {
    state.selectedId = parsed.nodeId;
  }
}

const commandHandlers: CommandLogHandlers = {
  select(row) {
    state.selectedCommandId = row.id;
    if (state.trace !== null) {
      state.playback = { ...state.playback, playing: false };
      applyFrames(row.t);
      syncTree(row.t);
      // The tree for that moment may still be in flight; highlight what we can
      // now, and the fetch above re-renders with the rest.
      highlightRef(row.ref);
    }
    schedule();
  },
};

const timelineHandlers: TimelineHandlers = {
  seek(timeMs) {
    void seek(timeMs);
  },
  select(testId) {
    state.selectedTestId = state.selectedTestId === testId ? null : testId;
    // Focusing a test focuses its session too, when the producer told us which
    // one it drives; otherwise the terminal keeps showing what it was showing.
    const sessionId = selectedTest()?.sessionId;
    if (sessionId !== undefined && state.sessions.has(sessionId)) {
      state.activeSessionId = sessionId;
    }
    schedule();
  },
  setQuery(query) {
    state.testQuery = query;
    schedule();
  },
  jump(direction) {
    // Arrows walk actions when there are any; otherwise they fall back to the
    // timeline's own markers (steps and revisions).
    const command = stepCommand(state.commands, state.timeMs, direction);
    if (command !== undefined) {
      commandHandlers.select(command);
      return;
    }
    const target = nextMarker(state.trace?.markers ?? [], state.timeMs, direction);
    if (target !== undefined) void seek(target);
  },
  togglePlay() {
    if (state.trace === null) return;
    const atEnd = state.timeMs >= (state.trace.durationMs ?? 0) - 1;
    if (atEnd && !state.playback.playing) applyFrames(0);
    state.playback = { ...state.playback, playing: !state.playback.playing };
    schedule();
  },
  cycleSpeed() {
    state.playback = { ...state.playback, speed: nextSpeed(state.playback.speed) };
    schedule();
  },
  rerun(testId) {
    client.send({ v: 1, type: 'rerun', ...(testId === undefined ? {} : { testIds: [testId] }) });
  },
  stop() {
    client.send({ v: 1, type: 'stop' });
  },
};

/** Time travel: replay the recording up to `timeMs` into a fresh screen. */
async function seek(timeMs: number): Promise<void> {
  if (state.trace === null) return;
  state.timeMs = timeMs;
  state.requestedMs = timeMs;
  schedule();
  // With frames loaded, seeking is the same operation playback performs; only
  // an archive too large to send whole falls back to the server's prefix.
  if (state.frames.length > 0) {
    applyFrames(timeMs);
    syncTree(timeMs);
    syncLogWindow(timeMs);
    schedule();
    return;
  }
  const traceState = await client.traceState(timeMs);
  pane.reset();
  pane.resize(traceState.columns, traceState.rows);
  pane.write(fromBase64(traceState.castPrefixB64));
  const sessionId = state.activeSessionId ?? state.trace.sessionId;
  state.activeSessionId = sessionId;
  state.sessions.set(sessionId, { snapshot: traceState.snapshot, revision: traceState.revision });
  state.timeMs = traceState.timeMs;
  if (state.selectedId !== null && traceState.snapshot?.nodes.every((n) => n.id !== state.selectedId) === true) {
    state.selectedId = null;
  }
  schedule();
}

/**
 * Says so when a recording was made with a profile this pane cannot reproduce.
 *
 * The pane measures with Unicode 11, which covers the `default` and `kitty`
 * profiles. `iterm2-ambiguous-wide` counts East Asian Ambiguous characters as
 * two columns, and the stock browser addon has no switch for that — so a box
 * drawn with ambiguous glyphs would line up here and not in the session. Saying
 * it out loud beats letting someone measure against a lie.
 */
function warnAboutProfile(profile: string | null): void {
  if (profile === null || profile === 'default' || profile === 'kitty') return;
  note(`recorded with the "${profile}" terminal profile; this view measures with Unicode 11 widths`);
}

function note(message: string): void {
  state.status = message;
  schedule();
  setTimeout(() => {
    if (state.status === message) {
      state.status = null;
      schedule();
    }
  }, 4_000);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function testFor(id: string, title = id): MutableTest {
  const found = state.tests.find((test) => test.id === id);
  if (found !== undefined) return found;
  const created: MutableTest = { id, title, status: 'running', steps: [] };
  state.tests.push(created);
  return created;
}

function selectedTest(): MutableTest | undefined {
  return state.tests.find((test) => test.id === state.selectedTestId);
}

/**
 * Redraws while tests are running, so their elapsed time ticks. Stops as soon
 * as nothing is running — a UI that repaints forever keeps a laptop awake.
 */
let ticking: ReturnType<typeof setInterval> | undefined;
function retick(): void {
  const running = state.tests.some((test) => test.status === 'running');
  if (running && ticking === undefined) {
    ticking = setInterval(() => {
      state.now = Date.now();
      schedule();
    }, 500);
  } else if (!running && ticking !== undefined) {
    clearInterval(ticking);
    ticking = undefined;
  }
}

function handle(message: ServerMessage): void {
  switch (message.type) {
    case 'run-start':
      state.mode = message.mode;
      state.tests = [];
      state.selectedTestId = null;
      if (message.mode !== 'post-mortem') {
        state.commands = [];
        state.selectedCommandId = null;
      }
      state.summary = null;
      // A replayed run's logs come from the archive over HTTP, and the socket's
      // backlog can arrive after that fetch resolves — clearing here would wipe
      // them. Only a live or recording run streams its logs over the socket.
      if (message.mode !== 'post-mortem') {
        state.logs = [];
        state.logsAvailable = false;
        state.logsTruncated = false;
      }
      if (message.mode !== 'post-mortem') pane.reset();
      break;
    case 'test-start': {
      const test = testFor(message.id, message.title);
      test.status = 'running';
      test.title = message.title;
      test.file = message.file;
      test.startedAt = message.startedAt;
      if (message.sessionId !== undefined) test.sessionId = message.sessionId;
      delete test.durationMs;
      delete test.error;
      retick();
      break;
    }
    case 'step': {
      const test = testFor(message.testId);
      const key = message.stepId ?? message.title;
      const existing = test.steps.find((candidate) => candidate.stepId === key);
      const step: MutableStep = existing ?? { stepId: key, title: message.title, status: 'running' };
      if (existing === undefined) test.steps.push(step);
      if (message.phase === 'start') step.startedAt = message.t;
      else {
        step.endedAt = message.t;
        step.status = message.status === 'failed' ? 'failed' : 'passed';
      }
      break;
    }
    case 'output': {
      state.activeSessionId ??= message.sessionId;
      if (message.sessionId !== state.activeSessionId) break;
      pane.write(fromBase64(message.dataB64));
      break;
    }
    case 'semantic': {
      state.activeSessionId ??= message.sessionId;
      state.sessions.set(message.sessionId, { snapshot: message.snapshot, revision: message.revision });
      break;
    }
    case 'test-end': {
      const test = testFor(message.id);
      test.status = message.status;
      if (message.traceRef !== undefined) test.traceRef = message.traceRef;
      if (message.error !== undefined) test.error = message.error;
      test.flaky = message.flaky;
      test.durationMs = message.durationMs;
      retick();
      break;
    }
    case 'action': {
      state.commands.push({
        id: `a${state.commands.length}`,
        kind: message.kind,
        t: message.t,
        label: message.api,
        depth: message.stepId === undefined ? 0 : 1,
        ok: message.ok,
        ...(message.selector === undefined ? {} : { selector: message.selector }),
        ...(message.ref === undefined ? {} : { ref: message.ref }),
        ...(message.error === undefined ? {} : { error: message.error }),
        ...(message.stepId === undefined ? {} : { stepId: message.stepId }),
      });
      // A live run has no scrubber; the log follows the newest row.
      if (state.trace === null) state.timeMs = message.t;
      break;
    }
    case 'app-log': {
      const { sessionId, type: _type, v: _v, ...log } = message;
      state.activeSessionId ??= sessionId;
      state.logsAvailable = true;
      state.logs.push(log);
      if (state.logs.length > MAX_LIVE_LOGS) {
        state.logs.splice(0, state.logs.length - MAX_LIVE_LOGS);
        state.logsTruncated = true;
      }
      break;
    }
    case 'run-end': {
      // The producer's own counters, used as sent: this protocol has one
      // producer generation, so there is nothing to reconcile them against.
      const { durationMs, ...counts } = message.summary;
      state.summary = `${describeCounts({ ...counts, running: 0 })} in ${Math.round(durationMs)}ms`;
      retick();
      break;
    }
  }
  schedule();
}

pane.on({
  onData(data) {
    if (state.recordSessionId === null) return;
    client.sendInput(state.recordSessionId, data);
  },
  onPickHover(position) {
    const snapshot = active()?.snapshot;
    if (snapshot === undefined || snapshot === null) return;
    state.hoveredId = position === null ? null : (nodeAt(snapshot.nodes, position)?.id ?? null);
    schedule();
  },
  onPick(position) {
    const snapshot = active()?.snapshot;
    if (snapshot === undefined || snapshot === null) return;
    const node = nodeAt(snapshot.nodes, position);
    if (node === undefined) return;
    state.selectedId = node.id;
    schedule();
  },
});

// Space plays and pauses, arrows walk actions — but not while you are typing
// in the filter box or the search field.
window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
    // The tree owns its own arrows and Enter while it has focus.
    if (target.closest('[role="tree"]') !== null) return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    timelineHandlers.togglePlay();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    timelineHandlers.jump(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    timelineHandlers.jump(-1);
  }
});

client.connect(handle, (connected) => {
  state.connected = connected;
  schedule();
});

void client
  .state()
  .then(async (server: ServerState) => {
    state.mode = server.mode;
    state.trace = server.trace;
    if (server.record !== null) {
      state.recordSessionId = server.record.sessionId;
      state.activeSessionId ??= server.record.sessionId;
      pane.focus();
    }
    if (server.trace !== null) {
      state.activeSessionId = server.trace.sessionId;
      warnAboutProfile(server.trace.terminalProfile);
      const [commands, frames] = await Promise.all([
        client.traceCommands().catch(() => null),
        client.traceFrames().catch(() => null),
      ]);
      if (commands !== null) {
        state.commands = [...commands.commands];
        state.commandsIncomplete = commands.incomplete;
        if (commands.error !== undefined) state.commandsError = commands.error;
      }
      if (frames !== null) {
        state.frames = [...frames.frames];
        state.revisions = [...frames.revisions];
      }
      const logs = await client.traceLogs({ after: 0 }).catch(() => null);
      if (logs !== null) {
        state.logs = [...logs.records];
        state.logsAvailable = logs.available;
        state.logsTruncated = logs.truncated;
        state.logsHasMoreBefore = logs.hasMoreBefore;
        state.logLevels = logs.levels;
      }
      await seek(0);
    }
    schedule();
  })
  .catch((error: unknown) => note(describe(error)));

draw();
