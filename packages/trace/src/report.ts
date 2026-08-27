/**
 * Self-contained HTML failure report: test list, side-by-side visual diff of
 * cell snapshots, semantic diff in plain English, and an embedded asciinema
 * player positioned on the failing step's marker.
 *
 * The generated file loads nothing from the network — the player bundle and its
 * stylesheet are inlined from `node_modules` at generation time.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SemanticSnapshot } from '@termwright/protocol';
import { openTrace, type TraceReader, type TraceState } from './reader.js';
import { changedRows, escapeHtml, renderAnsiToHtml, type RenderedScreen } from './render.js';
import { diffSemanticSnapshots, type SemanticDiff } from './semantic-diff.js';
import type { ActionEvent, StepStatus, StepSummary, TraceCrash, TraceLogEntry } from './types.js';

/** Explicit before/after screens, when the caller already has them. */
export interface VisualDiffInput {
  /** ANSI of the expected/baseline screen. */
  readonly expected: string;
  /** ANSI of the observed screen. */
  readonly actual: string;
  readonly expectedLabel?: string;
  readonly actualLabel?: string;
  readonly columns?: number;
  readonly rows?: number;
}

/** Explicit before/after semantic trees. */
export interface SemanticDiffInput {
  readonly before: SemanticSnapshot;
  readonly after: SemanticSnapshot;
}

/** One test as it should appear in the report. */
export interface ReportTestResult {
  readonly id: string;
  readonly title: string;
  readonly file?: string;
  readonly status: StepStatus;
  readonly durationMs?: number;
  readonly error?: { readonly message: string; readonly stack?: string };
  /** Ordered native-runner attempts for this stable case identity. */
  readonly attempts?: readonly ReportTestAttempt[];
  /** `.twtrace` directory or zip; diffs and the player are derived from it. */
  readonly tracePath?: string;
  /** Overrides the visual diff derived from the trace. */
  readonly visual?: VisualDiffInput;
  /** Overrides the semantic diff derived from the trace. */
  readonly semantic?: SemanticDiffInput;
  /**
   * Rendered frames to embed as images, e.g. PNGs from
   * `@termwright/screenshot`. The report never rasterises anything itself —
   * that would drag a native renderer into every test run — so the caller
   * renders the frames it wants and passes the bytes here.
   */
  readonly screenshots?: readonly ReportScreenshot[];
  /**
   * Overrides the crash panel derived from the trace.
   *
   * Only needed when the caller has a crash report but no trace to carry it —
   * recording turned off, or `retain-on-failure` discarding the archive. When a
   * trace is present its `meta.crash` is used, and this field wins over it.
   */
  readonly crash?: ReportCrash;
}

/** One native runner attempt, including the exact reasons captured before retry. */
export interface ReportTestAttempt {
  readonly attempt: number;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly durationMs?: number;
  readonly errors: readonly { readonly message: string; readonly stack?: string }[];
  readonly tracePaths?: readonly string[];
}

/**
 * A crash handed straight to the report.
 *
 * Structural and JSON-safe on purpose: the Native Host runner moves this through
 * `task.meta` from a worker to the main process, so it must survive
 * `JSON.parse` without needing types from `@termwright/driver`. `code` is
 * therefore a plain string here, while the archive's own {@link TraceCrash}
 * keeps the driver's closed `DiagnosticCode` — that one is written from typed
 * data and never round-trips through a worker boundary.
 */
export interface ReportCrash {
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  /** Milliseconds since session start. */
  readonly timeMs: number;
  /**
   * Terminal output around the death, oldest first, already bounded by the
   * caller. **Not redacted** — see {@link TraceCrash.screenTail}.
   */
  readonly screenTail: readonly string[];
  readonly recentInputs?: readonly {
    readonly timeMs: number;
    readonly kind: 'key' | 'mouse' | 'paste' | 'raw';
    readonly bytes: number;
    /** Omitted for pastes, whose contents are never recorded. */
    readonly preview?: string;
  }[];
  readonly diagnostics?: readonly {
    readonly code: string;
    readonly detail: string;
    readonly timeMs: number;
    readonly revision?: number;
  }[];
  readonly lastSemanticRevision?: number | null;
}

/** One image embedded in a test's section of the report. */
export interface ReportScreenshot {
  readonly label: string;
  /** Raw image bytes; inlined as a `data:` URI. */
  readonly image: Uint8Array;
  /** Defaults to `'image/png'`. */
  readonly mediaType?: string;
}

