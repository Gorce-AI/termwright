/**
 * Executable capability graph shared by certification, negotiation tooling,
 * documentation and every public action surface.
 *
 * A producer declaration is not itself a public guarantee. Edges make the
 * complete path explicit: producer fact -> frozen session evidence -> runtime
 * prerequisite -> planning strategy/public consumer. Diagnostic facts never
 * unlock a public API.
 */

export const CAPABILITY_GRAPH_VERSION = 5 as const;

export const CAPABILITY_NODE_CATEGORIES = Object.freeze([
  'evidence',
  'input',
  'planning',
  'synchronization',
  'diagnostic',
] as const);
export type CapabilityNodeCategory = (typeof CAPABILITY_NODE_CATEGORIES)[number];

export const CAPABILITY_NODE_LAYERS = Object.freeze([
  'producer',
  'session',
  'runtime',
  'strategy',
  'public',
] as const);
export type CapabilityNodeLayer = (typeof CAPABILITY_NODE_LAYERS)[number];

export const CAPABILITY_EDGE_KINDS = Object.freeze([
  'produces',
  'requires',
  'requires-any',
  'runtime-requires',
  'diagnoses',
] as const);
export type CapabilityEdgeKind = (typeof CAPABILITY_EDGE_KINDS)[number];

export const ADAPTER_CAPABILITIES = Object.freeze([
  'tree',
  'intended-geometry',
  'clipped-geometry',
  'states',
  'focus-state',
  'actions',
  'action-recipes',
  'text-ranges',
  'render-revisions',
  'logs',
  'pointer-hit-grid',
] as const);
export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number];

export const PROBE_CAPABILITIES = Object.freeze([
  'stable-identity',
  'intended-rect',
  'visible-rect',
  'operations',
  'annotations',
  'frame-begin',
  'paint-order',
] as const);
export type ProbeCapability = (typeof PROBE_CAPABILITIES)[number];

export const EVIDENCE_PROVIDER_CAPABILITIES = Object.freeze([
  'pointer-regions',
  'hit-test',
  'focus-state',
  'action-recipes',
  'scroll-state',
  'painted-regions',
  'terminal-input-modes',
] as const);
export type EvidenceProviderCapability = (typeof EVIDENCE_PROVIDER_CAPABILITIES)[number];

export const EVIDENCE_PROVIDER_TYPES = Object.freeze([
  'pointer-evidence',
  'focus-evidence',
  'action-strategy',
  'scroll-evidence',
  'paint-evidence',
  'input-mode-evidence',
] as const);
export type EvidenceProviderType = (typeof EVIDENCE_PROVIDER_TYPES)[number];

export const SESSION_CAPABILITIES = Object.freeze([
  'semantic-tree',
  'stable-identity',
  'intended-geometry',
  'clipped-geometry',
  'painted-region',
  'pointer-geometry',
  'pointer-hit-testing',
  'focus',
  'scroll',
  'render-order',
  'action-strategies',
  'keyboard-input',
  'pointer-input',
  'focus-input',
  'paired-revisions',
] as const);
export type SessionCapabilityId = (typeof SESSION_CAPABILITIES)[number];

export const RUNTIME_PREREQUISITES = Object.freeze([
  'writable-pty',
  'terminal-input-modes-authoritative',
  'mouse-reporting-enabled',
  'mouse-motion-enabled',
  'focus-reporting-enabled',
  'committed-observation',
] as const);
export type RuntimePrerequisiteId = (typeof RUNTIME_PREREQUISITES)[number];

export const PUBLIC_CAPABILITY_CONSUMERS = Object.freeze([
  'locator.semantic-query',
  'locator.semantic-scroll',
  'locator.painted-region',
  'condition.attached',
  'condition.displayed',
  'condition.visible',
  'condition.in-viewport',
  'condition.focused',
  'condition.value',
  'action.click',
  'action.hover',
  'action.drag',
  'action.focus',
  'action.activate',
  'action.type',
  'action.fill',
  'action.check',
  'action.uncheck',
  'device.keyboard',
  'device.mouse',
  'device.window-focus',
  'checkpoint',
  'runner.inspector',
  'trace.action',
  'recorder.semantic-action',
  'mcp.semantic-action',
  'runner.diagnostics',
  'trace.diagnostics',
] as const);
export type PublicCapabilityConsumer = (typeof PUBLIC_CAPABILITY_CONSUMERS)[number];

export const CAPABILITY_CONFORMANCE_CLAIMS = Object.freeze([
  'claim.semantic-tree-authoritative',
  'claim.stable-identity-authoritative',
  'claim.intended-geometry-authoritative',
  'claim.clipped-geometry-authoritative',
  'claim.painted-region-authoritative',
  'claim.pointer-region-authoritative',
  'claim.pointer-hit-test-authoritative',
  'claim.focus-authoritative',
  'claim.scroll-authoritative',
  'claim.render-order-authoritative',
  'claim.action-strategy-authoritative',
  'claim.keyboard-real-pty',
  'claim.pointer-real-pty',
  'claim.focus-report-real-pty',
  'claim.paired-revisions',
  'claim.logs-diagnostic',
] as const);
export type CapabilityConformanceClaimId = (typeof CAPABILITY_CONFORMANCE_CLAIMS)[number];

