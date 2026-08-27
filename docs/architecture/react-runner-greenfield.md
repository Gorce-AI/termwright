# Greenfield React information architecture for the runner

**Status:** planned / design in progress. This document is an implementation
contract for replacing the browser renderer. It does not describe a shipped
React runner and it does not authorize a pane-by-pane DOM migration.

**Date:** 2026-08-20

## Intent

Build one React application around Termwright's domain rather than translating
the Lit markup component for component. The server, trace formats, terminal
emulator and pure domain functions are inputs. The current element tree, CSS
classes, render hosts and query selectors are not.

The useful Cypress lesson is causal information architecture, not visual
cloning:

- steal the execution narrative, where hooks, test body, authored steps,
  actions and assertions explain how the screen reached its state;
- steal transient hover time travel and explicit click-to-pin;
- adapt the application-under-test viewport to an immutable terminal grid,
  trace position and semantic revision;
- adapt the selector playground to semantic-node inspection and locator
  generation;
- reject Cypress's DOM iframe, browser-launch controls and 1:1 command-log DOM;
- reject the current Termwright markup as a compatibility target.

## Visual and interaction bar

This is a new product surface, not a React skin over the old panel. Matching
the previous dark table, pane borders, spacing or DOM structure is a failed
implementation even when every old browser assertion passes.

- Use the brand mint for live execution and successful progress, indigo/violet
  for replay and pinned time travel, amber for waiting, and coral for failure.
  Status must be readable without colour, but the interface must not collapse
  back into monochrome grey.
- Give execution, evidence and inspection distinct surfaces and depth. Avoid a
  single full-window spreadsheet made from one-pixel borders.
- The execution rail is a causal narrative: a vertical progress line connects
  hooks, body, authored steps, actions and assertions; the current node has a
  restrained motion cue and an explicit running state.
- Present the terminal as a contained machine with visible grid dimensions,
  uniform scale and a prominent LIVE or REPLAY identity. It must never visually
  merge with application chrome.
- Typography must expose the unique case/step name first, with suite, source,
  tags and timing as supporting information instead of one truncated string.
- Motion is evidence, not decoration: running progress, replay movement,
  selection and state transitions may animate; static navigation does not.
- At compact widths switch between Steps, Screen and Inspect while preserving
  selection and playhead. Do not squeeze the desktop columns until all three
  become unreadable.
- Acceptance is based on fresh headed screenshots at 1440, 800 and 390 pixels,
  keyboard traversal and task completion. Pixel or DOM parity with the legacy
  UI is explicitly not an acceptance criterion.

## Domain identities and minimal execution IR

The new renderer must not use one string as discovery key, current runtime id,
attempt identity and replay selection. These identities have different
lifetimes:

```ts
type CaseKey = string; // stable discovery/rerun identity
type RunId = string; // one suite invocation
type ExecutionId = string; // one case attempt within a run
type RuntimeId = string; // producer/Vitest correlation only
type SessionId = string; // one terminal process

interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

interface CaseDescriptor {
  caseKey: CaseKey;
  provider: string;
  title: string;
  titlePath: readonly string[];
  source: SourceLocation;
  tags: readonly string[];
  declaration: readonly DeclarationNode[];
}

interface DeclarationNode {
  id: string;
  kind: 'suite' | 'hook' | 'body' | 'step';
  title: string;
  source?: SourceLocation;
  children: readonly DeclarationNode[];
}

interface ExecutionAttempt {
  executionId: ExecutionId;
  runId: RunId;
  caseKey: CaseKey;
  runtimeId?: RuntimeId;
  attempt: number;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled';
  startedAt?: number;
  durationMs?: number;
  flaky: boolean;
  error?: string;
  lostLogRecords?: number;
  sessionIds: readonly SessionId[];
  traceRef?: string;
}

interface ExecutionNode {
  nodeId: string;
  executionId: ExecutionId;
  parentId?: string;
  kind: 'hook' | 'body' | 'step' | 'action' | 'assertion' | 'input';
  label: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  startMs: number;
  endMs?: number;
  selector?: string;
  targetRef?: string;
  error?: string;
}
```