/** Options for {@link generateHtmlReport}. */
export interface ReportOptions {
  readonly results: readonly ReportTestResult[];
  /** Destination `.html` path; parent directories are created. */
  readonly outFile: string;
  readonly title?: string;
  /**
   * Inline the asciinema player. Default `true`; falls back to a notice when
   * the `asciinema-player` package cannot be resolved.
   */
  readonly embedPlayer?: boolean;
  /** Fixed timestamp, for reproducible output in tests. */
  readonly generatedAt?: Date;
  /** Cast recordings larger than this are not embedded. Default 4 MiB. */
  readonly maxEmbeddedCastBytes?: number;
  /** Log entries shown per test, in each of the two places. Default 200. */
  readonly maxLogEntriesShown?: number;
}

/** Outcome of {@link generateHtmlReport}. */
export interface ReportResult {
  readonly outFile: string;
  readonly html: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

const DEFAULT_MAX_CAST_BYTES = 4 * 1024 * 1024;

/**
 * Renders and writes the report.
 *
 * @example
 * ```ts
 * await generateHtmlReport({
 *   outFile: 'termwright-report/index.html',
 *   results: [{ id: 't1', title: 'login', status: 'failed', tracePath: 'out/login.twtrace' }],
 * });
 * ```
 */
export async function generateHtmlReport(options: ReportOptions): Promise<ReportResult> {
  const sections = await Promise.all(
    options.results.map((result) => buildSection(result, options)),
  );
  const html = renderDocument(sections, options);
  await mkdir(dirname(options.outFile), { recursive: true });
  await writeFile(options.outFile, html, 'utf8');
  return {
    outFile: options.outFile,
    html,
    passed: count(options.results, 'passed'),
    failed: count(options.results, 'failed'),
    skipped: count(options.results, 'skipped'),
  };
}

function count(results: readonly ReportTestResult[], status: StepStatus): number {
  return results.filter((result) => result.status === status).length;
}

interface TestSection {
  readonly result: ReportTestResult;
  readonly steps: readonly StepSummary[];
  readonly failingStep: StepSummary | null;
  readonly visual: {
    before: RenderedScreen;
    after: RenderedScreen;
    labels: [string, string];
  } | null;
  readonly semantic: SemanticDiff | null;
  readonly crash: TraceCrash | null;
  /** Entries around the failure, for the Logs section. */
  readonly logs: readonly TraceLogEntry[];
  /** error/fatal/warn entries across the whole run, for the timeline. */
  readonly notableLogs: readonly TraceLogEntry[];
  /** True when `logs` is the failing step's window rather than the whole log. */
  readonly logsAroundFailure: boolean;
  /** Actions the driver reported as failed, for the timeline. */
  readonly failedActions: readonly ActionEvent[];
  readonly cast: string | null;
  readonly castNote: string | null;
}

async function buildSection(
  result: ReportTestResult,
  options: ReportOptions,
): Promise<TestSection> {
  const empty: TestSection = {
    result,
    steps: [],
    failingStep: null,
    visual: null,
    semantic: null,
    crash: null,
    logs: [],
    notableLogs: [],
    logsAroundFailure: false,
    failedActions: [],
    cast: null,
    castNote: null,
  };

  let trace: TraceReader | null = null;
  try {
    if (result.tracePath !== undefined) {
      trace = await openTrace(result.tracePath);
    }
  } catch (error) {
    return { ...empty, castNote: `trace unavailable: ${messageOf(error)}` };
  }

  try {
    const steps = trace === null ? [] : await trace.steps();
    const failingStep = pickFailingStep(steps);
    const failedActions = trace === null ? [] : await loadFailedActions(trace, options);

    let before: TraceState | null = null;
    let after: TraceState | null = null;
    if (trace !== null && result.status === 'failed') {
      const startAt = failingStep?.castOffset ?? 0;
      const endAt = failingStep?.castEndOffset ?? trace.meta.durationMs ?? startAt;
      before = await trace.stateAt(startAt);
      after = await trace.stateAt(endAt);
    }

    const visual = await buildVisual(result, before, after, trace);
    const semantic = buildSemantic(result, before, after);
    const { cast, castNote } = await loadCast(trace, options);
    // `failingStep` falls back to the last step for the player's start point;
    // the log window needs the step that actually failed, or none at all.
    const failedStep =
      result.status === 'failed' ? (steps.find((step) => step.status === 'failed') ?? null) : null;
    const { logs, notableLogs } = await loadLogs(trace, failedStep, options);

    return {
      result,
      steps,
      failingStep,
      visual,
      semantic,
      crash: trace?.meta.crash ?? null,
      logs,
      notableLogs,
      logsAroundFailure: failedStep !== null,
      failedActions,
      cast,
      castNote,
    };
  } finally {
    await trace?.close();
  }
}

function pickFailingStep(steps: readonly StepSummary[]): StepSummary | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.status === 'failed') return step;
  }
  return steps[steps.length - 1] ?? null;
}

