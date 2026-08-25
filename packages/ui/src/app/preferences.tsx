import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlaybackSpeed } from '../playback.js';
import type { EditorId } from '../editor-link.js';

export type TimelineDensity = 'compact' | 'comfortable';
export type InspectorTab = 'tree' | 'semantic' | 'logs';
export type MotionPreference = 'system' | 'reduce' | 'full';

export interface Preferences {
  readonly version: 1;
  readonly navigationExpanded: boolean;
  readonly timelineDensity: TimelineDensity;
  readonly autoFollowCurrentAction: boolean;
  readonly autoLiveReplay: boolean;
  readonly inspectorCollapsed: boolean;
  readonly inspectorTab: InspectorTab;
  readonly timelineCollapsed: boolean;
  readonly reducedMotion: MotionPreference;
  readonly railShare: number;
  readonly inspectorShare: number;
  readonly defaultReplaySpeed: PlaybackSpeed;
  readonly editor: EditorId;
  /** null means use the catalogue's conservative first-load expansion. */
  readonly specExpansion: readonly string[] | null;
}

interface PreferencesContextValue {
  readonly preferences: Preferences;
  readonly updatePreferences: (patch: Partial<Omit<Preferences, 'version'>>) => void;
  readonly resetLayout: () => void;
  readonly resetAll: () => void;
}

const STORAGE_KEY = 'termwright:preferences:v1';
const COOKIE_KEY = 'termwright_preferences_v1';

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  navigationExpanded: false,
  timelineDensity: 'compact',
  autoFollowCurrentAction: true,
  autoLiveReplay: true,
  inspectorCollapsed: true,
  inspectorTab: 'tree',
  timelineCollapsed: false,
  reducedMotion: 'system',
  railShare: .26,
  inspectorShare: .23,
  defaultReplaySpeed: 1,
  editor: 'vscode',
  specExpansion: null,
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { readonly children: ReactNode }) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const updatePreferences = useCallback((patch: Partial<Omit<Preferences, 'version'>>) => {
    setPreferences((current) => normalizePreferences({ ...current, ...patch, version: 1 }));
  }, []);
  const resetLayout = useCallback(() => {
    setPreferences((current) => ({
      ...current,
      navigationExpanded: DEFAULT_PREFERENCES.navigationExpanded,
      inspectorCollapsed: DEFAULT_PREFERENCES.inspectorCollapsed,
      timelineCollapsed: DEFAULT_PREFERENCES.timelineCollapsed,
      railShare: DEFAULT_PREFERENCES.railShare,
      inspectorShare: DEFAULT_PREFERENCES.inspectorShare,
      specExpansion: DEFAULT_PREFERENCES.specExpansion,
    }));
  }, []);
  const resetAll = useCallback(() => setPreferences(DEFAULT_PREFERENCES), []);

  useEffect(() => {
    const serialized = JSON.stringify(preferences);
    safeStorageSet(STORAGE_KEY, serialized);
    safeCookieSet(COOKIE_KEY, serialized);
  }, [preferences]);
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      try { setPreferences(normalizePreferences(JSON.parse(event.newValue))); } catch { /* Ignore a partial/corrupt write from another tab. */ }
    };
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.reducedMotion === 'system') root.removeAttribute('data-motion');
    else root.dataset['motion'] = preferences.reducedMotion;
  }, [preferences.reducedMotion]);

  const value = useMemo<PreferencesContextValue>(() => ({ preferences, updatePreferences, resetLayout, resetAll }), [preferences, resetAll, resetLayout, updatePreferences]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (value === null) throw new Error('PreferencesProvider is missing');
  return value;
}

export function normalizePreferences(value: unknown): Preferences {
  const input = isRecord(value) ? value : {};
  if ('version' in input && input['version'] !== 1) return DEFAULT_PREFERENCES;
  return {
    version: 1,
    navigationExpanded: boolean(input['navigationExpanded'], DEFAULT_PREFERENCES.navigationExpanded),
    timelineDensity: oneOf(input['timelineDensity'], ['compact', 'comfortable'] as const, DEFAULT_PREFERENCES.timelineDensity),
    autoFollowCurrentAction: boolean(input['autoFollowCurrentAction'], DEFAULT_PREFERENCES.autoFollowCurrentAction),
    autoLiveReplay: boolean(input['autoLiveReplay'], DEFAULT_PREFERENCES.autoLiveReplay),
    inspectorCollapsed: boolean(input['inspectorCollapsed'], DEFAULT_PREFERENCES.inspectorCollapsed),
    inspectorTab: oneOf(input['inspectorTab'], ['tree', 'semantic', 'logs'] as const, DEFAULT_PREFERENCES.inspectorTab),
    timelineCollapsed: boolean(input['timelineCollapsed'], DEFAULT_PREFERENCES.timelineCollapsed),
    reducedMotion: oneOf(input['reducedMotion'], ['system', 'reduce', 'full'] as const, DEFAULT_PREFERENCES.reducedMotion),
    railShare: boundedNumber(input['railShare'], .2, .42, DEFAULT_PREFERENCES.railShare),
    inspectorShare: boundedNumber(input['inspectorShare'], .2, .34, DEFAULT_PREFERENCES.inspectorShare),
    defaultReplaySpeed: oneOf(input['defaultReplaySpeed'], [.5, 1, 2, 4] as const, DEFAULT_PREFERENCES.defaultReplaySpeed),
    editor: oneOf(input['editor'], ['vscode', 'vscode-insiders', 'cursor', 'webstorm', 'zed', 'none'] as const, DEFAULT_PREFERENCES.editor),
    specExpansion: stringArrayOrNull(input['specExpansion']),
  };
}

function loadPreferences(): Preferences {
  const stored = safeStorageGet(STORAGE_KEY) ?? safeCookieGet(COOKIE_KEY);
  if (stored !== null) {
    try {
      return normalizePreferences(JSON.parse(stored));
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }
  return DEFAULT_PREFERENCES;
}

function safeStorageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function safeCookieGet(key: string): string | null {
  try {
    const prefix = `${key}=`;
    const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    return item === undefined ? null : decodeURIComponent(item.slice(prefix.length));
  } catch { return null; }
}

function safeCookieSet(key: string, value: string): void {
  try { document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`; } catch { /* file:// reports stay in memory. */ }
}

export function preferenceStorageAvailable(): boolean {
  const key = 'termwright:preferences:probe';
  try { localStorage.setItem(key, '1'); localStorage.removeItem(key); return true; } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

function oneOf<const T extends readonly (string | number)[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return values.includes(value as T[number]) ? value as T[number] : fallback;
}

function stringArrayOrNull(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 2_048))].slice(0, 2_000);
}