`DeclarationNode` is authored structure; `ExecutionNode` is what happened. A
React component never reconstructs either hierarchy from title delimiters or
DOM nesting. The provider field keeps the model extensible without claiming
that any additional provider is currently implemented.

The current wire contract does not yet carry a server-owned `runId` and
`executionId` on every correlated event. That is a P0 prerequisite for a clean
store: retries, late session announcements and reruns of the same case cannot
be made unambiguous by React. Until the protocol is extended, a normalizer may
assign an execution id at `test-start` within a server-owned run epoch, but the
id must then be attached to session, step, action, result and replay records at
the server boundary. `runtimeId` must never become a persisted selection key.

History must bind a `traceRef` to the exact `runId + executionId`, not merely to
a case title. A future manifest revision should persist those fields while
retaining the stable `caseKey` for comparison across runs.

## Normalized application state

Keep domain facts separate from per-tab presentation:

```ts
interface DomainState {
  cases: ReadonlyMap<CaseKey, CaseDescriptor>;
  runs: ReadonlyMap<RunId, RunRecord>;
  executions: ReadonlyMap<ExecutionId, ExecutionAttempt>;
  executionNodes: ReadonlyMap<ExecutionId, readonly ExecutionNode[]>;
  sessions: ReadonlyMap<SessionId, SessionRecord>;
  liveRunId: RunId | null;
  capabilities: DataSourceCapabilities;
}

interface WorkspaceState {
  route: 'specs' | 'runner' | 'runs' | 'settings';
  selectedExecutionId: ExecutionId | null;
  selectedSessionId: SessionId | null;
  evidence:
    | { kind: 'live'; executionId: ExecutionId }
    | { kind: 'replay'; runId: RunId; executionId: ExecutionId; traceRef: string }
    | { kind: 'empty' };
  playheadMs: number;
  previewMs: number | null;
  expandedSpecs: ReadonlySet<string>;
  expandedExecutionNodes: ReadonlySet<string>;
  inspectorTab: 'tree' | 'semantic' | 'logs';
}
```

Incoming messages go through one reducer/normalizer. Views receive memoized,
immutable selectors. They do not mutate tests, copy live tests into a replay
array, maintain a second historical catalogue, or join sessions by reading the
DOM.

Replay creation/loading is keyed by `{runId, executionId, traceRef}` and an
`AbortSignal`. A stale completion cannot overwrite a newer selection. A new
live run updates `DomainState` but does not replace a replay-valued
`WorkspaceState.evidence`.

## ViewModels

Components consume small presentation contracts rather than `DomainState`:

```ts
interface SpecsViewModel {
  query: string;
  counts: StatusCounts;
  roots: readonly SpecTreeItemVM[];
  canRun: boolean;
  canRecord: boolean;
  runState: 'idle' | 'running' | 'stopping';
}

interface RunnerViewModel {
  toolbar: RunToolbarVM;
  cases: readonly RunCaseVM[];
  selected: SelectedExecutionVM | null;
  evidence: LiveEvidenceVM | ReplayEvidenceVM | EmptyEvidenceVM;
  terminal: TerminalVM | null;
  inspector: InspectorVM;
}

interface RunsViewModel {
  runs: readonly RunCardVM[];
  opened: RunDetailVM | null;
  replayedExecutionId: ExecutionId | null;
}
```

Every command and enabled state comes from capabilities plus domain state.
Inline reports therefore hide live/history actions through the same selectors,
not by calling an operation and handling its failure in a component.

## Component tree

```text
<TermwrightApp>
  <AppShell>
    <PrimaryNav />
    <ContextHeader />
    <AppRoute>
      <SpecsPage>
        <SpecsToolbar />
        <SpecTree>
          <SpecDirectoryRow />
          <SpecFileRow />
          <CaseRow />
      <RunnerPage>
        <RunToolbar />
        <RunnerWorkspace>
          <ExecutionRail>
            <RunCaseList>
              <RunCaseRow />
              <SelectedExecutionTree>
                <ExecutionNodeRow />
          <EvidenceWorkspace>
            <TerminalStage />
            <LiveStrip | ReplayControls />
            <InspectorTabs>
              <SemanticTree | SemanticPreview | LogList />
      <RunsPage>
        <RunList><RunCard /></RunList>
        <RunDetail><HistoricalCaseRow /></RunDetail>
      <SettingsPage />
    <ToastRegion />
    <ModalLayer />
```

