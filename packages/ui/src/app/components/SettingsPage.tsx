import { Clipboard, Gauge, RotateCcw, Settings2, SlidersHorizontal, TerminalSquare } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { DataSourceFeatures } from '../../data-source.js';
import { editorChoices } from '../../editor-link.js';
import type { AppState } from '../domain/model.js';
import { preferenceStorageAvailable, usePreferences, type Preferences } from '../preferences.js';

export function SettingsPage({ state, features }: { readonly state: AppState; readonly features: DataSourceFeatures }) {
  const { preferences, updatePreferences, resetLayout, resetAll } = usePreferences();
  const [confirmation, setConfirmation] = useState<'layout' | 'all' | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const storageAvailable = useMemo(preferenceStorageAvailable, []);
  const report = useMemo(() => buildDiagnosticReport(state, features, preferences, storageAvailable), [features, preferences, state, storageAvailable]);

  const confirmReset = () => {
    if (confirmation === 'layout') resetLayout();
    if (confirmation === 'all') resetAll();
    setConfirmation(null);
  };
  const copyDiagnostics = () => {
    void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => setCopyStatus('copied')).catch(() => setCopyStatus('failed'));
  };

  return <section className="tw-settings-page" aria-labelledby="settings-title">
    <header className="tw-page-toolbar"><div><h2 id="settings-title">Settings</h2></div><span>Applied immediately in this browser</span></header>
    <div className="tw-preferences-layout">
      <section className="tw-preference-section" aria-labelledby="workspace-settings">
        <header><SlidersHorizontal aria-hidden="true" size={15} /><div><h3 id="workspace-settings">Workspace</h3><p>Choose the starting layout. Manual splitter positions are remembered as ratios.</p></div></header>
        <Toggle label="Expanded navigation" description="Start desktop views with project labels visible." checked={preferences.navigationExpanded} onChange={(navigationExpanded) => updatePreferences({ navigationExpanded })} />
        <SelectSetting label="Timeline density" description="Compact keeps at least fourteen execution rows visible at 900px." value={preferences.timelineDensity} onChange={(timelineDensity) => updatePreferences({ timelineDensity: timelineDensity as Preferences['timelineDensity'] })}>
          <option value="compact">Compact</option><option value="comfortable">Comfortable</option>
        </SelectSetting>
        <Toggle label="Inspector starts open" description="Open the docked semantic inspector when the Runner loads." checked={!preferences.inspectorCollapsed} onChange={(open) => updatePreferences({ inspectorCollapsed: !open })} />
        <SelectSetting label="Preferred inspector view" description="The selected Tree, Semantic or Logs tab is shared across sessions." value={preferences.inspectorTab} onChange={(inspectorTab) => updatePreferences({ inspectorTab: inspectorTab as Preferences['inspectorTab'] })}>
          <option value="tree">Tree</option><option value="semantic">Semantic properties</option><option value="logs">Logs</option>
        </SelectSetting>
      </section>

      <section className="tw-preference-section" aria-labelledby="behaviour-settings">
        <header><Gauge aria-hidden="true" size={15} /><div><h3 id="behaviour-settings">Runner behaviour</h3><p>Control automatic movement without changing execution or recording data.</p></div></header>
        <Toggle label="Follow current action" description="Reveal the newest running or failed command until you scroll or collapse it." checked={preferences.autoFollowCurrentAction} onChange={(autoFollowCurrentAction) => updatePreferences({ autoFollowCurrentAction })} />
        <Toggle label="Open replay after LIVE" description="Swap the selected finished attempt to its retained replay automatically." checked={preferences.autoLiveReplay} onChange={(autoLiveReplay) => updatePreferences({ autoLiveReplay })} />
        <SelectSetting label="Motion" description="Respect the operating system, always reduce, or allow full motion." value={preferences.reducedMotion} onChange={(reducedMotion) => updatePreferences({ reducedMotion: reducedMotion as Preferences['reducedMotion'] })}>
          <option value="system">Follow system</option><option value="reduce">Reduce motion</option><option value="full">Full motion</option>
        </SelectSetting>
        <SelectSetting label="Default replay speed" description="Applied when a retained recording opens; the replay control can still change it." value={String(preferences.defaultReplaySpeed)} onChange={(value) => updatePreferences({ defaultReplaySpeed: Number(value) as Preferences['defaultReplaySpeed'] })}>
          <option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
        </SelectSetting>
        <SelectSetting label="Source editor" description="Used by Open source actions. Choose copy-only when URL schemes are unavailable." value={preferences.editor} onChange={(editor) => updatePreferences({ editor: editor as Preferences['editor'] })}>
          {editorChoices().map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </SelectSetting>
      </section>

      <section className="tw-preference-section" aria-labelledby="layout-settings">
        <header><TerminalSquare aria-hidden="true" size={15} /><div><h3 id="layout-settings">Evidence layout</h3><p>The terminal always fits an immutable tested grid; only its uniform scale changes.</p></div></header>
        <dl className="tw-settings-facts"><dt>Terminal</dt><dd>Fit · immutable columns × rows</dd><dt>Timeline width</dt><dd>{Math.round(preferences.railShare * 100)}%</dd><dt>Inspector width</dt><dd>{Math.round(preferences.inspectorShare * 100)}%</dd><dt>Persistence</dt><dd>{storageAvailable ? 'Browser storage + cross-port browser cookie' : 'In memory for this page'}</dd></dl>
        <button type="button" className="tw-secondary-button" onClick={() => setConfirmation('layout')}><RotateCcw aria-hidden="true" size={14} /> Reset layout</button>
      </section>

      <section className="tw-preference-section tw-diagnostics" aria-labelledby="diagnostics-settings">
        <header><Settings2 aria-hidden="true" size={15} /><div><h3 id="diagnostics-settings">Diagnostics</h3><p>Operational facts only. The copied report excludes URLs, tokens, paths, commands, output, logs, semantic content and errors.</p></div></header>
        <dl className="tw-settings-facts">
          <dt>Connection</dt><dd>{features.live ? (state.connected ? 'Connected' : 'Disconnected') : 'Offline report'}</dd>
          <dt>UI</dt><dd>termwright {state.project?.version ?? 'unknown'}</dd>
          <dt>Project</dt><dd>{state.project?.name ?? 'unknown'} · {state.project?.branch ?? 'detached'}</dd>
          <dt>Current run</dt><dd>{state.run.status} · {state.run.mode}</dd>
          <dt>Sessions</dt><dd>{Object.keys(state.sessions).length}</dd>
          <dt>Adapters</dt><dd>{adapterLabels(state).join(', ') || 'none reported'}</dd>
          <dt>Probes</dt><dd>{probeLabels(state).join(', ') || 'none reported'}</dd>
          <dt>Capabilities</dt><dd>{capabilityLabels(state, features).join(', ') || 'none reported'}</dd>
        </dl>
        <div className="tw-settings-actions"><button type="button" className="tw-secondary-button" onClick={copyDiagnostics}><Clipboard aria-hidden="true" size={14} /> Copy diagnostic report</button><span role="status">{copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Clipboard unavailable' : ''}</span></div>
        <button type="button" className="tw-danger-button" onClick={() => setConfirmation('all')}><RotateCcw aria-hidden="true" size={14} /> Reset all preferences</button>
      </section>
    </div>
    {confirmation === null ? null : <div className="tw-settings-confirm" role="dialog" aria-modal="true" aria-labelledby="reset-title">
      <h3 id="reset-title">{confirmation === 'layout' ? 'Reset workspace layout?' : 'Reset every preference?'}</h3>
      <p>{confirmation === 'layout' ? 'Panel widths and collapsed panes return to defaults. Behaviour and replay preferences stay unchanged.' : 'Layout and behaviour return to the shipped defaults.'}</p>
      <div><button type="button" className="tw-secondary-button" onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className="tw-danger-button" onClick={confirmReset}>Confirm reset</button></div>
    </div>}
  </section>;
}

function Toggle({ label, description, checked, onChange }: { readonly label: string; readonly description: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }) {
  return <label className="tw-setting-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} /></label>;
}

function SelectSetting({ label, description, value, onChange, children }: { readonly label: string; readonly description: string; readonly value: string; readonly onChange: (value: string) => void; readonly children: ReactNode }) {
  return <label className="tw-setting-row"><span><strong>{label}</strong><small>{description}</small></span><select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{children}</select></label>;
}

export function buildDiagnosticReport(state: AppState, features: DataSourceFeatures, preferences: Preferences, storageAvailable: boolean): unknown {
  const sessions = Object.values(state.sessions);
  const providers = counts(state.catalog.map((test) => test.provider ?? 'unreported'));
  const kinds = counts(state.catalog.map((test) => test.kind));
  return {
    schema: 1,
    ui: { version: state.project?.version ?? 'unknown', protocol: 1 },
    connection: { mode: features.live ? 'live' : 'offline', connected: features.live ? state.connected : null, canRun: state.canRun },
    features: { live: features.live, history: features.history, openTrace: features.openTrace },
    run: { status: state.run.status, mode: state.run.mode, summary: state.run.summary, executionCount: state.executions.length },
    catalog: { total: state.catalog.length, providers, kinds },
    sessions: {
      count: sessions.length,
      grids: [...new Set(sessions.map((session) => `${session.columns}x${session.rows}`))],
      terminalProfiles: [...new Set(sessions.map((session) => session.terminalProfile))],
      adapters: adapterLabels(state),
      probes: probeLabels(state),
      capabilities: capabilityLabels(state, features),
    },
    preferences,
    storageAvailable,
  };
}

function adapterLabels(state: AppState): string[] { return [...new Set(Object.values(state.sessions).flatMap((session) => session.contract?.framework === null || session.contract?.framework === undefined ? [] : [`${session.contract.framework.name}@${session.contract.framework.version}`]))]; }
function probeLabels(state: AppState): string[] { return adapterLabels(state); }
function capabilityLabels(state: AppState, features: DataSourceFeatures): string[] { return [...new Set([...Object.values(state.sessions).flatMap((session) => session.contract === undefined ? [] : Object.entries(session.contract.capabilities).filter(([, value]) => value.status === 'supported').map(([id]) => id)), ...(features.live ? ['live'] : []), ...(features.history ? ['history'] : []), ...(features.openTrace ? ['open-trace'] : [])])]; }
function counts(values: readonly string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