export const CONDITION_KINDS = Object.freeze([
  'attached',
  'detached',
  'displayed',
  'hidden',
  'visible',
  'in-viewport',
  'offscreen',
  'receives-pointer',
  'pointer-region',
  'pointer-input',
  'mouse-input-enabled',
  'enabled',
  'disabled',
  'focused',
  'checked',
  'selected',
  'expanded',
  'collapsed',
  'value',
  'not',
  'all',
  'any',
] as const);
export type ConditionKind = (typeof CONDITION_KINDS)[number];

export type CapabilityNodeId =
  | `adapter.${AdapterCapability}`
  | `probe.${ProbeCapability}`
  | `provider.${EvidenceProviderCapability}`
  | `terminal.${'writable-pty' | 'input-modes-observable'}`
  | `session.${SessionCapabilityId}`
  | `runtime.${RuntimePrerequisiteId}`
  | `strategy.${'pointer-target' | 'keyboard-activate' | 'pointer-activate' | 'focus-by-pointer' | 'type-focused'}`
  | `public.${PublicCapabilityConsumer}`
  | `diagnostic.${'semantic-tree' | 'geometry' | 'render-order' | 'logs'}`;

export interface CapabilityRemediation {
  readonly code:
    | 'select-certified-adapter'
    | 'register-application-provider'
    | 'enable-terminal-runtime'
    | 'wait-for-committed-observation'
    | 'no-authoritative-producer';
  readonly message: string;
  readonly providerType?: EvidenceProviderType;
  readonly runtimePrerequisite?: RuntimePrerequisiteId;
}

export interface CapabilityGraphNode {
  readonly id: CapabilityNodeId;
  readonly category: CapabilityNodeCategory;
  readonly layer: CapabilityNodeLayer;
  readonly description: string;
  readonly conformanceClaims?: readonly CapabilityConformanceClaimId[];
  readonly conditions?: readonly ConditionKind[];
  readonly publicConsumer?: PublicCapabilityConsumer;
  readonly remediation: CapabilityRemediation;
}

export interface CapabilityGraphEdge {
  readonly from: CapabilityNodeId;
  readonly to: CapabilityNodeId;
  readonly kind: CapabilityEdgeKind;
}

const certified = (message: string): CapabilityRemediation =>
  Object.freeze({
    code: 'select-certified-adapter' as const,
    message,
  });
const provider = (providerType: EvidenceProviderType, message: string): CapabilityRemediation =>
  Object.freeze({
    code: 'register-application-provider' as const,
    providerType,
    message,
  });
const runtime = (
  runtimePrerequisite: RuntimePrerequisiteId,
  message: string,
): CapabilityRemediation =>
  Object.freeze({
    code: 'enable-terminal-runtime' as const,
    runtimePrerequisite,
    message,
  });
const settle = (): CapabilityRemediation =>
  Object.freeze({
    code: 'wait-for-committed-observation' as const,
    message: 'Wait for one paired committed observation before using this capability.',
  });
const producerNodes: readonly CapabilityGraphNode[] = [
  ...ADAPTER_CAPABILITIES.map((id) => ({
    id: `adapter.${id}` as CapabilityNodeId,
    category:
      id === 'render-revisions'
        ? ('synchronization' as const)
        : id === 'logs'
          ? ('diagnostic' as const)
          : ('evidence' as const),
    layer: 'producer' as const,
    description: `Certified adapter handshake fact: ${id}.`,
    remediation: certified(`Use an exact certified adapter which publishes ${id}.`),
  })),
  ...PROBE_CAPABILITIES.map((id) => ({
    id: `probe.${id}` as CapabilityNodeId,
    category:
      id === 'frame-begin'
        ? ('synchronization' as const)
        : id === 'operations' || id === 'annotations'
          ? ('diagnostic' as const)
          : ('evidence' as const),
    layer: 'producer' as const,
    description: `Framework probe fact: ${id}.`,
    remediation: certified(`Use exact certified instrumentation which publishes ${id}.`),
  })),
  ...EVIDENCE_PROVIDER_CAPABILITIES.map((id) => ({
    id: `provider.${id}` as CapabilityNodeId,
    category: 'evidence' as const,
    layer: 'producer' as const,
    description: `Authoritative application production-router fact: ${id}.`,
    remediation: provider(
      id === 'action-recipes'
        ? 'action-strategy'
        : id === 'focus-state'
          ? 'focus-evidence'
          : id === 'scroll-state'
            ? 'scroll-evidence'
            : id === 'painted-regions'
              ? 'paint-evidence'
              : id === 'terminal-input-modes'
                ? 'input-mode-evidence'
                : 'pointer-evidence',
      id === 'action-recipes'
        ? "Register an action-strategy provider backed by the application's production keybindings."
        : id === 'focus-state'
          ? "Register a focus-evidence provider backed by the application's production focus manager."
          : id === 'scroll-state'
            ? "Register a scroll-evidence provider backed by the application's production viewport model."
            : id === 'painted-regions'
              ? "Register a paint-evidence provider backed by the application's production painter."
              : id === 'terminal-input-modes'
                ? "Register an input-mode-evidence provider backed by the application's production terminal parser configuration."
                : `Register a pointer-evidence provider backed by the application's production router (${id}).`,
    ),
  })),
  {
    id: 'terminal.writable-pty',
    category: 'input',
    layer: 'producer',
    description: 'The native session owns a writable PTY input channel.',
    remediation: runtime('writable-pty', 'Launch the application in a writable real PTY.'),
  },
  {
    id: 'terminal.input-modes-observable',
    category: 'input',
    layer: 'producer',
    description: 'The terminal backend authoritatively observes application mouse modes.',
    remediation: runtime(
      'terminal-input-modes-authoritative',
      'Use a terminal backend that authoritatively observes terminal input modes.',
    ),
  },
];