async function buildVisual(
  result: ReportTestResult,
  before: TraceState | null,
  after: TraceState | null,
  trace: TraceReader | null,
): Promise<TestSection['visual']> {
  if (result.visual !== undefined) {
    const size = {
      columns: result.visual.columns ?? trace?.meta.columns ?? 100,
      rows: result.visual.rows ?? trace?.meta.rows ?? 30,
    };
    return {
      before: await renderAnsiToHtml(result.visual.expected, size),
      after: await renderAnsiToHtml(result.visual.actual, size),
      labels: [result.visual.expectedLabel ?? 'expected', result.visual.actualLabel ?? 'actual'],
    };
  }
  if (before === null || after === null) return null;
  return {
    before: await renderAnsiToHtml(before.castPrefix, {
      columns: before.columns,
      rows: before.rows,
    }),
    after: await renderAnsiToHtml(after.castPrefix, { columns: after.columns, rows: after.rows }),
    labels: ['before failing step', 'at failure'],
  };
}

function buildSemantic(
  result: ReportTestResult,
  before: TraceState | null,
  after: TraceState | null,
): SemanticDiff | null {
  if (result.semantic !== undefined) {
    return diffSemanticSnapshots(result.semantic.before, result.semantic.after);
  }
  const from = before?.nearestSemantic?.snapshot;
  const to = after?.nearestSemantic?.snapshot;
  if (from === undefined || to === undefined || from.revision === to.revision) return null;
  return diffSemanticSnapshots(from, to);
}

const NOTABLE_LEVELS = new Set(['warn', 'error', 'fatal']);

/**
 * Actions the driver reported as failed.
 *
 * The driver emits these precisely so a report can say the click never landed
 * and why, instead of showing a screen that simply did not change.
 */
async function loadFailedActions(
  trace: TraceReader,
  options: ReportOptions,
): Promise<readonly ActionEvent[]> {
  const limit = options.maxLogEntriesShown ?? 200;
  const failed: ActionEvent[] = [];
  for await (const event of trace.events()) {
    if (event.kind !== 'action' || event.ok) continue;
    failed.push(event);
    if (failed.length >= limit) break;
  }
  return failed;
}

/**
 * Reads `logs.jsonl` once, splitting it into the window shown at a failure and
 * the notable entries pinned onto the timeline.
 */
async function loadLogs(
  trace: TraceReader | null,
  failedStep: StepSummary | null,
  options: ReportOptions,
): Promise<{ logs: readonly TraceLogEntry[]; notableLogs: readonly TraceLogEntry[] }> {
  if (trace === null || trace.meta.logs === undefined) return { logs: [], notableLogs: [] };
  const limit = options.maxLogEntriesShown ?? 200;
  // A failure narrows the view to the step that failed. A test that passed
  // still kept an archive under `trace: 'on'`, and its log is the artifact —
  // show the whole thing, newest kept when it runs long.
  const from = failedStep?.castOffset ?? 0;
  const until = failedStep?.castEndOffset ?? Number.POSITIVE_INFINITY;

  const window: TraceLogEntry[] = [];
  const notable: TraceLogEntry[] = [];
  for await (const entry of trace.logs()) {
    if (entry.level !== undefined && NOTABLE_LEVELS.has(entry.level)) {
      if (notable.length < limit) notable.push(entry);
    }
    if (entry.castOffset < from || entry.castOffset > until) continue;
    window.push(entry);
    if (window.length > limit) window.shift();
  }
  return { logs: window, notableLogs: notable };
}

