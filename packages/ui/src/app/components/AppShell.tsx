import {
  Clock3,
  FlaskConical,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { ProjectInfo } from '../../project.js';
import type { DataSourceFeatures } from '../../data-source.js';
import brandIcon from '../termwright-icon.svg';
import type { AppRoute } from '../domain/model.js';
import { usePreferences } from '../preferences.js';
import { Tooltip } from './Tooltip.js';

interface AppShellProps {
  readonly project: ProjectInfo | null;
  readonly route: AppRoute;
  readonly connected: boolean;
  readonly features: DataSourceFeatures;
  readonly onRoute: (route: AppRoute) => void;
  readonly children: ReactNode;
}

const navigation: readonly {
  readonly route: AppRoute;
  readonly label: string;
  readonly icon: typeof FlaskConical;
}[] = [
  { route: 'specs', label: 'Specs', icon: FlaskConical },
  { route: 'runner', label: 'Runner', icon: LayoutDashboard },
  { route: 'runs', label: 'Runs', icon: Clock3 },
  { route: 'settings', label: 'Settings', icon: Settings2 },
];

export function AppShell({
  project,
  route,
  connected,
  features,
  onRoute,
  children,
}: AppShellProps) {
  const { preferences, updatePreferences } = usePreferences();
  const navigationExpanded = preferences.navigationExpanded;
  const availableNavigation = navigation.filter(
    ({ route: destination }) =>
      (destination !== 'specs' || features.live) && (destination !== 'runs' || features.history),
  );
  return (
    <div className="tw-shell min-h-dvh" data-navigation-expanded={navigationExpanded}>
      <aside className="tw-nav" aria-label="Primary navigation">
        <div className="tw-brand">
          <img src={brandIcon} alt="" aria-hidden="true" />
          <div className="tw-brand-copy">
            <strong>termwright</strong>
            <span>{project?.name ?? 'terminal testing'}</span>
          </div>
        </div>

        <nav className="tw-nav-links">
          {availableNavigation.map(({ route: destination, label, icon: Icon }) => (
            <Tooltip key={destination} label={label} placement="right">
              <button
                type="button"
                className="tw-nav-link"
                data-current={route === destination}
                aria-current={route === destination ? 'page' : undefined}
                aria-label={label}
                onClick={() => onRoute(destination)}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </button>
            </Tooltip>
          ))}
        </nav>

        <Tooltip
          label={navigationExpanded ? 'Collapse navigation' : 'Expand navigation'}
          placement="right"
        >
          <button
            type="button"
            className="tw-nav-toggle"
            aria-label={navigationExpanded ? 'Collapse navigation' : 'Expand navigation'}
            onClick={() => updatePreferences({ navigationExpanded: !navigationExpanded })}
          >
            {navigationExpanded ? (
              <PanelLeftClose aria-hidden="true" size={17} />
            ) : (
              <PanelLeftOpen aria-hidden="true" size={17} />
            )}
            <span>{navigationExpanded ? 'Collapse' : 'Expand'}</span>
          </button>
        </Tooltip>

        <div
          className="tw-nav-foot"
          title={[project?.name, project?.branch].filter(Boolean).join(' · ')}
        >
          <span
            className="tw-connection-dot"
            data-connected={features.live ? connected : true}
            aria-hidden="true"
          />
          <span>
            {features.live
              ? connected
                ? 'Runner connected'
                : 'Waiting for runner'
              : 'Recording loaded'}
          </span>
        </div>
      </aside>

      <main className="tw-main">
        <h1 className="sr-only">
          {route === 'runner' ? 'Test run' : route[0]?.toUpperCase() + route.slice(1)}
        </h1>
        {children}
      </main>
    </div>
  );
}