const sessionNode = (
  id: SessionCapabilityId,
  category: CapabilityNodeCategory,
  claim: CapabilityConformanceClaimId,
  remediation: CapabilityRemediation,
): CapabilityGraphNode => ({
  id: `session.${id}`,
  category,
  layer: 'session',
  description: `Frozen session capability: ${id}.`,
  conformanceClaims: [claim],
  remediation,
});

const sessionNodes: readonly CapabilityGraphNode[] = [
  sessionNode(
    'semantic-tree',
    'evidence',
    'claim.semantic-tree-authoritative',
    certified('Use a certified semantic adapter.'),
  ),
  sessionNode(
    'stable-identity',
    'evidence',
    'claim.stable-identity-authoritative',
    certified('Use a certified retained-identity adapter or explicit SemanticKey contract.'),
  ),
  sessionNode(
    'intended-geometry',
    'evidence',
    'claim.intended-geometry-authoritative',
    certified('Use an adapter instrumented at the authoritative layout/render boundary.'),
  ),
  sessionNode(
    'clipped-geometry',
    'evidence',
    'claim.clipped-geometry-authoritative',
    certified('Use an adapter that publishes authoritative clipping.'),
  ),
  sessionNode(
    'painted-region',
    'evidence',
    'claim.painted-region-authoritative',
    provider(
      'paint-evidence',
      "Register a paint-evidence provider backed by the application's production painter.",
    ),
  ),
  sessionNode(
    'pointer-geometry',
    'evidence',
    'claim.pointer-region-authoritative',
    provider(
      'pointer-evidence',
      'Register the application production pointer router as a pointer-evidence provider.',
    ),
  ),
  sessionNode(
    'pointer-hit-testing',
    'evidence',
    'claim.pointer-hit-test-authoritative',
    provider(
      'pointer-evidence',
      'Register a pointer-evidence provider with authoritative hit testing.',
    ),
  ),
  sessionNode(
    'focus',
    'evidence',
    'claim.focus-authoritative',
    provider(
      'focus-evidence',
      "Use a certified adapter with focus-state or register the application's production focus manager.",
    ),
  ),
  sessionNode(
    'scroll',
    'evidence',
    'claim.scroll-authoritative',
    provider(
      'scroll-evidence',
      "Use a certified adapter with explicit scroll evidence or register the application's production viewport model.",
    ),
  ),
  sessionNode(
    'render-order',
    'evidence',
    'claim.render-order-authoritative',
    certified(
      'Use a certified adapter which guarantees render order for every applicable semantic node.',
    ),
  ),
  sessionNode(
    'action-strategies',
    'planning',
    'claim.action-strategy-authoritative',
    provider(
      'action-strategy',
      "Register the application's production keybindings as authoritative physical input recipes.",
    ),
  ),
  sessionNode(
    'keyboard-input',
    'input',
    'claim.keyboard-real-pty',
    runtime('writable-pty', 'Launch in a writable real PTY.'),
  ),
  sessionNode(
    'pointer-input',
    'input',
    'claim.pointer-real-pty',
    provider(
      'input-mode-evidence',
      "Use a backend that observes terminal modes or register the application's authoritative production parser configuration.",
    ),
  ),
  sessionNode(
    'focus-input',
    'input',
    'claim.focus-report-real-pty',
    provider(
      'input-mode-evidence',
      "Use a backend that observes terminal modes or register the application's authoritative production parser configuration.",
    ),
  ),
  sessionNode(
    'paired-revisions',
    'synchronization',
    'claim.paired-revisions',
    certified('Use an adapter with exact render revision markers.'),
  ),
];

