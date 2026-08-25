import type { EffectiveSessionContract, SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import type { UiActionability } from '../../events.js';
import { Braces, Copy, FileText, MousePointerClick, PanelRightClose, Search, ShieldCheck, Waypoints } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { SessionRecord } from '../domain/model.js';
import { usePreferences, type InspectorTab } from '../preferences.js';
import { useTreeNavigation } from '../use-tree-navigation.js';
import { Tooltip } from './Tooltip.js';

type RecorderActions = {
  readonly onClickNode: (nodeId: string) => void;
  readonly onAssertNode: (nodeId: string) => void;
};

export function InspectorPanel({ session, recorder, onCollapsed, onPreviewNode, onPinNode, onInspectActionability }: {
  readonly session: SessionRecord | null;
  readonly onCollapsed: (collapsed: boolean) => void;
  readonly recorder?: RecorderActions;
  readonly onPreviewNode?: (node: SemanticNode | null, snapshot: SemanticSnapshot | null) => void;
  readonly onPinNode?: (node: SemanticNode, snapshot: SemanticSnapshot) => void;
  readonly onInspectActionability?: (sessionId: string, nodeId: string) => Promise<readonly UiActionability[]>;
}) {
  const { preferences, updatePreferences } = usePreferences();
  const tab = preferences.inspectorTab;
  const setTab = (next: InspectorTab) => updatePreferences({ inspectorTab: next });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [actionability, setActionability] = useState<{ readonly loading: boolean; readonly results?: readonly UiActionability[]; readonly error?: string }>({ loading: false });
  const snapshot = session?.snapshot ?? null;
  const nodes = snapshot?.nodes ?? [];
  useEffect(() => {
    if (selectedNodeId !== null && nodes.some((node) => node.id === selectedNodeId)) return;
    setSelectedNodeId(snapshot?.rootIds[0] ?? nodes[0]?.id ?? null);
  }, [nodes, selectedNodeId, snapshot?.rootIds]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  useEffect(() => {
    if (selectedNode === null || session === null || onInspectActionability === undefined) {
      setActionability({ loading: false });
      return;
    }
    let active = true;
    setActionability({ loading: true });
    void onInspectActionability(session.sessionId, selectedNode.id).then((results) => {
      if (active) setActionability({ loading: false, results });
    }).catch((cause: unknown) => {
      if (active) setActionability({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { active = false; };
  }, [onInspectActionability, selectedNode?.id, session?.revision, session?.sessionId]);

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
          <>
            <ContractSummary contract={session?.contract ?? null} />
            {selectedNode === null
              ? <InspectorEmpty icon={Braces} text="Select a semantic node in Tree" />
              : <SemanticDetail node={selectedNode} snapshot={snapshot} actionability={actionability} {...(recorder === undefined ? {} : { recorder })} />}
          </>
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

function ContractSummary({ contract }: { readonly contract: EffectiveSessionContract | null }) {
  if (contract === null) {
    return <section className="tw-contract-summary"><h3>Effective session contract</h3><p>Negotiation has not produced a semantic contract.</p></section>;
  }
  const supported = Object.entries(contract.capabilities).filter(([, value]) => value.status === 'supported');
  const unavailable = Object.entries(contract.capabilities).filter(([, value]) => value.status === 'unsupported');
  const supports = (id: keyof EffectiveSessionContract['capabilities']) => contract.capabilities[id].status === 'supported';
  const effective = [
    ['click', supports('pointer-input') && supports('pointer-geometry') && supports('pointer-hit-testing')],
    ['hover', supports('pointer-input') && supports('pointer-geometry') && supports('pointer-hit-testing')],
    ['drag', supports('pointer-input') && supports('pointer-geometry') && supports('pointer-hit-testing')],
    ['focus', supports('focus') && supports('keyboard-input')],
    ['type', supports('focus') && supports('keyboard-input')],
  ] as const;
  return <section className="tw-contract-summary" aria-label="Effective session contract">
    <header><div><span>{contract.protocol}</span><h3>{contract.framework === null ? 'Generic terminal' : `${contract.framework.name} ${contract.framework.version}`}</h3></div><CopyButton label="Copy contract id" value={contract.contractId} /></header>
    <p>{contract.framework === null ? 'No framework adapter' : `Certified adapter ${contract.framework.certificationId}`}</p>
    <dl className="tw-property-grid">
      <Property label="epoch" value={String(contract.epoch)} />
      <Property label="terminal" value={`${contract.terminal.profile} · ${contract.terminal.platform}`} />
      <Property label="mouse modes" value={contract.terminal.mouseModesObservable ? 'observable' : 'unobservable'} />
      <Property label="pointer input" value={supports('pointer-input') ? 'supported; current mouse mode is a runtime precondition' : 'unsupported'} />
    </dl>
    <h4>Effective API contract</h4>
    <ul className="tw-effective-api">{effective.map(([action, available]) => <li key={action} data-available={available}><span>{available ? '✓' : '–'}</span><strong>{action}</strong><small>{available ? 'contract supported' : 'required capability unavailable'}</small></li>)}</ul>
    <h4>Available API evidence</h4>
    <ul className="tw-contract-capabilities">{supported.map(([id, value]) => value.status === 'supported' ? <li key={id}><strong>{id}</strong><span>{value.evidence.source}/{value.evidence.method} · {value.evidence.strength}</span><small>{value.evidence.providerId}</small></li> : null)}</ul>
    {contract.providers.filter((provider) => provider.kind === 'application').length === 0 ? null : <><h4>Application providers</h4><ul className="tw-contract-capabilities">{contract.providers.filter((provider) => provider.kind === 'application').map((provider) => <li key={provider.id}><strong>{provider.id}@{provider.version}</strong><span>{provider.kind === 'application' ? provider.capabilities.join(', ') : ''}</span></li>)}</ul></>}
    {unavailable.length === 0 ? null : <details><summary>{unavailable.length} unsupported capabilities</summary><ul>{unavailable.map(([id, value]) => value.status === 'unsupported' ? <li key={id}>{id}: {value.reason}</li> : null)}</ul></details>}
  </section>;
}

function SemanticTree({ snapshot, selectedNodeId, onSelect, recorder, onPreviewNode, onPinNode }: {
  readonly snapshot: SemanticSnapshot;
  readonly selectedNodeId: string | null;
  readonly onSelect: (nodeId: string) => void;
  readonly recorder?: RecorderActions;
  readonly onPreviewNode?: (node: SemanticNode | null, snapshot: SemanticSnapshot | null) => void;
  readonly onPinNode?: (node: SemanticNode, snapshot: SemanticSnapshot) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const children = new Map<string, SemanticNode[]>();
  for (const node of snapshot.nodes) {
    if (node.parentId === undefined) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const roots = snapshot.rootIds.map((id) => byId.get(id)).filter((node): node is SemanticNode => node !== undefined);
  const rows = useMemo(() => {
    const visible: { readonly id: string; readonly parentId?: string; readonly hasChildren: boolean }[] = [];
    const append = (node: SemanticNode) => {
      const descendants = children.get(node.id) ?? [];
      visible.push({ id: node.id, ...(node.parentId === undefined ? {} : { parentId: node.parentId }), hasChildren: descendants.length > 0 });
      if (!collapsed.has(node.id)) descendants.forEach(append);
    };
    roots.forEach(append);
    return visible;
  }, [children, collapsed, roots]);
  const navigation = useTreeNavigation({ rows, selectedId: selectedNodeId, collapsed, onSelect, onCollapsed: setCollapsed });
  return <ul className="tw-semantic-tree" role="tree" aria-label="Semantic tree" onKeyDown={navigation.onKeyDown}>
    {roots.map((node) => <SemanticTreeNode key={node.id} node={node} snapshot={snapshot} children={children} selectedNodeId={navigation.activeId} onSelect={onSelect} collapsed={collapsed} item={navigation.item} {...(recorder === undefined ? {} : { recorder })} {...(onPreviewNode === undefined ? {} : { onPreviewNode })} {...(onPinNode === undefined ? {} : { onPinNode })} />)}
  </ul>;
}

function SemanticTreeNode({ node, snapshot, children, selectedNodeId, onSelect, collapsed, item, recorder, onPreviewNode, onPinNode }: {
  readonly node: SemanticNode;
  readonly snapshot: SemanticSnapshot;
  readonly children: ReadonlyMap<string, readonly SemanticNode[]>;
  readonly selectedNodeId: string | null;
  readonly onSelect: (nodeId: string) => void;
  readonly collapsed: ReadonlySet<string>;
  readonly item: ReturnType<typeof useTreeNavigation>['item'];
  readonly recorder?: RecorderActions;
  readonly onPreviewNode?: (node: SemanticNode | null, snapshot: SemanticSnapshot | null) => void;
  readonly onPinNode?: (node: SemanticNode, snapshot: SemanticSnapshot) => void;
}) {
  const descendants = children.get(node.id) ?? [];
  const open = !collapsed.has(node.id);
  const roving = item(node.id);
  const groupId = useId();
  return <li role="none">
    <div className="tw-semantic-node-row">
      <button ref={roving.ref} tabIndex={roving.tabIndex} type="button" role="treeitem" data-highlight-source="semantic" aria-selected={selectedNodeId === node.id} aria-expanded={descendants.length === 0 ? undefined : open} aria-owns={descendants.length > 0 && open ? groupId : undefined}
        onPointerEnter={() => onPreviewNode?.(node, snapshot)} onPointerLeave={() => onPreviewNode?.(null, null)}
        onFocus={() => { roving.onFocus(); onPreviewNode?.(node, snapshot); }} onBlur={() => onPreviewNode?.(null, null)}
        onClick={() => { onSelect(node.id); onPinNode?.(node, snapshot); }}>
        <span>{node.role}</span><strong>{node.name || node.id}</strong>
      </button>
      {recorder === undefined ? null : <NodeRecorderActions node={node} recorder={recorder} />}
    </div>
    {descendants.length === 0 || !open ? null : <ul id={groupId} role="group">{descendants.map((child) => <SemanticTreeNode key={child.id} node={child} snapshot={snapshot} children={children} selectedNodeId={selectedNodeId} onSelect={onSelect} collapsed={collapsed} item={item} {...(recorder === undefined ? {} : { recorder })} {...(onPreviewNode === undefined ? {} : { onPreviewNode })} {...(onPinNode === undefined ? {} : { onPinNode })} />)}</ul>}
  </li>;
}

function SemanticDetail({ node, snapshot, recorder, actionability }: { readonly node: SemanticNode; readonly snapshot: SemanticSnapshot | null; readonly recorder?: RecorderActions; readonly actionability: { readonly loading: boolean; readonly results?: readonly UiActionability[]; readonly error?: string } }) {
  const states = Object.entries(node.state ?? {}).filter(([, value]) => value !== undefined);
  const visibleRect = node.geometry.visibleRect.status === 'known' ? node.geometry.visibleRect.value : undefined;
  const intendedRect = node.geometry.intendedRect.status === 'known' ? node.geometry.intendedRect.value : undefined;
  const scroll = node.scroll?.status === 'known' ? node.scroll.value : undefined;
  const painted = node.paintedRegion?.status === 'known' ? node.paintedRegion.value : undefined;
  return <div className="tw-semantic-detail">
    <header><div><span>{node.role}</span><h3>{node.name || 'Unnamed node'}</h3></div><CopyButton label="Copy node ref" value={node.id} /></header>
    <div className="tw-state-chips">{states.length === 0 ? <em>no portable state</em> : states.map(([key, value]) => <span key={key} data-on={value === true}>{key}: {String(value)}</span>)}</div>
    <dl className="tw-property-grid">
      <Property label="ref" value={node.id} copy />
      <Property label="value" value={node.value?.status === 'known' && node.value.sensitivity === 'public' ? node.value.value : node.value?.status} />
      <Property label="description" value={node.description} />
      <Property label="test id" value={node.testId} copy />
      <Property label="framework" value={node.frameworkType} />
      <Property label="visible region" value={visibleRect === undefined ? node.geometry.visibleRect.status : `${visibleRect.column},${visibleRect.row} · ${visibleRect.width}×${visibleRect.height}`} />
      <Property label="intended region" value={intendedRect === undefined ? node.geometry.intendedRect.status : `${intendedRect.column},${intendedRect.row} · ${intendedRect.width}×${intendedRect.height}`} />
      <Property label="application scroll" value={scroll === undefined ? node.scroll?.status : `${scroll.axis} · ${scroll.offset}+${scroll.viewport}/${scroll.extent}`} />
      <Property label="painted region" value={painted === undefined ? node.paintedRegion?.status : `${painted.regionBounds.column},${painted.regionBounds.row} · ${painted.regionBounds.width}×${painted.regionBounds.height} · ${painted.spans.length} spans`} />
      <Property label="provenance" value={node.p} />
      <Property label="labelled by" value={node.labelledBy?.join(', ')} />
      <Property label="described by" value={node.describedBy?.join(', ')} />
    </dl>
    <section className="tw-semantic-actions"><h4>Capabilities</h4><div>{node.actions?.map((action) => <span key={action}>{action}</span>) ?? <em>none declared</em>}</div></section>
    <ActionabilityInspector state={actionability} />
    {recorder === undefined ? null : <section className="tw-semantic-actions"><h4>Recorder</h4><NodeRecorderActions node={node} recorder={recorder} labelled /></section>}
    {node.extended === undefined ? null : <details className="tw-semantic-extended"><summary>Extended application state</summary><pre>{JSON.stringify(node.extended, null, 2)}</pre></details>}
    <details className="tw-semantic-extended"><summary>View raw node</summary><div className="tw-raw-toolbar"><CopyButton label="Copy JSON" value={JSON.stringify(node, null, 2)} /></div><pre>{JSON.stringify(node, null, 2)}</pre></details>
    {snapshot === null ? null : <small className="tw-semantic-provenance">revision {snapshot.revision} · {snapshot.columns}×{snapshot.rows} · session {snapshot.sessionId}</small>}
  </div>;
}

function ActionabilityInspector({ state }: { readonly state: { readonly loading: boolean; readonly results?: readonly UiActionability[]; readonly error?: string } }) {
  return <section className="tw-live-actionability" aria-label="Live actionability">
    <h4>Live actionability</h4>
    {state.loading ? <p>Planning against the committed observation…</p> : state.error !== undefined ? <p role="status">Unavailable: {state.error}</p> : state.results === undefined ? <p>Select a live semantic node to inspect actions.</p> : <ul>{state.results.map((result) => <li key={result.kind} data-actionable={result.actionable}>
      <header><span>{result.actionable ? '✓' : '✗'}</span><strong>Can {result.kind}?</strong><small>revision {result.sequence}</small></header>
      <p>{result.actionable ? `Yes · ${result.strategy ?? 'production strategy'}` : result.reason === undefined ? 'No · requirements are inconclusive' : `No · ${result.reason.code}: ${result.reason.message}`}</p>
      <details><summary>Why?</summary><ul>{result.requirements.map((requirement, index) => <li key={`${requirement.kind}:${index}`} data-verdict={requirement.verdict}><span>{requirement.verdict === 'satisfied' ? '✓' : requirement.verdict === 'unsatisfied' ? '✗' : '?'}</span><strong>{requirement.kind}</strong><small>{requirement.observation}{requirement.evidence === undefined ? '' : ` · ${requirement.evidence.providerId}`}</small></li>)}</ul></details>
    </li>)}</ul>}
  </section>;
}

function NodeRecorderActions({ node, recorder, labelled = false }: { readonly node: SemanticNode; readonly recorder: RecorderActions; readonly labelled?: boolean }) {
  // Inline row actions mirror the labelled controls in Semantic detail. Keep
  // the mirrors out of the tree's tab sequence so the tree has one roving tab
  // stop; keyboard users retain the same actions in the selected-node panel.
  const tabIndex = labelled ? undefined : -1;
  const click = <button type="button" tabIndex={tabIndex} aria-label={`Record click on ${node.id}`} onClick={() => recorder.onClickNode(node.id)}><MousePointerClick aria-hidden="true" size={13} />{labelled ? 'Click' : null}</button>;
  const visible = <button type="button" tabIndex={tabIndex} aria-label={`Assert ${node.id} is visible`} onClick={() => recorder.onAssertNode(node.id)}><ShieldCheck aria-hidden="true" size={13} />{labelled ? 'Visible' : null}</button>;
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
