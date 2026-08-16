/**
 * The Specs view: the project's tests as a tree of directories, with what the
 * history knows about each file beside it.
 *
 * The columns answer the three questions people actually open this list with —
 * did I just change this, does it usually pass, and is it slow — so that the
 * list is a place to decide from rather than a place to scroll.
 */

import { html, nothing, type TemplateResult } from 'lit-html';
import { relativeTime, type SpecDirectory, type SpecFile, type SpecNode } from '../spec-tree.js';
import { countTests } from '../test-model.js';
import type { TestRow } from '../test-model.js';
import { formatMs, statusGlyph } from '../view-model.js';
import { renderTestRow, type TestRowContext } from './test-row.js';

/** What the view shows. */
export interface SpecsModel {
  readonly tree: readonly SpecNode[];
  /** Every test, for the counters — not just the ones the filter kept. */
  readonly tests: readonly TestRow[];
  /** Text the list is filtered by. */
  readonly query: string;
  /** Files matching the filter, for the "N matches" count. */
  readonly matches: number;
  /** Directories the user has folded away, by path. */
  readonly collapsed: ReadonlySet<string>;
  /** File whose tests are shown, or `null` when none is open. */
  readonly openFile: string | null;
  readonly now: number;
  /** Whether tests can be started from here at all. */
  readonly canRun: boolean;
}

export interface SpecsHandlers {
  search(query: string): void;
  /** Run everything. */
  runAll(): void;
  /** Ask the runner to stop. */
  stop(): void;
  toggle(path: string): void;
  openFile(path: string | null): void;
  /** Run everything below a directory, or everything in a file. */
  run(paths: readonly string[]): void;
  /** Open the run a status dot stands for. */
  openRun(runId: string): void;
  /** The row context for the tests of an opened file. */
  rowContext(): TestRowContext;
}

/** Renders the Specs view. */
export function renderSpecs(model: SpecsModel, handlers: SpecsHandlers): TemplateResult {
  return html`
    <div class="specs" data-testid="specs">
      <div class="specs-search">
        ${renderCounts(model.tests)}
        <input
          type="search"
          data-testid="spec-filter"
          placeholder="Search specs"
          aria-label="Search specs"
          .value=${model.query}
          @input=${(event: Event) => handlers.search((event.target as HTMLInputElement).value)}
        />
        ${model.query === ''
          ? ''
          : html`<span class="muted" data-testid="spec-matches"
              >${model.matches} match${model.matches === 1 ? '' : 'es'}</span
            >`}
        ${model.canRun
          ? html`
              <button data-testid="rerun" title="Run every test again" @click=${() => handlers.runAll()}>
                Run all
              </button>
              <button data-testid="stop" @click=${() => handlers.stop()}>Stop</button>
            `
          : ''}
      </div>

      <div class="spec-columns" aria-hidden="true">
        <span>Spec</span>
        <span>Last updated</span>
        <span>Latest runs</span>
        <span>Average duration</span>
      </div>

      ${model.tree.length === 0
        ? html`<p class="empty" data-testid="specs-empty">
            ${model.query === ''
              ? 'No tests found yet. They appear as the project is listed, and as a run reports them.'
              : 'No spec matches that.'}
          </p>`
        : html`<ul class="spec-tree" role="tree" aria-label="Specs">
            ${model.tree.map((node) => renderNode(node, model, handlers, 1))}
          </ul>`}
    </div>
  `;
}

/**
 * How the run went, in one line.
 *
 * A zero is rendered as `--`: "nothing failed" and "zero failures" are the same
 * fact but not the same sentence, and the dash reads as nothing to look at
 * while a `0` reads as a measurement worth checking.
 */
function renderCounts(tests: readonly TestRow[]): TemplateResult {
  const counts = countTests(tests);
  const one = (kind: string, value: number, label: string): TemplateResult =>
    html`<span class=${`count ${kind}`} title=${`${value} ${label}`}>
      <span aria-hidden="true">${statusGlyph(kind)}</span>${value === 0 ? '--' : value}
    </span>`;
  return html`<span class="counts" data-testid="test-counts">
    ${one('passed', counts.passed, 'passed')} ${one('failed', counts.failed, 'failed')}
    ${counts.flaky === 0 ? '' : one('flaky', counts.flaky, 'flaky')}
    ${counts.skipped === 0 ? '' : one('skipped', counts.skipped, 'skipped')}
    ${counts.running === 0 ? '' : one('running', counts.running, 'running')}
    ${counts.notRun === 0 ? '' : one('not-run', counts.notRun, 'discovered, not run yet')}
  </span>`;
}