const runtimeNodes: readonly CapabilityGraphNode[] = [
  {
    id: 'runtime.writable-pty',
    category: 'input',
    layer: 'runtime',
    description: 'PTY input remains writable.',
    remediation: runtime('writable-pty', 'Launch or retain a writable PTY.'),
  },
  {
    id: 'runtime.terminal-input-modes-authoritative',
    category: 'input',
    layer: 'runtime',
    description:
      "Terminal mouse mode state is authoritative, either observed from VT output or supplied by the application's production parser.",
    remediation: runtime(
      'terminal-input-modes-authoritative',
      'Use a backend with authoritative terminal mouse mode tracking or register input-mode evidence.',
    ),
  },
  {
    id: 'runtime.mouse-reporting-enabled',
    category: 'input',
    layer: 'runtime',
    description: 'The application currently enables compatible mouse reporting.',
    remediation: runtime(
      'mouse-reporting-enabled',
      'Enable terminal mouse reporting in the application.',
    ),
  },
  {
    id: 'runtime.mouse-motion-enabled',
    category: 'input',
    layer: 'runtime',
    description: 'The application currently requests unpressed pointer motion.',
    remediation: runtime(
      'mouse-motion-enabled',
      'Enable terminal any-event mouse motion reporting for hover.',
    ),
  },
  {
    id: 'runtime.focus-reporting-enabled',
    category: 'input',
    layer: 'runtime',
    description: 'The application currently enables terminal focus reports.',
    remediation: runtime(
      'focus-reporting-enabled',
      'Enable terminal focus reporting in the application.',
    ),
  },
  {
    id: 'runtime.committed-observation',
    category: 'synchronization',
    layer: 'runtime',
    description: 'Semantic and VT evidence share one committed checkpoint.',
    remediation: settle(),
  },
];

const publicNode = (
  consumer: PublicCapabilityConsumer,
  category: CapabilityNodeCategory,
  conditions: readonly ConditionKind[] = [],
  conformanceClaims: readonly CapabilityConformanceClaimId[],
): CapabilityGraphNode => ({
  id: `public.${consumer}`,
  category,
  layer: 'public',
  publicConsumer: consumer,
  description: `Public consumer ${consumer}.`,
  conditions,
  conformanceClaims,
  remediation: settle(),
});

const strategyNodes: readonly CapabilityGraphNode[] = [
  {
    id: 'strategy.pointer-target',
    category: 'planning',
    layer: 'strategy',
    description: 'Resolve an authoritative safe physical pointer target.',
    remediation: provider(
      'pointer-evidence',
      'Provide authoritative pointer regions, optionally with hit testing.',
    ),
  },
  {
    id: 'strategy.keyboard-activate',
    category: 'planning',
    layer: 'strategy',
    description: 'Activate through a framework-declared keyboard convention and real PTY input.',
    remediation: certified('Expose an authoritative semantic keyboard action convention.'),
  },
  {
    id: 'strategy.pointer-activate',
    category: 'planning',
    layer: 'strategy',
    description: 'Activate through a planned real pointer click.',
    remediation: provider('pointer-evidence', 'Provide authoritative pointer evidence.'),
  },
  {
    id: 'strategy.focus-by-pointer',
    category: 'planning',
    layer: 'strategy',
    description: 'Focus using a real planned pointer action.',
    remediation: provider(
      'pointer-evidence',
      'Provide authoritative pointer evidence for the focus target.',
    ),
  },
  {
    id: 'strategy.type-focused',
    category: 'planning',
    layer: 'strategy',
    description: 'Type only after authoritative element focus is known.',
    remediation: certified('Use an adapter that guarantees focus state.'),
  },
];