async function loadCast(
  trace: TraceReader | null,
  options: ReportOptions,
): Promise<{ cast: string | null; castNote: string | null }> {
  if (trace === null || options.embedPlayer === false) return { cast: null, castNote: null };
  const limit = options.maxEmbeddedCastBytes ?? DEFAULT_MAX_CAST_BYTES;
  const lines: string[] = [];
  let bytes = 0;
  const header = await trace.castHeader();
  lines.push(JSON.stringify(header));
  for await (const event of trace.castEvents()) {
    const line = JSON.stringify([Math.round(event.interval * 1e6) / 1e6, event.code, event.data]);
    bytes += line.length;
    if (bytes > limit) {
      return {
        cast: null,
        castNote: `recording omitted: larger than ${limit} bytes (open the .twtrace directly)`,
      };
    }
    lines.push(line);
  }
  return { cast: `${lines.join('\n')}\n`, castNote: null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// HTML

function renderDocument(sections: readonly TestSection[], options: ReportOptions): string {
  const title = options.title ?? 'termwright report';
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const passed = count(options.results, 'passed');
  const failed = count(options.results, 'failed');
  const skipped = count(options.results, 'skipped');
  const wantsPlayer = options.embedPlayer !== false && sections.some((s) => s.cast !== null);
  const player = wantsPlayer ? loadPlayerAssets() : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
${player === null ? '' : `<style>${player.css}</style>`}
</head>
<body>
<header class="tw-header">
  <h1>${escapeHtml(title)}</h1>
  <p class="tw-summary">
    <span class="tw-pill tw-failed">${failed} failed</span>
    <span class="tw-pill tw-passed">${passed} passed</span>
    <span class="tw-pill tw-skipped">${skipped} skipped</span>
    <span class="tw-generated">generated ${escapeHtml(generatedAt)}</span>
  </p>
</header>
<main>
${sections.map(renderSection).join('\n')}
</main>
${player === null ? '' : `<script>${player.js}</script>`}
<script>${BOOTSTRAP_JS}</script>
</body>
</html>
`;
}

function renderSection(section: TestSection): string {
  const { result } = section;
  const open = result.status === 'failed' ? ' open' : '';
  const parts: string[] = [];

  if (result.attempts !== undefined && result.attempts.length > 1) {
    parts.push(renderAttempts(result.attempts));
  }

  if (result.error !== undefined) {
    parts.push(
      `<section class="tw-block"><h3>Error</h3><pre class="tw-error">${escapeHtml(
        result.error.stack ?? result.error.message,
      )}</pre></section>`,
    );
  }
  if (section.failingStep !== null && result.status === 'failed') {
    parts.push(
      `<p class="tw-step">failing step: <strong>${escapeHtml(
        section.failingStep.title,
      )}</strong> at ${formatMs(section.failingStep.castOffset)}</p>`,
    );
  }
  const crash =
    result.crash !== undefined
      ? panelFromResult(result.crash)
      : section.crash === null
        ? null
        : panelFromTrace(section.crash);
  if (crash !== null) parts.push(renderCrash(crash));
  if (section.semantic !== null) parts.push(renderSemantic(section.semantic));
  if (section.visual !== null) parts.push(renderVisual(section.visual));
  if (result.screenshots !== undefined && result.screenshots.length > 0) {
    parts.push(renderScreenshots(result.screenshots));
  }
  if (section.cast !== null) parts.push(renderPlayer(result.id, section.cast, section.failingStep));
  if (section.castNote !== null) {
    parts.push(`<p class="tw-note">${escapeHtml(section.castNote)}</p>`);
  }
  if (result.tracePath !== undefined) {
    // A path to copy, not a link: a browser cannot usefully open a directory,
    // and this is what gets pasted into `termwright ui`.
    parts.push(
      `<p class="tw-note">trace: <code class="tw-path">${escapeHtml(result.tracePath)}</code></p>`,
    );
  }
  if (section.logs.length > 0) parts.push(renderLogs(section.logs, section.logsAroundFailure));
  if (
    section.steps.length > 0 ||
    section.notableLogs.length > 0 ||
    section.failedActions.length > 0
  ) {
    parts.push(renderTimeline(section.steps, section.notableLogs, section.failedActions));
  }

  return `<details class="tw-test tw-${result.status}"${open}>
  <summary>
    <span class="tw-status">${result.status}</span>
    <span class="tw-title">${escapeHtml(result.title)}</span>
    ${result.file === undefined ? '' : `<span class="tw-file">${escapeHtml(result.file)}</span>`}
    ${
      result.durationMs === undefined
        ? ''
        : `<span class="tw-duration">${formatMs(result.durationMs)}</span>`
    }
  </summary>
  ${parts.join('\n  ')}
</details>`;
}

function renderAttempts(attempts: readonly ReportTestAttempt[]): string {
  const items = attempts
    .map((attempt) => {
      const reasons =
        attempt.errors.length === 0
          ? ''
          : `<pre class="tw-error">${escapeHtml(
              attempt.errors
                .map((error) =>
                  error.stack === undefined ? error.message : `${error.message}\n${error.stack}`,
                )
                .join('\n\n'),
            )}</pre>`;
      const traces =
        attempt.tracePaths === undefined || attempt.tracePaths.length === 0
          ? ''
          : `<p class="tw-note">trace${attempt.tracePaths.length === 1 ? '' : 's'}: ${attempt.tracePaths
              .map((path) => `<code class="tw-path">${escapeHtml(path)}</code>`)
              .join(', ')}</p>`;
      return `<li><strong>Attempt ${attempt.attempt}</strong> — ${attempt.status}${
        attempt.durationMs === undefined ? '' : ` · ${formatMs(attempt.durationMs)}`
      }${reasons}${traces}</li>`;
    })
    .join('\n      ');
  return `<section class="tw-block"><h3>Attempts · ${attempts.length}</h3><ol class="tw-attempts">${items}</ol></section>`;
}

function renderSemantic(diff: SemanticDiff): string {
  if (diff.isEmpty) {
    return `<section class="tw-block"><h3>Semantic diff</h3><p class="tw-note">no semantic changes</p></section>`;
  }
  const items = diff.sentences
    .map((sentence) => `<li>${escapeHtml(sentence)}</li>`)
    .join('\n      ');
  return `<section class="tw-block">
    <h3>Semantic diff</h3>
    <ul class="tw-sentences">
      ${items}
    </ul>
  </section>`;
}

function renderVisual(visual: NonNullable<TestSection['visual']>): string {
  const changed = changedRows(visual.before, visual.after);
  const column = (screen: RenderedScreen, label: string): string => {
    const rows = screen.lines
      .map(
        (line) =>
          `<div class="tw-row${changed.has(line.index) ? ' tw-row-changed' : ''}">${
            line.html === '' ? '&nbsp;' : line.html
          }</div>`,
      )
      .join('');
    return `<figure class="tw-screen"><figcaption>${escapeHtml(
      label,
    )}</figcaption><div class="tw-grid">${rows}</div></figure>`;
  };
  return `<section class="tw-block">
    <h3>Visual diff <span class="tw-note">${changed.size} row(s) changed</span></h3>
    <div class="tw-visual">
      ${column(visual.before, visual.labels[0])}
      ${column(visual.after, visual.labels[1])}
    </div>
  </section>`;
}

/**
 * The crash panel: how the program died, and what the terminal showed as it
 * went. Rendered above the diffs, because when a program dies on its own the
 * stack trace it printed is the answer and everything else is context.
 */
interface CrashPanel {
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  /** Where to say it happened: the cast offset when known, else wall clock. */
  readonly atMs: number;
  readonly screenTail: readonly string[];
  readonly recentInputs: readonly {
    readonly timeMs: number;
    readonly kind: string;
    readonly bytes: number;
    readonly preview?: string;
  }[];
  readonly diagnostics: readonly {
    readonly code: string;
    readonly detail: string;
    readonly revision?: number;
  }[];
  readonly lastSemanticRevision: number | null;
}

/** The archive's crash, positioned on the cast timeline. */
function panelFromTrace(crash: TraceCrash): CrashPanel {
  return {
    exit: crash.exit,
    atMs: crash.castOffset,
    screenTail: crash.screenTail,
    recentInputs: crash.recentInputs,
    diagnostics: crash.diagnosticsTail,
    lastSemanticRevision: crash.lastSemanticRevision,
  };
}

/** A caller-supplied crash, which only knows wall-clock time. */
function panelFromResult(crash: ReportCrash): CrashPanel {
  return {
    exit: crash.exit,
    atMs: crash.timeMs,
    screenTail: crash.screenTail,
    recentInputs: crash.recentInputs ?? [],
    diagnostics: crash.diagnostics ?? [],
    lastSemanticRevision: crash.lastSemanticRevision ?? null,
  };
}

function renderCrash(crash: CrashPanel): string {
  const cause =
    crash.exit.signal === null
      ? `exit code ${String(crash.exit.code ?? 'unknown')}`
      : `signal ${crash.exit.signal}`;

  const parts: string[] = [
    `<p class="tw-crash-head">The program died on its own: <strong>${escapeHtml(
      cause,
    )}</strong> at ${formatMs(crash.atMs)}.</p>`,
  ];

  if (crash.screenTail.length > 0) {
    parts.push(
      `<h4>Screen at the end</h4>`,
      `<p class="tw-warn">Not redacted — this is what the terminal showed, verbatim, secrets included. Treat this report like a screenshot when storing or forwarding it.</p>`,
      `<pre class="tw-crash-screen">${escapeHtml(crash.screenTail.join('\n'))}</pre>`,
    );
  }

  if (crash.recentInputs.length > 0) {
    const rows = crash.recentInputs
      .map(
        (input) =>
          `<tr><td>${formatMs(input.timeMs)}</td><td>${escapeHtml(input.kind)}</td><td>${
            input.bytes
          } B</td><td>${
            input.preview === undefined
              ? '<span class="tw-note">not recorded</span>'
              : `<code>${escapeHtml(input.preview)}</code>`
          }</td></tr>`,
      )
      .join('\n      ');
    parts.push(
      `<h4>Last inputs before the end</h4>`,
      `<table class="tw-steps"><thead><tr><th>at</th><th>kind</th><th>size</th><th>sent</th></tr></thead><tbody>
      ${rows}
    </tbody></table>`,
    );
  }

  if (crash.diagnostics.length > 0) {
    const items = crash.diagnostics
      .map(
        (entry) =>
          `<li><code>${escapeHtml(entry.code)}</code> ${escapeHtml(entry.detail)}${
            entry.revision === undefined
              ? ''
              : ` <span class="tw-note">rev ${entry.revision}</span>`
          }</li>`,
      )
      .join('\n      ');
    parts.push(`<h4>Session diagnostics</h4><ul class="tw-sentences">\n      ${items}\n    </ul>`);
  }

  if (crash.lastSemanticRevision !== null) {
    parts.push(
      `<p class="tw-note">Last semantic revision: ${crash.lastSemanticRevision} (the tree is in <code>semantics.jsonl</code>).</p>`,
    );
  }

  return `<section class="tw-block tw-crash">
    <h3>Crash</h3>
    ${parts.join('\n    ')}
  </section>`;
}

function renderScreenshots(screenshots: readonly ReportScreenshot[]): string {
  const figures = screenshots
    .map((shot) => {
      const mediaType = shot.mediaType ?? 'image/png';
      const encoded = Buffer.from(shot.image).toString('base64');
      return `<figure class="tw-shot"><figcaption>${escapeHtml(
        shot.label,
      )}</figcaption><img alt="${escapeHtml(
        shot.label,
      )}" src="data:${mediaType};base64,${encoded}"></figure>`;
    })
    .join('\n      ');
  return `<section class="tw-block">
    <h3>Screenshots</h3>
    <div class="tw-shots">
      ${figures}
    </div>
  </section>`;
}

