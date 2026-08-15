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
import { render } from 'lit-html';
import type { SemanticSnapshot } from '@termwright/protocol';
import { fromBase64, type ServerMessage } from '../events.js';
import type { GeneratedSelector } from '../selector.js';
import type { TraceOverview } from '../trace-source.js';
import { RunnerClient, type ServerState } from './client.js';
import { renderInspector, type InspectorHandlers } from './inspector.js';
import { TerminalPane, type Highlight } from './terminal-pane.js';
import { nextMarker, nodeAt } from '../view-model.js';
import {
  renderTimeline,
  type TimelineHandlers,
  type TimelineStep,
  type TimelineTest,
} from './timeline.js';

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
  tests: [] as TimelineTest[],
  trace: null as TraceOverview | null,
  timeMs: 0,
  picking: false,
  selectedId: null as string | null,
  hoveredId: null as string | null,
  status: null as string | null,
  summary: null as string | null,
};

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

  render(
    renderInspector(
      {
        snapshot,
        revision: view?.revision ?? null,
        selectedId: state.selectedId,
        hoveredId: state.hoveredId,
        picking: state.picking,
        recording: state.mode === 'record',
        variable: 'app',
        status: state.status,
      },
      inspectorHandlers,
    ),
    inspectorHost as HTMLElement,
  );

  render(
    renderTimeline(
      {
        mode: state.mode,
        tests: state.tests,
        trace: state.trace,
        timeMs: state.timeMs,
        connected: state.connected,
        summary: state.summary,
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

const inspectorHandlers: InspectorHandlers = {
  select(nodeId) {
    state.selectedId = nodeId;
    schedule();
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

const timelineHandlers: TimelineHandlers = {
  seek(timeMs) {
    void seek(timeMs);
  },
  jump(direction) {
    const markers = state.trace?.markers ?? [];
    const target = nextMarker(markers, state.timeMs, direction);
    if (target !== undefined) void seek(target);
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
  schedule();
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

function testFor(id: string, title = id): TimelineTest {
  const found = state.tests.find((test) => test.id === id);
  if (found !== undefined) return found;
  const created: TimelineTest = { id, title, status: 'running', steps: [] };
  state.tests.push(created);
  return created;
}

function handle(message: ServerMessage): void {
  switch (message.type) {
    case 'run-start':
      state.mode = message.mode;
      state.tests = [];
      state.summary = null;
      if (message.mode !== 'post-mortem') pane.reset();
      break;
    case 'test-start': {
      const test = testFor(message.id, message.title);
      test.status = 'running';
      break;
    }
    case 'step': {
      const test = testFor(message.testId);
      const key = message.stepId ?? message.title;
      let step = test.steps.find((candidate) => candidate.stepId === key);
      if (step === undefined) {
        step = { stepId: key, title: message.title, status: 'running' } satisfies TimelineStep;
        test.steps.push(step);
      }
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
      break;
    }
    case 'run-end': {
      const { total, passed, failed, skipped, durationMs } = message.summary;
      state.summary = `${total} tests — ${passed} passed, ${failed} failed, ${skipped} skipped${
        durationMs === undefined ? '' : ` in ${Math.round(durationMs)}ms`
      }`;
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
      await seek(0);
    }
    schedule();
  })
  .catch((error: unknown) => note(describe(error)));

draw();