const publicNodes: readonly CapabilityGraphNode[] = [
  publicNode('locator.semantic-query', 'evidence', [], ['claim.semantic-tree-authoritative']),
  publicNode(
    'locator.semantic-scroll',
    'evidence',
    [],
    ['claim.scroll-authoritative', 'claim.paired-revisions'],
  ),
  publicNode(
    'locator.painted-region',
    'evidence',
    [],
    ['claim.painted-region-authoritative', 'claim.paired-revisions'],
  ),
  publicNode(
    'condition.attached',
    'evidence',
    ['attached', 'detached'],
    ['claim.semantic-tree-authoritative'],
  ),
  publicNode(
    'condition.displayed',
    'evidence',
    ['displayed', 'hidden'],
    ['claim.semantic-tree-authoritative'],
  ),
  publicNode(
    'condition.visible',
    'evidence',
    ['visible'],
    ['claim.clipped-geometry-authoritative'],
  ),
  publicNode(
    'condition.in-viewport',
    'evidence',
    ['in-viewport', 'offscreen'],
    ['claim.clipped-geometry-authoritative'],
  ),
  publicNode('condition.focused', 'evidence', ['focused'], ['claim.focus-authoritative']),
  publicNode('condition.value', 'evidence', ['value'], ['claim.semantic-tree-authoritative']),
  publicNode(
    'action.click',
    'planning',
    ['attached', 'enabled', 'visible', 'pointer-region', 'receives-pointer', 'mouse-input-enabled'],
    ['claim.pointer-region-authoritative', 'claim.pointer-real-pty', 'claim.paired-revisions'],
  ),
  publicNode(
    'action.hover',
    'planning',
    ['attached', 'visible', 'pointer-region', 'receives-pointer', 'mouse-input-enabled'],
    ['claim.pointer-region-authoritative', 'claim.pointer-real-pty'],
  ),
  publicNode(
    'action.drag',
    'planning',
    ['attached', 'enabled', 'visible', 'pointer-region', 'receives-pointer', 'mouse-input-enabled'],
    ['claim.pointer-region-authoritative', 'claim.pointer-real-pty'],
  ),
  publicNode(
    'action.focus',
    'planning',
    ['attached', 'enabled', 'displayed'],
    ['claim.keyboard-real-pty', 'claim.pointer-real-pty'],
  ),
  publicNode(
    'action.activate',
    'planning',
    ['attached', 'enabled', 'displayed'],
    ['claim.keyboard-real-pty', 'claim.pointer-real-pty'],
  ),
  publicNode(
    'action.type',
    'planning',
    ['attached', 'enabled', 'displayed', 'focused'],
    ['claim.focus-authoritative', 'claim.keyboard-real-pty'],
  ),
  publicNode(
    'action.fill',
    'planning',
    ['attached', 'enabled', 'displayed'],
    ['claim.focus-authoritative', 'claim.keyboard-real-pty'],
  ),
  publicNode(
    'action.check',
    'planning',
    ['attached', 'enabled', 'displayed', 'checked'],
    ['claim.keyboard-real-pty', 'claim.pointer-real-pty'],
  ),
  publicNode(
    'action.uncheck',
    'planning',
    ['attached', 'enabled', 'displayed', 'checked'],
    ['claim.keyboard-real-pty', 'claim.pointer-real-pty'],
  ),
  publicNode('device.keyboard', 'input', [], ['claim.keyboard-real-pty']),
  publicNode('device.mouse', 'input', [], ['claim.pointer-real-pty']),
  publicNode('device.window-focus', 'input', [], ['claim.focus-report-real-pty']),
  publicNode('checkpoint', 'synchronization', [], ['claim.paired-revisions']),
  publicNode('runner.inspector', 'diagnostic', [], ['claim.semantic-tree-authoritative']),
  publicNode(
    'trace.action',
    'diagnostic',
    [],
    ['claim.pointer-real-pty', 'claim.keyboard-real-pty'],
  ),
  publicNode('recorder.semantic-action', 'planning', [], ['claim.pointer-hit-test-authoritative']),
  publicNode(
    'mcp.semantic-action',
    'planning',
    [],
    ['claim.pointer-real-pty', 'claim.keyboard-real-pty'],
  ),
  publicNode('runner.diagnostics', 'diagnostic', [], ['claim.semantic-tree-authoritative']),
  publicNode('trace.diagnostics', 'diagnostic', [], ['claim.logs-diagnostic']),
];

const diagnosticNodes: readonly CapabilityGraphNode[] = [
  {
    id: 'diagnostic.semantic-tree',
    category: 'diagnostic',
    layer: 'session',
    description: 'Best-effort semantic tree for inspector diagnostics only.',
    conformanceClaims: ['claim.semantic-tree-authoritative'],
    remediation: certified('Use certified semantic evidence for public queries.'),
  },
  {
    id: 'diagnostic.geometry',
    category: 'diagnostic',
    layer: 'session',
    description: 'Best-effort geometry that cannot unlock actions.',
    conformanceClaims: ['claim.intended-geometry-authoritative'],
    remediation: certified('Use certified geometry evidence for action planning.'),
  },
  {
    id: 'diagnostic.render-order',
    category: 'diagnostic',
    layer: 'session',
    description: 'Best-effort paint order that cannot prove actionability.',
    conformanceClaims: ['claim.render-order-authoritative'],
    remediation: certified('Use a universally certified render-order producer.'),
  },
  {
    id: 'diagnostic.logs',
    category: 'diagnostic',
    layer: 'session',
    description: 'Structured application logs.',
    conformanceClaims: ['claim.logs-diagnostic'],
    remediation: certified('Use an adapter that negotiates structured logs.'),
  },
];

