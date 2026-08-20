import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import { Braces, Copy, FileText, MousePointerClick, PanelRightClose, Search, ShieldCheck, Waypoints } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { SessionRecord } from '../domain/model.js';
import { usePreferences, type InspectorTab } from '../preferences.js';
import { Tooltip } from './Tooltip.js';

type RecorderActions = {
  readonly onClickNode: (nodeId: string) => void;
  readonly onAssertNode: (nodeId: string) => void;
};

export function InspectorPanel({ session, recorder, onCollapsed, onPreviewNode, onPinNode }: {
  readonly session: SessionRecord | null;
  readonly onCollapsed: (collapsed: boolean) => void;
  readonly recorder?: RecorderActions;
  readonly onPreviewNode?: (node: SemanticNode | null, snapshot: SemanticSnapshot | null) => void;
  readonly onPinNode?: (node: SemanticNode, snapshot: SemanticSnapshot) => void;
}) {
  const { preferences, updatePreferences } = usePreferences();
  const tab = preferences.inspectorTab;
  const setTab = (next: InspectorTab) => updatePreferences({ inspectorTab: next });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const snapshot = session?.snapshot ?? null;
  const nodes = snapshot?.nodes ?? [];
  useEffect(() => {
    if (selectedNodeId !== null && nodes.some((node) => node.id === selectedNodeId)) return;
    setSelectedNodeId(snapshot?.rootIds[0] ?? nodes[0]?.id ?? null);
  }, [nodes, selectedNodeId, snapshot?.rootIds]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  return (
    <section className="tw-inspector" aria-label="Execution inspector">
      <header className="tw-inspector-tabs" role="tablist" aria-label="Inspector views" onKeyDown={(event) => moveTab(event, tab, setTab)}>
        <InspectorTabButton tab="tree" current={tab} onSelect={setTab} icon={Waypoints}>Tree</InspectorTabButton>
        <InspectorTabButton tab="semantic" current={tab} onSelect={setTab} icon={Braces}>Semantic</InspectorTabButton>
        <InspectorTabButton tab="logs" current={tab} onSelect={setTab} icon={FileText}>Logs</InspectorTabButton>
        <span className="tw-revision">{session?.revision === null || session === null ? 'no revision' : `revision ${session.revision}`}</span>
        <Tooltip label="Collapse inspector"><button type="button" className="tw-inspector-control" aria-label="Collapse inspector" onClick={() => onCollapsed(true)}><PanelRightClose aria-hidden="true" size={14} /></button></Tooltip>
      </header>
      <div className="tw-inspector-body" role="tabpanel" id={`tw-inspector-panel-${tab}`} aria-labelledby={`tw-inspector-tab-${tab}`}>
        {tab === 'tree' ? (
          snapshot === null || nodes.length === 0
            ? <InspectorEmpty icon={Waypoints} text="No semantic tree at this moment" />
            : <SemanticTree snapshot={snapshot} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} {...(recorder === undefined ? {} : { recorder })} {...(onPreviewNode === undefined ? {} : { onPreviewNode })} {...(onPinNode === undefined ? {} : { onPinNode })} />
        ) : tab === 'semantic' ? (
          selectedNode === null
            ? <InspectorEmpty icon={Braces} text="Select a semantic node in Tree" />
            : <SemanticDetail node={selectedNode} snapshot={snapshot} {...(recorder === undefined ? {} : { recorder })} />
        ) : session === null || session.logs.length === 0 ? (
          <InspectorEmpty icon={FileText} text="No application logs for this session" />
        ) : (
          <ol className="tw-log-list">
            {session.logs.map((log, index) => (
              <li key={`${log.t}:${log.seq ?? index}`} data-level={log.level ?? 'plain'}>
                <time>{formatTime(log.t)}</time><span>{log.level ?? log.source}</span><p>{log.message}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function SemanticTree({ snapshot, selectedNodeId, onSelect, recorder, onPreviewNode, onPinNode }: {
  readonly snapshot: SemanticSnapshot;
  readonly selectedNodeId: string | null;
  readonly onSelect: (nodeId: string) => void;
  readonly recorder?: RecorderActions;
  readonly onPreviewNode?: (node: SemanticNode | null, snapshot: SemanticSnapshot | null) => void;
  readonly onPinNode?: (node: SemanticNode, snapshot: SemanticSnapshot) => void;
}) {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const children = new Map<string, SemanticNode[]>();
  for (const node of snapshot.nodes) {
    if (node.parentId === undefined) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const roots = snapshot.rootIds.map((id) => byId.get(id)).filter((node): node is SemanticNode => node !== undefined);
  return <ul className="tw-semantic-tree" role="tree" aria-label="Semantic tree">
    {roots.map((node) => <SemanticTreeNode key={node.id} node={node} snapshot={snapshot} children={children} selectedNodeId={selectedNodeId} onSelect={onSelect} {...(recorder === undefined ? {} : { recorder })} {...(onPreviewNode === undefined ? {} : { onPreviewNode })} {...(onPinNode === undefined ? {} : { onPinNode })} />)}
  </ul>;
}

function SemanticTreeNode({ node, snapshot, children, selectedNodeId, onSelect, recorder, onPreviewNode, onPinNode }: {
  readonly node: SemanticNode;
  readonly snapshot: SemanticSnapshot;
  readonly children: ReadonlyMap<string, readonly SemanticNode[]>;
  readonly selectedNodeId: string | null;
  readonly onSelect: (nodeId: string) => void;
  readonly recorder?: RecorderActions;
  readonly onPreviewNode?: (node: SemanticNode | null, snapshot: SemanticSnapshot | null) => void;
  readonly onPinNode?: (node: SemanticNode, snapshot: SemanticSnapshot) => void;
}) {
  const descendants = children.get(node.id) ?? [];
  return <li role="none">
    <div className="tw-semantic-node-row">
      <button type="button" role="treeitem" data-highlight-source="semantic" aria-selected={selectedNodeId === node.id} aria-expanded={descendants.length === 0 ? undefined : true}
        onPointerEnter={() => onPreviewNode?.(node, snapshot)} onPointerLeave={() => onPreviewNode?.(null, null)}
        onFocus={() => onPreviewNode?.(node, snapshot)} onBlur={() => onPreviewNode?.(null, null)}
        onClick={() => { onSelect(node.id); onPinNode?.(node, snapshot); }}>
        <span>{node.role}</span><strong>{node.name || node.id}</strong>
      </button>
      {recorder === undefined ? null : <NodeRecorderActions node={node} recorder={recorder} />}
    </div>
    {descendants.length === 0 ? null : <ul role="group">{descendants.map((child) => <SemanticTreeNode key={child.id} node={child} snapshot={snapshot} children={children} selectedNodeId={selectedNodeId} onSelect={onSelect} {...(recorder === undefined ? {} : { recorder })} {...(onPreviewNode === undefined ? {} : { onPreviewNode })} {...(onPinNode === undefined ? {} : { onPinNode })} />)}</ul>}
  </li>;
}

function SemanticDetail({ node, snapshot, recorder }: { readonly node: SemanticNode; readonly snapshot: SemanticSnapshot | null; readonly recorder?: RecorderActions }) {
  const states = Object.entries(node.state ?? {}).filter(([, value]) => value !== undefined);
  return <div className="tw-semantic-detail">
    <header><div><span>{node.role}</span><h3>{node.name || 'Unnamed node'}</h3></div><CopyButton label="Copy node ref" value={node.id} /></header>
    <div className="tw-state-chips">{states.length === 0 ? <em>no portable state</em> : states.map(([key, value]) => <span key={key} data-on={value === true}>{key}: {String(value)}</span>)}</div>
    <dl className="tw-property-grid">
      <Property label="ref" value={node.id} copy />
      <Property label="value" value={node.value} />
      <Property label="description" value={node.description} />
      <Property label="test id" value={node.testId} copy />
      <Property label="framework" value={node.frameworkType} />
      <Property label="bounds" value={node.bounds === undefined ? undefined : `${node.bounds.column},${node.bounds.row} · ${node.bounds.width}×${node.bounds.height}`} />
      <Property label="occlusion" value={node.occlusion} />
      <Property label="provenance" value={node.p} />
      <Property label="labelled by" value={node.labelledBy?.join(', ')} />
      <Property label="described by" value={node.describedBy?.join(', ')} />
    </dl>
    <section className="tw-semantic-actions"><h4>Capabilities</h4><div>{node.actions?.map((action) => <span key={action}>{action}</span>) ?? <em>none declared</em>}</div></section>
    {recorder === undefined ? null : <section className="tw-semantic-actions"><h4>Recorder</h4><NodeRecorderActions node={node} recorder={recorder} labelled /></section>}
    {node.extended === undefined ? null : <details className="tw-semantic-extended"><summary>Extended application state</summary><pre>{JSON.stringify(node.extended, null, 2)}</pre></details>}
    <details className="tw-semantic-extended"><summary>View raw node</summary><div className="tw-raw-toolbar"><CopyButton label="Copy JSON" value={JSON.stringify(node, null, 2)} /></div><pre>{JSON.stringify(node, null, 2)}</pre></details>
    {snapshot === null ? null : <small className="tw-semantic-provenance">revision {snapshot.revision} · {snapshot.columns}×{snapshot.rows} · session {snapshot.sessionId}</small>}
  </div>;
}

function NodeRecorderActions({ node, recorder, labelled = false }: { readonly node: SemanticNode; readonly recorder: RecorderActions; readonly labelled?: boolean }) {
  const click = <button type="button" aria-label={`Record click on ${node.id}`} onClick={() => recorder.onClickNode(node.id)}><MousePointerClick aria-hidden="true" size={13} />{labelled ? 'Click' : null}</button>;
  const visible = <button type="button" aria-label={`Assert ${node.id} is visible`} onClick={() => recorder.onAssertNode(node.id)}><ShieldCheck aria-hidden="true" size={13} />{labelled ? 'Visible' : null}</button>;
  return <span className="tw-record-node-actions">
    {labelled ? click : <Tooltip label={`Record click on ${node.name || node.id}`}>{click}</Tooltip>}
    {labelled ? visible : <Tooltip label={`Assert ${node.name || node.id} is visible`}>{visible}</Tooltip>}
  </span>;
}

function Property({ label, value, copy = false }: { readonly label: string; readonly value: string | undefined; readonly copy?: boolean }) {
  if (value === undefined || value === '') return null;
  return <><dt>{label}</dt><dd><span>{value}</span>{copy ? <CopyButton label={`Copy ${label}`} value={value} /> : null}</dd></>;
}

function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  return <Tooltip label={label}><button type="button" className="tw-copy-field" aria-label={label} onClick={() => { void navigator.clipboard.writeText(value); }}><Copy aria-hidden="true" size={12} /></button></Tooltip>;
}

function InspectorTabButton({ tab, current, onSelect, icon: Icon, children }: { readonly tab: InspectorTab; readonly current: InspectorTab; readonly onSelect: (tab: InspectorTab) => void; readonly icon: typeof Search; readonly children: string }) {
  return <button id={`tw-inspector-tab-${tab}`} type="button" role="tab" aria-selected={tab === current} aria-controls={`tw-inspector-panel-${tab}`} tabIndex={tab === current ? 0 : -1} className="tw-inspector-tab" onClick={() => onSelect(tab)}><Icon aria-hidden="true" size={14} /> {children}</button>;
}

function moveTab(event: KeyboardEvent<HTMLElement>, current: InspectorTab, select: (tab: InspectorTab) => void): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs: readonly InspectorTab[] = ['tree', 'semantic', 'logs'];
  const index = tabs.indexOf(current);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const tab = tabs[next];
  if (tab === undefined) return;
  event.preventDefault();
  select(tab);
  requestAnimationFrame(() => document.getElementById(`tw-inspector-tab-${tab}`)?.focus());
}

function InspectorEmpty({ icon: Icon, text }: { readonly icon: typeof Search; readonly text: string }) {
  return <div className="tw-inspector-empty"><Icon aria-hidden="true" /><span>{text}</span></div>;
}

function formatTime(timeMs: number): string {
  return timeMs >= 1_000 ? `${(timeMs / 1_000).toFixed(1)}s` : `${Math.round(timeMs)}ms`;
}