/**
 * Steps and notable log entries on one time-ordered list.
 *
 * Two separate lists would leave the reader to align them by hand, and the
 * whole point of a logged error is *where in the test it happened*.
 */
function renderTimeline(
  steps: readonly StepSummary[],
  notableLogs: readonly TraceLogEntry[],
  failedActions: readonly ActionEvent[],
): string {
  const entries: { at: number; html: string }[] = [
    ...steps.map((step) => ({
      at: step.castOffset,
      html: `<tr class="tw-step-${step.status ?? 'open'}"><td>${escapeHtml(
        step.title,
      )}</td><td>${step.status ?? 'open'}</td><td>${formatMs(step.castOffset)}</td></tr>`,
    })),
    ...notableLogs.map((entry) => ({
      at: entry.castOffset,
      html: `<tr class="tw-log-row tw-log-${entry.level ?? 'info'}"><td>${logLabel(
        entry,
      )}${escapeHtml(entry.message)}</td><td>${escapeHtml(
        entry.level ?? 'log',
      )}</td><td>${formatMs(entry.castOffset)}</td></tr>`,
    })),
    ...failedActions.map((action) => ({
      at: action.castOffset,
      html: `<tr class="tw-action-failed"><td>${escapeHtml(action.api)}${
        action.selector === undefined
          ? ''
          : ` <span class="tw-note">${escapeHtml(action.selector)}</span>`
      }</td><td>${escapeHtml(action.error ?? 'failed')}</td><td>${formatMs(
        action.castOffset,
      )}</td></tr>`,
    })),
  ];
  entries.sort((a, b) => a.at - b.at);
  return `<section class="tw-block">
    <h3>Timeline</h3>
    <table class="tw-steps"><thead><tr><th>event</th><th>status</th><th>at</th></tr></thead>
    <tbody>
      ${entries.map((entry) => entry.html).join('\n      ')}
    </tbody></table>
  </section>`;
}