const edges: readonly CapabilityGraphEdge[] = [
  { from: 'adapter.tree', to: 'session.semantic-tree', kind: 'produces' },
  {
    from: 'probe.stable-identity',
    to: 'session.stable-identity',
    kind: 'produces',
  },
  {
    from: 'adapter.intended-geometry',
    to: 'session.intended-geometry',
    kind: 'produces',
  },
  {
    from: 'adapter.clipped-geometry',
    to: 'session.clipped-geometry',
    kind: 'produces',
  },
  { from: 'adapter.focus-state', to: 'session.focus', kind: 'produces' },
  { from: 'provider.focus-state', to: 'session.focus', kind: 'produces' },
  { from: 'provider.scroll-state', to: 'session.scroll', kind: 'produces' },
  {
    from: 'provider.painted-regions',
    to: 'session.painted-region',
    kind: 'produces',
  },
  {
    from: 'adapter.action-recipes',
    to: 'session.action-strategies',
    kind: 'produces',
  },
  {
    from: 'adapter.pointer-hit-grid',
    to: 'session.pointer-geometry',
    kind: 'produces',
  },
  {
    from: 'adapter.pointer-hit-grid',
    to: 'session.pointer-hit-testing',
    kind: 'produces',
  },
  {
    from: 'provider.pointer-regions',
    to: 'session.pointer-geometry',
    kind: 'produces',
  },
  {
    from: 'provider.hit-test',
    to: 'session.pointer-hit-testing',
    kind: 'produces',
  },
  {
    from: 'provider.action-recipes',
    to: 'session.action-strategies',
    kind: 'produces',
  },
  { from: 'probe.paint-order', to: 'session.render-order', kind: 'produces' },
  {
    from: 'probe.paint-order',
    to: 'diagnostic.render-order',
    kind: 'diagnoses',
  },
  { from: 'adapter.logs', to: 'diagnostic.logs', kind: 'diagnoses' },
  {
    from: 'terminal.writable-pty',
    to: 'session.keyboard-input',
    kind: 'produces',
  },
  {
    from: 'terminal.input-modes-observable',
    to: 'session.pointer-input',
    kind: 'produces',
  },
  {
    from: 'provider.terminal-input-modes',
    to: 'session.pointer-input',
    kind: 'produces',
  },
  {
    from: 'terminal.input-modes-observable',
    to: 'session.focus-input',
    kind: 'produces',
  },
  {
    from: 'provider.terminal-input-modes',
    to: 'session.focus-input',
    kind: 'produces',
  },
  {
    from: 'adapter.render-revisions',
    to: 'session.paired-revisions',
    kind: 'produces',
  },
  {
    from: 'terminal.writable-pty',
    to: 'runtime.writable-pty',
    kind: 'produces',
  },
  {
    from: 'terminal.input-modes-observable',
    to: 'runtime.terminal-input-modes-authoritative',
    kind: 'produces',
  },
  {
    from: 'provider.terminal-input-modes',
    to: 'runtime.terminal-input-modes-authoritative',
    kind: 'produces',
  },
  {
    from: 'session.pointer-geometry',
    to: 'strategy.pointer-target',
    kind: 'requires',
  },
  {
    from: 'runtime.committed-observation',
    to: 'strategy.pointer-target',
    kind: 'runtime-requires',
  },
  {
    from: 'strategy.pointer-target',
    to: 'strategy.pointer-activate',
    kind: 'requires',
  },
  {
    from: 'session.pointer-input',
    to: 'strategy.pointer-activate',
    kind: 'requires',
  },
  {
    from: 'runtime.terminal-input-modes-authoritative',
    to: 'strategy.pointer-activate',
    kind: 'runtime-requires',
  },
  {
    from: 'runtime.mouse-reporting-enabled',
    to: 'strategy.pointer-activate',
    kind: 'runtime-requires',
  },
  {
    from: 'session.keyboard-input',
    to: 'strategy.keyboard-activate',
    kind: 'requires',
  },
  {
    from: 'runtime.writable-pty',
    to: 'strategy.keyboard-activate',
    kind: 'runtime-requires',
  },
  {
    from: 'strategy.pointer-activate',
    to: 'strategy.focus-by-pointer',
    kind: 'requires',
  },
  { from: 'session.focus', to: 'strategy.type-focused', kind: 'requires' },
  {
    from: 'session.keyboard-input',
    to: 'strategy.type-focused',
    kind: 'requires',
  },
  {
    from: 'session.semantic-tree',
    to: 'public.locator.semantic-query',
    kind: 'requires',
  },
  {
    from: 'session.scroll',
    to: 'public.locator.semantic-scroll',
    kind: 'requires',
  },
  {
    from: 'runtime.committed-observation',
    to: 'public.locator.semantic-scroll',
    kind: 'runtime-requires',
  },
  {
    from: 'session.painted-region',
    to: 'public.locator.painted-region',
    kind: 'requires',
  },
  {
    from: 'runtime.committed-observation',
    to: 'public.locator.painted-region',
    kind: 'runtime-requires',
  },
  {
    from: 'session.semantic-tree',
    to: 'public.condition.attached',
    kind: 'requires',
  },
  {
    from: 'session.semantic-tree',
    to: 'public.condition.displayed',
    kind: 'requires',
  },
  {
    from: 'session.clipped-geometry',
    to: 'public.condition.visible',
    kind: 'requires',
  },
  {
    from: 'session.clipped-geometry',
    to: 'public.condition.in-viewport',
    kind: 'requires',
  },
  { from: 'session.focus', to: 'public.condition.focused', kind: 'requires' },
  {
    from: 'session.semantic-tree',
    to: 'public.condition.value',
    kind: 'requires',
  },
  {
    from: 'strategy.pointer-activate',
    to: 'public.action.click',
    kind: 'requires',
  },
  {
    from: 'strategy.pointer-target',
    to: 'public.action.hover',
    kind: 'requires',
  },
  {
    from: 'session.pointer-input',
    to: 'public.action.hover',
    kind: 'requires',
  },
  {
    from: 'runtime.terminal-input-modes-authoritative',
    to: 'public.action.hover',
    kind: 'runtime-requires',
  },
  {
    from: 'runtime.mouse-motion-enabled',
    to: 'public.action.hover',
    kind: 'runtime-requires',
  },
  {
    from: 'strategy.pointer-activate',
    to: 'public.action.drag',
    kind: 'requires',
  },
  {
    from: 'strategy.focus-by-pointer',
    to: 'public.action.focus',
    kind: 'requires-any',
  },
  {
    from: 'strategy.keyboard-activate',
    to: 'public.action.focus',
    kind: 'requires-any',
  },
  {
    from: 'strategy.pointer-activate',
    to: 'public.action.activate',
    kind: 'requires-any',
  },
  {
    from: 'strategy.keyboard-activate',
    to: 'public.action.activate',
    kind: 'requires-any',
  },
  { from: 'strategy.type-focused', to: 'public.action.type', kind: 'requires' },
  { from: 'public.action.focus', to: 'public.action.fill', kind: 'requires' },
  {
    from: 'session.keyboard-input',
    to: 'public.action.fill',
    kind: 'requires',
  },
  {
    from: 'public.action.activate',
    to: 'public.action.check',
    kind: 'requires',
  },
  {
    from: 'public.action.activate',
    to: 'public.action.uncheck',
    kind: 'requires',
  },
  {
    from: 'session.keyboard-input',
    to: 'public.device.keyboard',
    kind: 'requires',
  },
  {
    from: 'session.pointer-input',
    to: 'public.device.mouse',
    kind: 'requires',
  },
  {
    from: 'runtime.terminal-input-modes-authoritative',
    to: 'public.device.mouse',
    kind: 'runtime-requires',
  },
  {
    from: 'runtime.mouse-reporting-enabled',
    to: 'public.device.mouse',
    kind: 'runtime-requires',
  },
  {
    from: 'session.focus-input',
    to: 'public.device.window-focus',
    kind: 'requires',
  },
  {
    from: 'runtime.focus-reporting-enabled',
    to: 'public.device.window-focus',
    kind: 'runtime-requires',
  },
  {
    from: 'runtime.terminal-input-modes-authoritative',
    to: 'public.device.window-focus',
    kind: 'runtime-requires',
  },
  {
    from: 'session.paired-revisions',
    to: 'public.checkpoint',
    kind: 'requires',
  },
  {
    from: 'public.action.click',
    to: 'public.recorder.semantic-action',
    kind: 'requires',
  },
  {
    from: 'public.action.click',
    to: 'public.mcp.semantic-action',
    kind: 'requires',
  },
  {
    from: 'diagnostic.semantic-tree',
    to: 'public.runner.diagnostics',
    kind: 'diagnoses',
  },
  {
    from: 'diagnostic.geometry',
    to: 'public.runner.diagnostics',
    kind: 'diagnoses',
  },
  {
    from: 'diagnostic.logs',
    to: 'public.trace.diagnostics',
    kind: 'diagnoses',
  },
  {
    from: 'public.action.click',
    to: 'public.runner.inspector',
    kind: 'diagnoses',
  },
  { from: 'public.action.click', to: 'public.trace.action', kind: 'diagnoses' },
];