`TerminalStage` is the one intentional imperative adapter: React owns its host
and lifecycle, xterm owns the descendants. It exposes commands such as write,
replace, resize-emulator, fit-scale, highlight and focus; no component queries
`.xterm-screen` to coordinate application state.

## Runner information architecture

### Desktop

- A sticky run toolbar owns connection state, run counts, screen selector,
  rerun and Stop. Those controls remain reachable while the evidence rail
  scrolls.
- The left execution rail has one vertical scroll. Cases form the primary
  navigator; only the selected case expands its authored/executed hierarchy
  inline. There is no separately scrolling test list above a competing command
  log.
- `Test body`, hooks and authored steps are structural nodes. Actions,
  assertions and unmatched raw input remain in execution order beneath them.
- Hover previews the trace moment and target without changing the pinned
  playhead. Click pins both. Leaving hover restores the pinned moment.
- The evidence workspace preserves the terminal's rows and columns and scales
  its surface uniformly. Browser layout never resizes the tested terminal.
- LIVE and replay are states of the same evidence panel. If the selected
  execution finishes and keeps a trace, it becomes replay only while that same
  `executionId` remains selected. Otherwise the row offers **Open recording**.
- Inspector tabs share the selected session and playhead. Semantic selection,
  command target highlighting and terminal overlay use node id plus revision,
  not a CSS selector.

### Compact width

At approximately 390 px, do not compress two desktop columns until neither is
usable. Keep the run toolbar compact and expose `Steps`, `Screen` and `Inspect`
as three views over one preserved runner selection. Switching views must not
reset scroll position, selected command, screen, trace playhead or inspector
node. The page itself must not gain horizontal overflow; the terminal stage may
scale and long command text may scroll within its evidence row when necessary.

## Specs and Runs

Specs is the launch surface, not a smaller rendering of Runner:

- directory/file/case hierarchy comes from `CaseDescriptor.source` and stable
  case keys;
- search is plain text over title path, tags and file;
- expansion is user-owned and never changed by discovery or status events;
- directory/file summaries retain passed, failed, running and not-run as
  separate facts; flaky and cancelled remain explicit where present;
- history dots open a run identity, not a trace inferred from a title;
- desktop metadata columns collapse into secondary row detail on compact width.

Runs is immutable history:

- run cards show outcome, duration, flaky count and recorded commit facts;
- opening a run shows its attempts, including repeated attempts of one case;
- selecting a retained trace navigates to Runner with an explicit historical
  breadcrumb and pinned replay evidence;
- a live run may update Specs and nav status in the background but cannot
  replace the selected historical title, status, terminal or scrubber;
- two tabs can hold different replay contexts because replay selection and
  loading are per client, not global server state.

## Legacy assumptions to remove

- The fixed `index.html` hosts (`#commands`, `#terminal`, `#timeline`,
  `#inspector`, `#page`) are not the React component boundary.
- Do not retain Lit islands beside React islands or `flushSync` merely so old
  synchronous DOM measurements still work. Cut over one application root.
- Replace the mutable singleton in `main.ts` with reducer-owned domain state,
  workspace state and effects.
- No application logic through `document.querySelector`, class names,
  `hidden`, `scrollIntoView` or direct descendant measurement. Use refs and
  explicit component/effect APIs.
- Do not encode selected, passed or running state only in `.selected`,
  `.passed` or `.running` classes. Classes are presentation outputs.
- Do not preserve repeated `data-testid` values plus `nth()` as identity.
  Tests select a semantic role/name or a row carrying its real case/execution
  key.
- Do not derive suite breadcrumbs by splitting Vitest title strings.
- Do not create synthetic DOM-only execution ids such as a test-body fold key;
  body and steps are nodes in the IR.
- Do not keep parallel mutable `tests`, `replayTest` and `replayTests`
  catalogues. Replay is a context over immutable run/execution facts.