/** `<span class="tw-log-label">http</span>` — empty when the entry has no label. */
function logLabel(entry: TraceLogEntry): string {
  return entry.label === undefined
    ? ''
    : `<span class="tw-log-label">${escapeHtml(entry.label)}</span> `;
}

/** Every log entry inside the failing step, level-coloured. */
function renderLogs(logs: readonly TraceLogEntry[], aroundFailure: boolean): string {
  const rows = logs
    .map((entry) => {
      const attrs =
        entry.attrs === undefined
          ? ''
          : ` <span class="tw-note">${escapeHtml(
              Object.entries(entry.attrs)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(' '),
            )}</span>`;
      return `<li class="tw-log-${entry.level ?? 'info'}"><span class="tw-log-at">${formatMs(
        entry.castOffset,
      )}</span> ${logLabel(entry)}${escapeHtml(entry.message)}${attrs}</li>`;
    })
    .join('\n      ');
  return `<section class="tw-block">
    <h3>Application logs <span class="tw-note">${logs.length} entr${
      logs.length === 1 ? 'y' : 'ies'
    }${aroundFailure ? ' around the failure' : ''}</span></h3>
    <ul class="tw-logs">
      ${rows}
    </ul>
  </section>`;
}

function renderPlayer(id: string, cast: string, failingStep: StepSummary | null): string {
  const startAt = failingStep === null ? 0 : Math.max(0, failingStep.castOffset / 1000);
  return `<section class="tw-block">
    <h3>Recording</h3>
    <div class="tw-player" data-cast="cast-${escapeHtml(id)}" data-start="${startAt}"></div>
    <script type="application/json" id="cast-${escapeHtml(id)}">${jsonForScript(cast)}</script>
  </section>`;
}