export const CAPABILITY_GRAPH = deepFreeze({
  version: CAPABILITY_GRAPH_VERSION,
  nodes: [
    ...producerNodes,
    ...sessionNodes,
    ...runtimeNodes,
    ...strategyNodes,
    ...publicNodes,
    ...diagnosticNodes,
  ],
  edges,
});

export interface CapabilityGraphValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/** Mechanical integrity gate used by protocol and registry tests. */
export function validateCapabilityGraph(): CapabilityGraphValidationResult {
  const errors: string[] = [];
  const nodes = new Map<CapabilityNodeId, CapabilityGraphNode>();
  for (const node of CAPABILITY_GRAPH.nodes) {
    if (nodes.has(node.id)) errors.push(`duplicate capability node ${node.id}`);
    nodes.set(node.id, node);
    if (!CAPABILITY_NODE_CATEGORIES.includes(node.category))
      errors.push(`invalid category on ${node.id}`);
    if (!CAPABILITY_NODE_LAYERS.includes(node.layer)) errors.push(`invalid layer on ${node.id}`);
    for (const claim of node.conformanceClaims ?? []) {
      if (!CAPABILITY_CONFORMANCE_CLAIMS.includes(claim))
        errors.push(`unknown claim ${claim} on ${node.id}`);
    }
    for (const condition of node.conditions ?? []) {
      if (!CONDITION_KINDS.includes(condition))
        errors.push(`unknown condition ${condition} on ${node.id}`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const edge of CAPABILITY_GRAPH.edges) {
    if (!nodes.has(edge.from)) errors.push(`edge source ${edge.from} is orphaned`);
    if (!nodes.has(edge.to)) errors.push(`edge target ${edge.to} is orphaned`);
    const key = `${edge.kind}:${edge.from}->${edge.to}`;
    if (edgeKeys.has(key)) errors.push(`duplicate edge ${key}`);
    edgeKeys.add(key);
  }
  for (const node of CAPABILITY_GRAPH.nodes) {
    if (
      (node.layer === 'session' || node.layer === 'public') &&
      (node.conformanceClaims?.length ?? 0) === 0
    ) {
      errors.push(`contract/public node ${node.id} has no mandatory conformance claim`);
    }
    if (node.remediation.code === 'register-application-provider') {
      const reachable = CAPABILITY_GRAPH.edges.some(
        (edge) =>
          edge.to === node.id && edge.from.startsWith('provider.') && edge.kind === 'produces',
      );
      if (!reachable && node.layer === 'session')
        errors.push(`impossible provider remediation on ${node.id}`);
    }
    if (
      node.remediation.code === 'enable-terminal-runtime' &&
      node.remediation.runtimePrerequisite === undefined
    ) {
      errors.push(`runtime remediation on ${node.id} has no prerequisite id`);
    }
  }
  const usedClaims = new Set(
    CAPABILITY_GRAPH.nodes.flatMap((node) => node.conformanceClaims ?? []),
  );
  for (const claim of CAPABILITY_CONFORMANCE_CLAIMS) {
    if (!usedClaims.has(claim)) errors.push(`orphan conformance claim ${claim}`);
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

export function capabilityNode(id: CapabilityNodeId): CapabilityGraphNode {
  const node = CAPABILITY_GRAPH.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new RangeError(`unknown capability graph node ${id}`);
  return node;
}

/** Generated, deterministic remediation for a missing graph node. */
export function capabilityRemediation(id: CapabilityNodeId): CapabilityRemediation {
  return capabilityNode(id).remediation;
}

export interface CapabilityResolution {
  readonly available: boolean;
  readonly target: CapabilityNodeId;
  readonly missing: readonly CapabilityNodeId[];
  readonly remediation: readonly CapabilityRemediation[];
}

/**
 * Resolves the frozen session facts produced by an exact set of negotiated
 * producer nodes. Only explicit `produces` edges may create a session
 * capability; similarly named adapter facts never imply extra guarantees.
 */
export function sessionCapabilitiesFromProducers(
  producers: ReadonlySet<CapabilityNodeId>,
): ReadonlyMap<SessionCapabilityId, readonly CapabilityNodeId[]> {
  const resolved = new Map<SessionCapabilityId, CapabilityNodeId[]>();
  for (const edge of CAPABILITY_GRAPH.edges) {
    if (edge.kind !== 'produces' || !edge.to.startsWith('session.') || !producers.has(edge.from))
      continue;
    const capability = edge.to.slice('session.'.length) as SessionCapabilityId;
    const current = resolved.get(capability) ?? [];
    current.push(edge.from);
    resolved.set(capability, current);
  }
  return new Map(
    [...resolved].map(([capability, sources]) => [
      capability,
      Object.freeze([...new Set(sources)].sort()),
    ]),
  );
}

/**
 * Resolve a strategy or public consumer against one already-negotiated
 * session/runtime node set. Session nodes are leaves: producer declarations do
 * not opportunistically unlock them after negotiation.
 */
export function resolveCapability(
  target: CapabilityNodeId,
  available: ReadonlySet<CapabilityNodeId>,
): CapabilityResolution {
  const visiting = new Set<CapabilityNodeId>();
  const resolve = (id: CapabilityNodeId): readonly CapabilityNodeId[] => {
    if (available.has(id)) return [];
    const node = capabilityNode(id);
    if (node.layer === 'producer' || node.layer === 'session' || node.layer === 'runtime')
      return [id];
    if (visiting.has(id)) throw new Error(`capability graph dependency cycle at ${id}`);
    visiting.add(id);
    const incoming = CAPABILITY_GRAPH.edges.filter(
      (edge) =>
        edge.to === id &&
        (edge.kind === 'requires' ||
          edge.kind === 'requires-any' ||
          edge.kind === 'runtime-requires'),
    );
    const mandatory = incoming
      .filter(({ kind }) => kind !== 'requires-any')
      .flatMap(({ from }) => resolve(from));
    const alternatives = incoming
      .filter(({ kind }) => kind === 'requires-any')
      .map(({ from }) => resolve(from));
    const bestAlternative =
      alternatives.length === 0
        ? []
        : alternatives.reduce((best, candidate) =>
            candidate.length < best.length ? candidate : best,
          );
    visiting.delete(id);
    return unique([...mandatory, ...bestAlternative]);
  };
  const missing = resolve(target);
  const remediation = uniqueBy(
    missing.map((id) => capabilityRemediation(id)),
    (item) =>
      `${item.code}:${item.providerType ?? ''}:${item.runtimePrerequisite ?? ''}:${item.message}`,
  );
  return Object.freeze({
    available: missing.length === 0,
    target,
    missing: Object.freeze(missing),
    remediation: Object.freeze(remediation),
  });
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const found = new Map<string, T>();
  for (const value of values) found.set(key(value), value);
  return [...found.values()];
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