- Replace scalar request epochs with abortable, identity-keyed effects.
- Do not call `Date.now()` inside row rendering; clocks enter selectors.
- Do not navigate editor schemes with `location.href`; use an explicit host
  capability with validation and a copy-path fallback.

## Existing behavior that remains contractual

- Initialization error is distinct from an empty project.
- Navigation chosen while an archive loads is not overridden by completion.
- Status is never colour-only; not-run, running, cancelled, skipped and flaky
  remain distinct.
- Discovery reconciles with execution without changing stable row identity.
- Specs folding survives status updates and reconnect/backlog delivery.
- Stop reflects authoritative process outcome, including race and failure.
- Current-attempt sessions are switchable; stale prior-attempt sessions are
  excluded.
- Live-to-replay, pinned history and per-tab replay isolation retain their
  current semantics.
- Replay command hover restores the playhead; click pins it.
- The terminal grid scales uniformly, small grids can enlarge, and profile,
  rows and columns remain visible.
- Crash evidence, bounded logs, incomplete-recording warnings and lost-log
  counts remain evidence facts rather than being folded into test status.
- Inline `file://` reports use the same React views with capability-restricted
  data, not a report-specific renderer.
- Splitters remain pointer- and keyboard-operable on desktop and preserve both
  sides' usable minimums.

## Browser-test crosscheck

The current browser suite contains valuable behavior tests and legacy layout
tests. Port them by intent:

| Current coverage                                                                   | Greenfield treatment                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| initialization error, navigation during load, inline report                        | preserve end to end                                                                    |
| discovery/not-run reconciliation, user-owned Specs folds, mid-run backlog          | preserve against normalized store and React view                                       |
| Stop races/failure, current-attempt session switch                                 | preserve; add explicit `executionId` assertions                                        |
| live-to-replay and two-tab contextual replay                                       | preserve as P0 acceptance tests                                                        |
| command hover/restore/pin, timeline edges and markers                              | preserve using accessible names and execution ids                                      |
| large/small terminal scaling                                                       | preserve as TerminalStage contract tests                                               |
| exact `.view`, `.layout`, `.tree`, `.commands`, `#terminal .xterm-screen` geometry | delete or rewrite as user-visible no-overflow/reachability assertions                  |
| repeated test ids selected with `nth()`                                            | replace with role/name plus `data-case-key` or `data-execution-id`                     |
| old three-pane existence                                                           | replace with Runner regions and compact `Steps/Screen/Inspect` navigation              |
| Lit render-unit tests                                                              | move pure behavior to selector/reducer tests and interactions to React Testing Library |

Keep a small number of opaque test ids for surfaces with no reliable accessible
handle, such as the xterm host and timeline track. Test ids are observation
hooks only; production logic never reads them.

Add new gates before cutover:

1. reducer permutations for session-before-test, late results, retry, rerun and
   stale replay completion;
2. one trace belonging to each of two attempts of the same case;
3. live run B arriving while historical replay A remains selected;
4. desktop and 390 px focus order, no document horizontal overflow, preserved
   selection across compact tabs;
5. semantic roles for navigation, tree, status announcements, slider and
   keyboard splitters;
6. no DOM query or Lit import in the new React application entry.

## Cutover strategy

This is a replacement, not a chain of compatibility islands:

1. Preserve and unit-test browser-safe domain modules such as command shaping,
   spec-tree construction, playback math, trace parsing and data-source
   capability declarations.
2. Add execution identities and a pure event normalizer before rendering more
   UI around ambiguous state.
3. Build the React application behind a development-only entry with its own
   component tree and styles; do not reproduce old hosts/classes.
4. Reach vertical parity in order: Specs launch -> live Runner -> retained
   replay -> Runs/history -> record/settings.
5. Run old and new browser behavior suites against identical deterministic
   fixtures, comparing outcomes rather than screenshots or DOM trees.
6. Switch the single production entry atomically, then remove Lit, legacy
   renderer modules and selectors. Do not leave permanent dual rendering.

The visual baseline is a new product decision informed by Cypress's clarity,
not proof that the old renderer has been transcribed accurately.