/** Embeds a string in a `<script type="application/json">` block safely. */
function jsonForScript(value: string): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028');
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

interface PlayerAssets {
  readonly js: string;
  readonly css: string;
}

let playerAssets: PlayerAssets | null | undefined;

/** Reads the asciinema player bundle from `node_modules`, once per process. */
function loadPlayerAssets(): PlayerAssets | null {
  if (playerAssets !== undefined) return playerAssets;
  const require = createRequire(import.meta.url);
  try {
    playerAssets = {
      js: readFileSync(
        require.resolve('asciinema-player/dist/bundle/asciinema-player.min.js'),
        'utf8',
      ),
      css: readFileSync(
        require.resolve('asciinema-player/dist/bundle/asciinema-player.css'),
        'utf8',
      ),
    };
  } catch {
    playerAssets = null;
  }
  return playerAssets;
}

/** Exposed for tests: forces the asset cache to be re-read. */
export function resetPlayerAssetCache(): void {
  playerAssets = undefined;
}

/** Reads embedded cast payloads and mounts one player per recording. */
const BOOTSTRAP_JS = `
(function () {
  if (typeof AsciinemaPlayer === 'undefined') return;
  var mount = function (element) {
    if (element.dataset.mounted === '1') return;
    element.dataset.mounted = '1';
    var source = document.getElementById(element.dataset.cast);
    if (!source) return;
    AsciinemaPlayer.create(
      { data: JSON.parse(source.textContent) },
      element,
      { startAt: Number(element.dataset.start) || 0, fit: 'width', terminalFontSize: '13px' }
    );
  };
  document.querySelectorAll('details').forEach(function (details) {
    var render = function () {
      if (details.open) details.querySelectorAll('.tw-player').forEach(mount);
    };
    details.addEventListener('toggle', render);
    render();
  });
})();
`;

