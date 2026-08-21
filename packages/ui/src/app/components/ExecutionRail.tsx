import { AlertCircle, Check, ChevronDown, ChevronRight, CircleDot, FileCode2, LoaderCircle, PanelLeftClose, Play, RotateCcw, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { EvidenceState, ExecutionCase, ExecutionNode } from '../domain/model.js';
import type { TimelineDensity } from '../preferences.js';
import { StatusBadge } from './StatusBadge.js';
import { Tooltip } from './Tooltip.js';

interface ExecutionRailProps {
  readonly cases: readonly ExecutionCase[];
  readonly allCaseCount: number;
  readonly selectedExecutionId: string | null;
  readonly nodes: readonly ExecutionNode[];
  readonly pinnedNodeId: string | null;
  readonly evidence: EvidenceState;
  readonly autoFollow: boolean;
  readonly density: TimelineDensity;
  readonly onSelectCase: (executionId: string) => void;
  readonly onPreviewNode: (node: ExecutionNode | null) => void;
  readonly onPinNode: (node: ExecutionNode) => void;
  readonly onCollapse: () => void;
  readonly canRun: boolean;
  readonly connected: boolean;
  readonly runBusy: boolean;
  readonly runStatus: 'idle' | 'running' | 'stopping' | 'finished' | 'cancelled';
  readonly onRun: (targets: readonly string[]) => void;
  readonly onStop: () => void;
}

interface TimelineSection {
  readonly sectionId: string;
  readonly label: string;
  readonly kind: 'body' | 'background' | 'hook' | 'step';
  readonly node: ExecutionNode | null;
  readonly status: ExecutionNode['status'];
  readonly startMs: number;
  readonly endMs?: number;
  readonly children: readonly TimelineItem[];
}

type TimelineItem = TimelineSection | ExecutionNode;

export function ExecutionRail(props: ExecutionRailProps) {
  const currentIndex = props.cases.findIndex((test) => test.executionId === props.selectedExecutionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(props.autoFollow);
  const [activeVisible, setActiveVisible] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedCases, setExpandedCases] = useState<ReadonlySet<string>>(() => new Set(props.selectedExecutionId === null ? [] : [props.selectedExecutionId]));
  const userCollapsedCases = useRef(new Set<string>());
  const activeNodeId = [...props.nodes].reverse().find((node) => node.status === 'running')?.nodeId;
  const failedTargets = [...new Set(props.cases.filter((test) => test.status === 'failed').map((test) => test.caseKey))];

  useEffect(() => setFollowing(props.autoFollow), [props.autoFollow]);
  useEffect(() => {
    if (!following || props.selectedExecutionId === null || userCollapsedCases.current.has(props.selectedExecutionId)) return;
    const selected = props.cases.find((test) => test.executionId === props.selectedExecutionId);
    if (selected?.status !== 'running') return;
    setExpandedCases((current) => current.has(selected.executionId) ? current : new Set([...current, selected.executionId]));
  }, [following, props.cases, props.selectedExecutionId]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (activeNodeId === undefined || scroller === null) {
      setActiveVisible(true);
      return;
    }
    const row = activeRow(scroller, activeNodeId);
    if (following && row !== null) scrollWithin(scroller, row);
    requestAnimationFrame(() => setActiveVisible(activeRowVisible(scroller, activeNodeId)));
  }, [activeNodeId, following, props.nodes.length]);

  return (
    <section className="tw-execution-rail" aria-label="Execution steps" data-density={props.density}>
      <div className="tw-rail-heading">
        <div><h2>Steps</h2></div>
        <RailCounters cases={props.cases} />
        <div className="tw-rail-actions">
          {props.runBusy ? (
            <button type="button" className="tw-rail-stop" disabled={props.runStatus !== 'running'} onClick={props.onStop}>
              <Square aria-hidden="true" size={11} />{props.runStatus === 'stopping' ? 'Stopping…' : props.runStatus === 'running' ? 'Stop' : 'Starting…'}
            </button>
          ) : props.canRun ? <>
            {failedTargets.length === 0 ? null : <button type="button" aria-label={`Rerun ${failedTargets.length} failed ${failedTargets.length === 1 ? 'case' : 'cases'}`} title="Rerun failed cases" disabled={!props.connected} onClick={() => props.onRun(failedTargets)}><RotateCcw aria-hidden="true" size={11} />{failedTargets.length}</button>}
            <button type="button" aria-label={`Run all ${props.allCaseCount} cases in the current CLI scope`} title="Run all cases in the current CLI scope" disabled={!props.connected || props.allCaseCount === 0} onClick={() => props.onRun([])}><Play aria-hidden="true" size={11} />All</button>
          </> : null}
        </div>
        <Tooltip label="Collapse execution timeline"><button type="button" className="tw-pane-collapse" aria-label="Collapse execution timeline" onClick={props.onCollapse}><PanelLeftClose aria-hidden="true" size={14} /></button></Tooltip>
      </div>

      <div
        className="tw-case-list"
        ref={scrollRef}
        role="listbox"
        aria-label="Cases in this run"
        onScroll={(event) => {
          if (activeNodeId === undefined) return;
          const visible = activeRowVisible(event.currentTarget, activeNodeId);
          setActiveVisible(visible);
          if (!visible) setFollowing(false);
        }}
        onKeyDown={(event) => {
          moveOptionFocus(event, props.cases.length, currentIndex);
        }}
      >
        {props.cases.length === 0 ? <EmptyRail /> : props.cases.map((test) => {
          const selected = test.executionId === props.selectedExecutionId;
          const expanded = expandedCases.has(test.executionId);
          const narrative = selected ? props.nodes : test.nodes;
          const progress = executionProgress(test, narrative);
          const caseSections = timelineSections(narrative);
          return (
            <article className="tw-case" data-selected={selected} data-status={test.status} data-scope-mismatch={test.scopeMismatch === true} key={test.executionId} role="none">
              <div className="tw-case-head">
                <button
                  type="button"
                  className="tw-case-button"
                  role="option"
                  aria-selected={selected}
                  aria-expanded={expanded}
                  data-execution-id={test.executionId}
                  onClick={() => {
                    props.onSelectCase(test.executionId);
                    setExpandedCases((current) => toggled(current, test.executionId));
                    if (expanded) {
                      userCollapsedCases.current.add(test.executionId);
                      setFollowing(false);
                    } else {
                      userCollapsedCases.current.delete(test.executionId);
                    }
                  }}
                >
                  <StatusBadge status={test.status} compact />
                  <span className="tw-case-title">
                    <strong>{leafTitle(test)}</strong>
                    <small><FileCode2 aria-hidden="true" size={11} />{caseContext(test)}</small>
                  </span>
                  <span className="tw-case-meta">{formatDuration(test.durationMs)}{test.scopeMismatch === true ? <span className="tw-case-scope-warning" aria-label="Execution reported outside requested scope" title="Execution reported outside requested scope"><AlertCircle aria-hidden="true" size={12} /></span> : null}</span>
                  {expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
                </button>
                {props.canRun && !props.runBusy ? <Tooltip label={`${test.status === 'queued' ? 'Run' : 'Rerun'} ${test.title}`} disabledReason="Runner connection is unavailable."><button type="button" className="tw-case-run" disabled={!props.connected} aria-label={`${test.status === 'queued' ? 'Run' : 'Rerun'} ${test.title}`} onClick={() => props.onRun([test.caseKey])}>{test.status === 'queued' ? <Play aria-hidden="true" size={12} /> : <RotateCcw aria-hidden="true" size={12} />}</button></Tooltip> : null}
              </div>

              {expanded ? (
                <div className="tw-case-story">
                  <div className="tw-case-facts">
                    <span>{test.provider ?? 'termwright'}</span><span>{kindName(test.kind)}</span><span>attempt {Math.max(test.attempt, 1)}</span><span>{formatDuration(test.durationMs) || 'in progress'}</span>
                    {test.scopeMismatch === true ? <span className="tw-scope-mismatch"><AlertCircle aria-hidden="true" size={11} /> outside requested scope</span> : null}
                    {test.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="tw-current-step"><span>{progress.current === null ? 'Execution narrative' : progress.current.label}</span><strong>{progress.completed}/{progress.total || '—'}</strong></div>
                  <div className="tw-case-progress" role="progressbar" aria-label={`${progress.completed} of ${progress.total} execution items complete`} aria-valuemin={0} aria-valuemax={Math.max(progress.total, 1)} aria-valuenow={progress.completed}>
                    <i style={{ width: `${progress.total === 0 ? 0 : progress.completed / progress.total * 100}%` }} />
                  </div>
                  <div className="tw-execution-narrative" role="tree" aria-label={`${test.title} execution`} onKeyDown={moveTreeFocus}>
                    {narrative.length === 0 ? (
                      <EmptyNarrative test={test} evidence={selected ? props.evidence : { kind: 'empty' }} />
                    ) : caseSections.map((section) => (
                      <SectionRow
                        key={section.sectionId}
                        section={section}
                        depth={0}
                        collapsed={collapsed}
                        pinnedNodeId={props.pinnedNodeId}
                        onToggle={(sectionId) => setCollapsed((current) => toggled(current, sectionId))}
                        onPreview={props.onPreviewNode}
                        onPin={props.onPinNode}
                      />
                    ))}
                  </div>
                  {test.priorFailures.length === 0 ? null : (
                    <details className="tw-retry-history">
                      <summary>{test.priorFailures.length} earlier {test.priorFailures.length === 1 ? 'attempt' : 'attempts'} failed</summary>
                      <ol>{test.priorFailures.map((failure) => <li key={failure.attempt}><strong>Attempt {failure.attempt}</strong><span>{firstLine(failure.errors[0] ?? 'Failure reason was not retained.')}</span>{failure.errors.length < 2 ? null : <details><summary>All reasons</summary><pre>{failure.errors.join('\n\n')}</pre></details>}</li>)}</ol>
                    </details>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
        <span className="tw-scroll-end" aria-hidden="true" />
      </div>
      {activeNodeId === undefined || activeVisible ? null : (
        <button type="button" className="tw-current-step-jump" aria-label="Scroll to the current running step" onClick={() => {
          if (props.selectedExecutionId !== null) {
            userCollapsedCases.current.delete(props.selectedExecutionId);
            setExpandedCases((current) => new Set([...current, props.selectedExecutionId as string]));
          }
          setFollowing(true);
          requestAnimationFrame(() => {
            const scroller = scrollRef.current;
            if (scroller === null) return;
            const row = activeRow(scroller, activeNodeId);
            if (row !== null) scrollWithin(scroller, row);
            setActiveVisible(activeRowVisible(scroller, activeNodeId));
          });
        }}>↓ Current step</button>
      )}
    </section>
  );
}

function RailCounters({ cases }: { readonly cases: readonly ExecutionCase[] }) {
  const counts = {
    passed: cases.filter((test) => test.status === 'passed').length,
    failed: cases.filter((test) => test.status === 'failed' || test.status === 'cancelled').length,
    running: cases.filter((test) => test.status === 'running').length,
    waiting: cases.filter((test) => test.status === 'queued' || test.status === 'skipped').length,
  };
  const facts = [
    { label: 'passed', value: counts.passed, icon: Check },
    { label: 'failed', value: counts.failed, icon: AlertCircle },
    { label: 'running', value: counts.running, icon: LoaderCircle },
    { label: 'waiting', value: counts.waiting, icon: CircleDot },
  ] as const;
  return <div className="tw-rail-counters" aria-label="Run status counts">
    <span className="sr-only">{facts.map((fact) => `${fact.value} ${fact.label}`).join(', ')}</span>
    {facts.filter((fact) => fact.value > 0).map(({ label, value, icon: Icon }) => (
      <span key={label} className="tw-rail-counter" data-tone={label} aria-label={`${value} ${label}`} title={`${value} ${label}`}>
        <Icon className={label === 'running' ? 'tw-spin' : undefined} aria-hidden="true" size={11} /><strong>{value}</strong>
      </span>
    ))}
  </div>;
}

function SectionRow({ section, depth, collapsed, pinnedNodeId, onToggle, onPreview, onPin }: {
  readonly section: TimelineSection;
  readonly depth: number;
  readonly collapsed: ReadonlySet<string>;
  readonly pinnedNodeId: string | null;
  readonly onToggle: (sectionId: string) => void;
  readonly onPreview: (node: ExecutionNode | null) => void;
  readonly onPin: (node: ExecutionNode) => void;
}) {
  const isCollapsed = collapsed.has(section.sectionId);
  const commands = commandCount(section.children);
  const duration = section.endMs === undefined ? '' : formatDuration(Math.max(0, section.endMs - section.startMs));
  const source = section.node?.gherkin?.source;
  return <div className="tw-timeline-section" role="none" data-depth={depth}>
    <button
      type="button"
      className="tw-section-row"
      role="treeitem"
      aria-expanded={!isCollapsed}
      aria-label={source === undefined ? undefined : `${section.label}, ${shortSource(source.file)}, line ${source.line}, column ${source.column}`}
      data-kind={section.kind}
      data-status={section.status}
      data-node-id={section.node?.nodeId}
      onPointerEnter={() => onPreview(sectionPreviewTarget(section))}
      onPointerLeave={() => onPreview(null)}
      onFocus={() => onPreview(sectionPreviewTarget(section))}
      onBlur={() => onPreview(null)}
      onClick={() => {
        onToggle(section.sectionId);
        onPin(sectionPreviewTarget(section));
      }}
    >
      {isCollapsed ? <ChevronRight aria-hidden="true" size={12} /> : <ChevronDown aria-hidden="true" size={12} />}
      <strong>{section.label}</strong>
      <span>{source === undefined ? '' : `L${source.line}:C${source.column} · `}{commands} {commands === 1 ? 'command' : 'commands'}</span>
      <time>{duration}</time>
    </button>
    {isCollapsed ? null : <div className="tw-section-children" role="group">
      {section.children.map((item, index) => isSection(item)
        ? <SectionRow key={item.sectionId} section={item} depth={depth + 1} collapsed={collapsed} pinnedNodeId={pinnedNodeId} onToggle={onToggle} onPreview={onPreview} onPin={onPin} />
        : <CommandRow key={item.nodeId} node={item} index={index + 1} depth={depth} pinned={pinnedNodeId === item.nodeId} onPreview={onPreview} onPin={onPin} />)}
    </div>}
  </div>;
}

function sectionPreviewTarget(section: TimelineSection): ExecutionNode {
  const descendants = sectionTargets(section.children);
  const active = descendants.filter((node) => node.targetRef !== undefined && (node.status === 'failed' || node.status === 'running'));
  if (active.length > 0) return active.at(-1) as ExecutionNode;
  const resolved = descendants.filter((node) => node.targetRef !== undefined);
  const refs = new Set(resolved.map((node) => node.targetRef));
  if (refs.size === 1) return resolved.at(-1) as ExecutionNode;
  const basis = section.node ?? ({ nodeId: section.sectionId, kind: 'action', label: section.label, status: section.status, startMs: section.startMs } satisfies ExecutionNode);
  return {
    ...basis,
    kind: 'action',
    targetIssue: refs.size === 0
      ? 'This step did not retain a resolved semantic target.'
      : `${refs.size} semantic targets were used in this step; choose a child command to highlight one.`,
  };
}

function sectionTargets(items: readonly TimelineItem[]): readonly ExecutionNode[] {
  return items.flatMap((item) => isSection(item) ? sectionTargets(item.children) : [item]);
}

function CommandRow({ node, index, depth, pinned, onPreview, onPin }: {
  readonly node: ExecutionNode;
  readonly index: number;
  readonly depth: number;
  readonly pinned: boolean;
  readonly onPreview: (node: ExecutionNode | null) => void;
  readonly onPin: (node: ExecutionNode) => void;
}) {
  return <div className="tw-command-entry" role="none" data-depth={depth}>
    <button
      type="button"
      className="tw-command-row"
      data-highlight-source="command"
      data-kind={node.kind}
      data-status={node.status}
      data-pinned={pinned}
      data-node-id={node.nodeId}
      role="treeitem"
      onPointerEnter={() => onPreview(node)}
      onPointerLeave={() => onPreview(null)}
      onFocus={() => onPreview(node)}
      onBlur={() => onPreview(null)}
      onClick={() => onPin(node)}
    >
      <span className="tw-command-index">{String(index).padStart(2, '0')}</span>
      <time>{formatClock(node.startMs)}</time>
      <span className="tw-kind-badge">{kindLabel(node.kind)}</span>
      <span className="tw-command-copy"><strong>{node.label}</strong>{node.selector === undefined && node.targetRef === undefined ? null : <small>{node.selector ?? node.targetRef}</small>}</span>
      <NodeStatus node={node} />
      {node.status === 'running' ? <span className="tw-command-progress" aria-hidden="true" /> : null}
    </button>
    {node.status === 'failed' ? <div className="tw-command-failure" role="alert">
      <strong>{firstLine(node.error ?? 'Action failed')}</strong>
      <details><summary>Failure details</summary><pre>{node.error ?? 'No error text was retained.'}</pre><dl><dt>ref</dt><dd>{node.targetRef ?? 'unavailable'}</dd><dt>selector</dt><dd>{node.selector ?? 'unavailable'}</dd></dl></details>
      {node.actionability === undefined ? null : <details className="tw-action-plan"><summary>Why this action was rejected</summary><dl><dt>contract</dt><dd>{node.actionability.contractId}</dd><dt>revision</dt><dd>{node.actionability.sequence}</dd><dt>reason</dt><dd>{node.actionability.reason === undefined ? 'inconclusive requirements' : `${node.actionability.reason.code}: ${node.actionability.reason.message}`}</dd></dl><ul className="tw-action-requirements">{node.actionability.requirements.map((requirement, requirementIndex) => <li key={`${requirement.kind}:${requirement.target ?? ''}:${requirementIndex}`} data-verdict={requirement.verdict}><span>{requirement.verdict === 'satisfied' ? '✓' : requirement.verdict === 'unsatisfied' ? '✗' : '?'}</span><strong>{requirement.kind}</strong><small>{requirement.target ?? requirement.observation}{requirement.evidence === undefined ? '' : ` · ${requirement.evidence.providerId}`}</small></li>)}</ul></details>}
    </div> : null}
    {node.actionPlan === undefined ? null : <details className="tw-action-plan">
      <summary>Physical action plan · {node.actionPlan.strategy}</summary>
      <dl><dt>contract</dt><dd>{node.actionPlan.contractId}</dd><dt>revision</dt><dd>{node.actionPlan.beforeSequence} → {node.actionPlan.afterSequence}</dd><dt>input</dt><dd>{node.actionPlan.operations.map((operation) => `${operation.modifiers?.join('+') ?? ''}${operation.modifiers?.length ? '+' : ''}${operation.device}.${operation.kind}`).join(' · ') || 'no input needed'}</dd>{node.actionPlan.physicalEvidence === undefined ? null : <><dt>physical evidence</dt><dd>{node.actionPlan.physicalEvidence.source}/{node.actionPlan.physicalEvidence.method} · {node.actionPlan.physicalEvidence.providerId}</dd></>}</dl>
      {node.actionPlan.requirements.length === 0 ? null : <ul className="tw-action-requirements">{node.actionPlan.requirements.map((requirement, requirementIndex) => <li key={`${requirement.kind}:${requirement.target ?? ''}:${requirementIndex}`} data-verdict={requirement.verdict}><span>{requirement.verdict === 'satisfied' ? '✓' : requirement.verdict === 'unsatisfied' ? '✗' : '?'}</span><strong>{requirement.kind}</strong><small>{requirement.target ?? requirement.observation}{requirement.evidence === undefined ? '' : ` · ${requirement.evidence.providerId}`}</small></li>)}</ul>}
    </details>}
  </div>;
}

function NodeStatus({ node }: { readonly node: ExecutionNode }) {
  if (node.status === 'running') return <span className="tw-row-status"><LoaderCircle className="tw-spin" aria-hidden="true" size={11} /> running</span>;
  if (node.status === 'failed') return <span className="tw-row-status"><AlertCircle aria-hidden="true" size={11} /> failed</span>;
  if (node.status === 'passed') return <span className="tw-row-status"><Check aria-hidden="true" size={11} /> passed</span>;
  return <span className="tw-row-status">waiting</span>;
}

function timelineSections(nodes: readonly ExecutionNode[]): readonly TimelineSection[] {
  const ids = new Set(nodes.map((node) => node.nodeId));
  const children = new Map<string, ExecutionNode[]>();
  for (const node of nodes) {
    if (node.parentId === undefined || node.parentId === 'body' || !ids.has(node.parentId)) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const roots = nodes.filter((node) => node.parentId === undefined || node.parentId === 'body' || !ids.has(node.parentId));
  const hookSections = roots.filter((node) => node.kind === 'hook').map((node) => sectionFromNode(node, children));
  const backgroundItems = roots
    .filter((node) => node.kind === 'step' && node.gherkin?.background === true)
    .map((node) => sectionFromNode(node, children));
  const background = backgroundItems.length === 0 ? [] : [sectionFromItems('background', 'Background', 'background', backgroundItems)];
  const bodyItems = roots
    .filter((node) => node.kind !== 'hook' && node.gherkin?.background !== true)
    .map((node) => structural(node) ? sectionFromNode(node, children) : node);
  const body = bodyItems.length === 0 ? [] : [sectionFromItems('body', 'Test body', 'body', bodyItems)];
  return [...hookSections, ...background, ...body].sort((left, right) => left.startMs - right.startMs);
}

function sectionFromNode(node: ExecutionNode, children: ReadonlyMap<string, readonly ExecutionNode[]>): TimelineSection {
  const items = (children.get(node.nodeId) ?? []).map((child) => structural(child) ? sectionFromNode(child, children) : child);
  return {
    sectionId: `section:${node.nodeId}`,
    label: node.label || (node.kind === 'hook' ? 'Hook' : 'Step'),
    kind: node.kind === 'hook' ? 'hook' : 'step',
    node,
    status: node.status,
    startMs: node.startMs,
    ...(node.endMs === undefined ? {} : { endMs: node.endMs }),
    children: items,
  };
}

function sectionFromItems(sectionId: string, label: string, kind: TimelineSection['kind'], children: readonly TimelineItem[]): TimelineSection {
  const nodes = flattenNodes(children);
  const startMs = Math.min(...nodes.map((node) => node.startMs));
  const ended = nodes.map((node) => node.endMs).filter((value): value is number => value !== undefined);
  const status: ExecutionNode['status'] = nodes.some((node) => node.status === 'failed') ? 'failed' : nodes.some((node) => node.status === 'running') ? 'running' : nodes.every((node) => node.status === 'passed') ? 'passed' : 'queued';
  return { sectionId, label, kind, node: null, status, startMs: Number.isFinite(startMs) ? startMs : 0, ...(ended.length === 0 ? {} : { endMs: Math.max(...ended) }), children };
}

function flattenNodes(items: readonly TimelineItem[]): readonly ExecutionNode[] {
  return items.flatMap((item) => isSection(item) ? [...(item.node === null ? [] : [item.node]), ...flattenNodes(item.children)] : [item]);
}

function commandCount(items: readonly TimelineItem[]): number { return items.reduce((count, item) => count + (isSection(item) ? commandCount(item.children) : 1), 0); }
function structural(node: ExecutionNode): boolean { return node.kind === 'step' || node.kind === 'hook' || node.kind === 'body'; }
function isSection(item: TimelineItem): item is TimelineSection { return 'sectionId' in item; }
function toggled(current: ReadonlySet<string>, value: string): ReadonlySet<string> { const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next; }
function firstLine(value: string): string { return value.split(/\r?\n/u, 1)[0] ?? value; }
function activeRow(scroller: HTMLElement, nodeId: string): HTMLElement | null { return scroller.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`); }
function activeRowVisible(scroller: HTMLElement, nodeId: string): boolean { const row = activeRow(scroller, nodeId); if (row === null) return false; const viewport = scroller.getBoundingClientRect(); const box = row.getBoundingClientRect(); return box.top >= viewport.top && box.bottom <= viewport.bottom; }
function scrollWithin(scroller: HTMLElement, row: HTMLElement): void {
  const viewport = scroller.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  if (box.top < viewport.top) scroller.scrollTop -= viewport.top - box.top + 1;
  else if (box.bottom > viewport.bottom) scroller.scrollTop += box.bottom - viewport.bottom + 1;
}
function EmptyRail() { return <div className="tw-empty-rail"><CircleDot aria-hidden="true" /><strong>No execution yet</strong><span>Choose a spec to watch its terminal story unfold here.</span></div>; }
function EmptyNarrative({ test, evidence }: { readonly test: ExecutionCase; readonly evidence: EvidenceState }) {
  if (test.status === 'running') return <div className="tw-node-waiting" data-state="waiting"><span className="tw-pulse-dot" />Waiting for the first driver action…</div>;
  if (evidence.kind === 'replay-loading' && evidence.executionId === test.executionId) return <div className="tw-node-waiting" data-state="loading"><span className="tw-pulse-dot" />Loading retained recording…</div>;
  if (evidence.kind === 'replay-error' && evidence.executionId === test.executionId) return <div className="tw-node-waiting" data-state="unavailable"><AlertCircle aria-hidden="true" />Recording unavailable: {firstLine(evidence.error)}</div>;
  if (test.traceRef !== undefined && evidence.kind === 'replay' && evidence.executionId === test.executionId) return <div className="tw-node-waiting" data-state="no-actions"><CircleDot aria-hidden="true" />No driver actions were recorded in this recording.</div>;
  if (test.traceRef !== undefined) return <div className="tw-node-waiting" data-state="available"><CircleDot aria-hidden="true" />A retained recording is available; open Replay to inspect it.</div>;
  return <div className="tw-node-waiting" data-state="no-actions"><CircleDot aria-hidden="true" />No driver actions were recorded for this case.{test.error === undefined ? null : <strong>{firstLine(test.error)}</strong>}</div>;
}
function leafTitle(test: ExecutionCase): string { return test.title.split(/\s*>\s*/u).at(-1) ?? test.title; }
function caseContext(test: ExecutionCase): string { const context = test.ancestors.map((item) => item.title).join(' · ') || shortSource(test.source.file); return `${context}${test.source.line === undefined ? '' : ` · L${test.source.line}`}`; }
function shortSource(file: string): string { return file.split(/[/\\]/).filter(Boolean).slice(-2).join('/'); }
function kindLabel(kind: ExecutionNode['kind']): string { return kind === 'assertion' ? 'ASSERT' : kind === 'input' ? 'INPUT' : kind === 'action' ? 'ACTION' : kind.toUpperCase(); }
function kindName(kind: ExecutionCase['kind']): string { return kind === 'test' ? 'test' : kind === 'gherkin-scenario' ? 'scenario' : 'outline example'; }
function formatClock(value: number): string { return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`; }
function formatDuration(value: number | undefined): string { return value === undefined ? '' : formatClock(value); }

function executionProgress(test: ExecutionCase, nodes: readonly ExecutionNode[]): { readonly completed: number; readonly total: number; readonly current: ExecutionNode | null } {
  const completed = nodes.filter((node) => node.status === 'passed' || node.status === 'failed').length;
  const current = [...nodes].reverse().find((node) => node.status === 'running' || node.status === 'failed') ?? null;
  return { completed, total: nodes.length, current: current ?? (test.status === 'running' ? nodes.at(-1) ?? null : null) };
}

function moveOptionFocus(event: KeyboardEvent, count: number, selectedIndex: number): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
  if (options.length === 0) return;
  event.preventDefault();
  const focused = options.indexOf(document.activeElement as HTMLElement);
  const origin = focused === -1 ? Math.max(selectedIndex, 0) : focused;
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : event.key === 'ArrowDown' ? Math.min(origin + 1, count - 1) : Math.max(origin - 1, 0);
  options[index]?.focus();
}

function moveTreeFocus(event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button[role="treeitem"]')];
  if (items.length === 0) return;
  event.preventDefault();
  const focused = items.indexOf(document.activeElement as HTMLElement);
  const origin = focused === -1 ? 0 : focused;
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? Math.min(origin + 1, items.length - 1) : Math.max(origin - 1, 0);
  items[index]?.focus();
}
