/** Machine-readable source of truth for geometry/visibility support. */
export interface FrameworkObservationCapabilities {
  readonly framework: 'generic' | 'textual' | 'opentui' | 'ink' | 'tview' | 'ratatui' | 'charm';
  readonly identity: 'stable' | 'frame-local' | 'none';
  readonly attached: 'supported';
  readonly displayed: 'supported' | 'conditional' | 'unsupported';
  readonly intendedRect: 'supported' | 'conditional' | 'unsupported';
  readonly visibleRect: 'supported' | 'conditional' | 'unsupported';
  readonly hitTest: 'supported' | 'conditional' | 'unsupported';
  readonly reason: string;
}

export type CapabilityAvailability = 'supported' | 'conditional' | 'unsupported';
export type GeometryOperation =
  | 'keyboard-actions'
  | 'pointer-actions'
  | 'toBeAttached'
  | 'toBeDetached'
  | 'toBeDisplayed'
  | 'toBeHidden'
  | 'toBeVisible'
  | 'toBeOffscreen'
  | 'toBeInViewport'
  | 'toReceivePointerEvents'
  | 'toHaveBounds'
  | 'toHaveSpatialRelation'
  | 'cellSnapshot';

export interface FrameworkOperationCapability {
  readonly framework: FrameworkObservationCapabilities['framework'];
  readonly operation: GeometryOperation;
  readonly availability: CapabilityAvailability;
  readonly reason: string;
}

export const FRAMEWORK_OBSERVATION_CAPABILITIES: readonly FrameworkObservationCapabilities[] = Object.freeze([
  { framework: 'generic', identity: 'none', attached: 'supported', displayed: 'supported', intendedRect: 'supported', visibleRect: 'supported', hitTest: 'conditional', reason: 'Grid matches are physical cells; pointer delivery still requires terminal mouse mode.' },
  { framework: 'textual', identity: 'stable', attached: 'supported', displayed: 'supported', intendedRect: 'supported', visibleRect: 'supported', hitTest: 'supported', reason: 'The compositor exposes intended/clipped regions and Screen.get_widget_at(), the same fresh-pointer routing lookup.' },
  { framework: 'opentui', identity: 'stable', attached: 'supported', displayed: 'supported', intendedRect: 'supported', visibleRect: 'unsupported', hitTest: 'supported', reason: 'The committed native hit grid proves fresh-pointer ownership; the renderer exposes no per-node visual clip rectangle.' },
  { framework: 'ink', identity: 'stable', attached: 'supported', displayed: 'supported', intendedRect: 'conditional', visibleRect: 'unsupported', hitTest: 'unsupported', reason: 'Intended bounds are conditional on a viewport-stable live region; Ink exposes neither clipping nor pointer ownership.' },
  { framework: 'tview', identity: 'stable', attached: 'supported', displayed: 'supported', intendedRect: 'supported', visibleRect: 'conditional', hitTest: 'unsupported', reason: 'Primitive rectangles do not identify the recipient after overlap.' },
  { framework: 'ratatui', identity: 'frame-local', attached: 'supported', displayed: 'conditional', intendedRect: 'supported', visibleRect: 'conditional', hitTest: 'unsupported', reason: 'Render areas are frame-local and buffer writes do not preserve widget ownership.' },
  { framework: 'charm', identity: 'frame-local', attached: 'supported', displayed: 'conditional', intendedRect: 'unsupported', visibleRect: 'unsupported', hitTest: 'unsupported', reason: 'Bubble Tea hands over a rendered string without attributable widget geometry.' },
]);

export function frameworkObservationCapabilities(framework: string): FrameworkObservationCapabilities | undefined {
  return FRAMEWORK_OBSERVATION_CAPABILITIES.find((entry) => entry.framework === framework);
}

const weakest = (...values: CapabilityAvailability[]): CapabilityAvailability =>
  values.includes('unsupported') ? 'unsupported' : values.includes('conditional') ? 'conditional' : 'supported';

/**
 * Normative operation matrix, derived from the fact registry. Documentation
 * validates against this export; adapters cannot gain an assertion merely by
 * changing prose.
 */
export const FRAMEWORK_OPERATION_CAPABILITIES: readonly FrameworkOperationCapability[] = Object.freeze(
  FRAMEWORK_OBSERVATION_CAPABILITIES.flatMap((row): FrameworkOperationCapability[] => {
    const visibility = weakest(row.displayed, row.visibleRect);
    const viewport = weakest(row.intendedRect, row.visibleRect);
    const reason = row.reason;
    return [
      { framework: row.framework, operation: 'keyboard-actions', availability: 'supported', reason: 'Keyboard input is sent through the PTY and does not require geometry.' },
      {
        framework: row.framework,
        operation: 'pointer-actions',
        availability: row.hitTest === 'unsupported' ? 'unsupported' : 'conditional',
        reason:
          row.hitTest === 'unsupported'
            ? reason
            : 'Requires an exact hit recipient and terminal mouse reporting enabled by the application.',
      },
      { framework: row.framework, operation: 'toBeAttached', availability: 'supported', reason: 'Tree membership is observed directly.' },
      { framework: row.framework, operation: 'toBeDetached', availability: 'supported', reason: 'Tree absence is observed directly without coercing missing layout facts.' },
      { framework: row.framework, operation: 'toBeDisplayed', availability: row.displayed, reason },
      { framework: row.framework, operation: 'toBeHidden', availability: row.displayed, reason },
      { framework: row.framework, operation: 'toBeVisible', availability: visibility, reason },
      { framework: row.framework, operation: 'toBeOffscreen', availability: viewport, reason },
      { framework: row.framework, operation: 'toBeInViewport', availability: viewport, reason },
      { framework: row.framework, operation: 'toReceivePointerEvents', availability: row.hitTest, reason },
      { framework: row.framework, operation: 'toHaveBounds', availability: row.intendedRect, reason },
      { framework: row.framework, operation: 'toHaveSpatialRelation', availability: row.intendedRect, reason },
      { framework: row.framework, operation: 'cellSnapshot', availability: row.visibleRect, reason },
    ];
  }),
);