function renderNode(
  node: SpecNode,
  model: SpecsModel,
  handlers: SpecsHandlers,
  level: number,
): TemplateResult {
  return node.kind === 'directory'
    ? renderDirectory(node, model, handlers, level)
    : renderFile(node, model, handlers, level);
}

function renderDirectory(
  node: SpecDirectory,
  model: SpecsModel,
  handlers: SpecsHandlers,
  level: number,
): TemplateResult {
  const open = !model.collapsed.has(node.path);
  return html`
    <li role="treeitem" aria-expanded=${open} aria-level=${level}>
      <div class="spec-row directory" style=${indent(level)}>
        <button
          class="disclose"
          data-testid="spec-dir"
          @click=${() => handlers.toggle(node.path)}
          title=${open ? 'Collapse' : 'Expand'}
        >
          <span class="twisty" aria-hidden="true">${open ? '▾' : '▸'}</span>
          <span class="name">${node.name}</span>
          <span class="muted count">${node.testCount}</span>
        </button>
        ${model.canRun
          ? html`<button
              class="run-these"
              data-testid="run-directory"
              title=${`Run the ${node.testCount} tests under ${node.name}`}
              @click=${() => handlers.run(filesUnder(node))}
            >
              Run ${node.testCount} test${node.testCount === 1 ? '' : 's'}
            </button>`
          : ''}
      </div>
      ${open
        ? html`<ul role="group">
            ${node.children.map((child) => renderNode(child, model, handlers, level + 1))}
          </ul>`
        : ''}
    </li>
  `;
}

function renderFile(
  node: SpecFile,
  model: SpecsModel,
  handlers: SpecsHandlers,
  level: number,
): TemplateResult {
  const open = model.openFile === node.path;
  const facts = node.facts;
  return html`
    <li role="treeitem" aria-expanded=${open} aria-level=${level} aria-selected=${open}>
      <div class="spec-row file" style=${indent(level)}>
        <button
          class="disclose"
          data-testid="spec-file"
          @click=${() => handlers.openFile(open ? null : node.path)}
        >
          <span class="twisty" aria-hidden="true">${open ? '▾' : '▸'}</span>
          <span class="name">${node.name === '' ? '(no file reported)' : node.name}</span>
          <span class="muted count">${node.tests.length}</span>
        </button>
        <span class="col updated" title=${facts?.modifiedMs === undefined ? nothing : new Date(facts.modifiedMs ?? 0).toISOString()}>
          ${facts?.modifiedMs == null ? '—' : relativeTime(facts.modifiedMs, model.now)}
        </span>
        <span class="col latest" data-testid="spec-latest">
          ${facts === undefined || facts.latest.length === 0
            ? html`<span class="muted">never run</span>`
            : facts.latest.map(
                (run) => html`<button
                  class=${`dot ${run.status}`}
                  data-testid="spec-dot"
                  title=${`${run.status} — open this run`}
                  @click=${() => handlers.openRun(run.runId)}
                >
                  <span aria-hidden="true">${statusGlyph(run.status)}</span>
                  <span class="sr-only">${run.status}</span>
                </button>`,
              )}
        </span>
        <span class="col average">${facts?.averageMs == null ? '—' : formatMs(facts.averageMs)}</span>
        ${model.canRun
          ? html`<button
              class="run-these"
              data-testid="run-file"
              title=${`Run ${node.name}`}
              @click=${() => handlers.run([node.path])}
            >
              Run
            </button>`
          : ''}
      </div>
      ${open
        ? html`<ul role="group">
            ${node.tests.map(
              (test) => html`<li role="none" class="spec-test" style=${indent(level + 1)}>
                ${renderTestRow(test, handlers.rowContext())}
              </li>`,
            )}
          </ul>`
        : ''}
    </li>
  `;
}

/** Files under a directory, at any depth. */
export function filesUnder(node: SpecDirectory): readonly string[] {
  const files: string[] = [];
  for (const child of node.children) {
    if (child.kind === 'file') files.push(child.path);
    else files.push(...filesUnder(child));
  }
  return files;
}

/** Depth as padding, so the tree reads as a tree without nested boxes. */
function indent(level: number): string {
  return `padding-left:${(level - 1) * 14 + 8}px`;
}