const REPORT_CSS = `
:root { color-scheme: dark; --bg:#0d0d0f; --panel:#16161a; --line:#2a2a31; --text:#e6e6e6; --muted:#9a9aa5; --fail:#f14c4c; --pass:#23d18b; --skip:#c8a34a; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
.tw-header { padding:24px 28px 12px; border-bottom:1px solid var(--line); }
.tw-header h1 { margin:0 0 8px; font-size:20px; }
.tw-summary { margin:0; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.tw-pill { padding:2px 10px; border-radius:999px; font-size:12px; border:1px solid var(--line); }
.tw-pill.tw-failed { color:var(--fail); border-color:var(--fail); }
.tw-pill.tw-passed { color:var(--pass); border-color:var(--pass); }
.tw-pill.tw-skipped { color:var(--skip); border-color:var(--skip); }
.tw-generated { color:var(--muted); font-size:12px; }
main { padding:20px 28px 60px; display:flex; flex-direction:column; gap:14px; }
.tw-test { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:10px 14px; }
.tw-test.tw-failed { border-left:3px solid var(--fail); }
.tw-test.tw-passed { border-left:3px solid var(--pass); }
.tw-test.tw-skipped { border-left:3px solid var(--skip); }
summary { cursor:pointer; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
.tw-status { text-transform:uppercase; font-size:11px; letter-spacing:.08em; color:var(--muted); }
.tw-test.tw-failed .tw-status { color:var(--fail); }
.tw-title { font-weight:600; }
.tw-file, .tw-duration, .tw-note { color:var(--muted); font-size:12px; }
.tw-block { margin:16px 0; }
.tw-block h3 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.tw-error { background:#1c1315; border:1px solid #40232a; color:#ffb4b4; padding:10px; border-radius:6px; overflow-x:auto; white-space:pre-wrap; }
.tw-sentences { margin:0; padding-left:18px; }
.tw-sentences li { margin:2px 0; }
.tw-visual { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
.tw-screen { margin:0; }
.tw-screen figcaption { color:var(--muted); font-size:12px; margin-bottom:4px; }
.tw-grid { background:#141414; border:1px solid var(--line); border-radius:6px; padding:8px; overflow-x:auto; font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace; font-size:12px; line-height:1.25; white-space:pre; }
.tw-row { min-height:1.25em; }
.tw-row-changed { background:rgba(241,76,76,.16); box-shadow:inset 2px 0 0 var(--fail); }
.tw-crash h4 { margin:14px 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.tw-crash-head { margin:0; }
.tw-warn { margin:6px 0; padding:6px 10px; border-radius:6px; font-size:12px; color:#ffd8a8; background:rgba(200,163,74,.12); border:1px solid rgba(200,163,74,.4); }
.tw-crash-screen { background:#141414; border:1px solid var(--line); border-radius:6px; padding:8px; overflow-x:auto; font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace; font-size:12px; line-height:1.3; white-space:pre; margin:0; }
.tw-path { user-select:all; color:var(--text); }
.tw-logs { margin:0; padding:0; list-style:none; font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace; font-size:12px; line-height:1.5; background:#111; border:1px solid var(--line); border-radius:6px; padding:8px; overflow-x:auto; }
.tw-logs li { white-space:pre-wrap; border-left:2px solid transparent; padding-left:6px; }
.tw-log-at { color:var(--muted); }
.tw-log-label { color:#7fb3ff; }
.tw-log-warn { border-left-color:var(--skip); color:#f0d089; }
.tw-log-error, .tw-log-fatal { border-left-color:var(--fail); color:#ffb4b4; }
.tw-log-fatal { font-weight:700; }
.tw-log-row td:nth-child(2) { color:var(--muted); }
.tw-action-failed td:first-child { color:#ffb4b4; }
.tw-action-failed td:nth-child(2) { color:var(--fail); font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace; font-size:12px; }
.tw-log-row.tw-log-warn td:nth-child(2) { color:var(--skip); }
.tw-log-row.tw-log-error td:nth-child(2), .tw-log-row.tw-log-fatal td:nth-child(2) { color:var(--fail); }
.tw-shots { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
.tw-shot { margin:0; }
.tw-shot figcaption { color:var(--muted); font-size:12px; margin-bottom:4px; }
.tw-shot img { max-width:100%; border:1px solid var(--line); border-radius:6px; display:block; }
.tw-steps { border-collapse:collapse; font-size:13px; }
.tw-steps th, .tw-steps td { text-align:left; padding:3px 14px 3px 0; border-bottom:1px solid var(--line); }
.tw-step-failed td:nth-child(2) { color:var(--fail); }
.tw-player { max-width:960px; }
`;
