import { describe, expect, it } from 'vitest';
import {
  ADAPTER_CAPABILITIES,
  CAPABILITY_CONFORMANCE_CLAIMS,
  CAPABILITY_GRAPH,
  CONDITION_KINDS,
  EVIDENCE_PROVIDER_CAPABILITIES,
  PROBE_CAPABILITIES,
  SESSION_CAPABILITIES,
  capabilityNode,
  capabilityRemediation,
  resolveCapability,
  sessionCapabilitiesFromProducers,
  validateCapabilityGraph,
} from './capability-graph.js';

describe('executable capability graph', () => {
  it('is closed, connected and binds every public/session node to executable claims', () => {
    expect(validateCapabilityGraph()).toEqual({ ok: true, errors: [] });
    const ids = CAPABILITY_GRAPH.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of CAPABILITY_GRAPH.nodes.filter(
      ({ layer }) => layer === 'session' || layer === 'public',
    )) {
      expect(node.conformanceClaims?.length, node.id).toBeGreaterThan(0);
      for (const claim of node.conformanceClaims ?? [])
        expect(CAPABILITY_CONFORMANCE_CLAIMS).toContain(claim);
    }
  });

  it('contains the wire vocabularies rather than maintaining parallel maps', () => {
    expect(ADAPTER_CAPABILITIES.map((id) => capabilityNode(`adapter.${id}`).id)).toHaveLength(
      ADAPTER_CAPABILITIES.length,
    );
    expect(PROBE_CAPABILITIES.map((id) => capabilityNode(`probe.${id}`).id)).toHaveLength(
      PROBE_CAPABILITIES.length,
    );
    expect(
      EVIDENCE_PROVIDER_CAPABILITIES.map((id) => capabilityNode(`provider.${id}`).id),
    ).toHaveLength(EVIDENCE_PROVIDER_CAPABILITIES.length);
    expect(SESSION_CAPABILITIES.map((id) => capabilityNode(`session.${id}`).id)).toHaveLength(
      SESSION_CAPABILITIES.length,
    );
  });

  it('keeps diagnostic facts from producing certified session guarantees', () => {
    const diagnosticSources = new Set(
      CAPABILITY_GRAPH.nodes
        .filter(({ category }) => category === 'diagnostic')
        .map(({ id }) => id),
    );
    expect(
      CAPABILITY_GRAPH.edges.filter(
        ({ kind, from, to }) =>
          kind === 'produces' && diagnosticSources.has(from) && to.startsWith('session.'),
      ),
    ).toEqual([]);
    expect(CAPABILITY_GRAPH.edges).toContainEqual({
      from: 'probe.paint-order',
      to: 'diagnostic.render-order',
      kind: 'diagnoses',
    });
  });

  it('keeps paint/focus/scroll producers explicit', () => {
    expect(
      CAPABILITY_GRAPH.edges.filter(
        ({ kind, to }) => kind === 'produces' && to === 'session.painted-region',
      ),
    ).toEqual([
      {
        from: 'provider.painted-regions',
        to: 'session.painted-region',
        kind: 'produces',
      },
    ]);
    expect(
      CAPABILITY_GRAPH.edges.filter(
        ({ kind, to }) => kind === 'produces' && to === 'session.focus',
      ),
    ).toEqual([
      { from: 'adapter.focus-state', to: 'session.focus', kind: 'produces' },
      { from: 'provider.focus-state', to: 'session.focus', kind: 'produces' },
    ]);
    expect(CAPABILITY_GRAPH.edges).toContainEqual({
      from: 'probe.paint-order',
      to: 'session.render-order',
      kind: 'produces',
    });
    expect(CAPABILITY_GRAPH.edges).toContainEqual({
      from: 'provider.scroll-state',
      to: 'session.scroll',
      kind: 'produces',
    });
  });

  it('accepts terminal modes only from VT observation or a production parser provider', () => {
    expect(
      CAPABILITY_GRAPH.edges.filter(
        ({ kind, to }) => kind === 'produces' && to === 'session.pointer-input',
      ),
    ).toEqual([
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
    ]);
    expect(
      CAPABILITY_GRAPH.edges.filter(
        ({ kind, to }) => kind === 'produces' && to === 'session.focus-input',
      ),
    ).toEqual([
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
    ]);
    expect(capabilityRemediation('session.pointer-input')).toMatchObject({
      code: 'register-application-provider',
      providerType: 'input-mode-evidence',
    });
  });

  it('derives frozen session capabilities only from explicit producer edges', () => {
    const produced = sessionCapabilitiesFromProducers(
      new Set([
        'adapter.tree',
        'adapter.states',
        'adapter.render-revisions',
        'provider.pointer-regions',
        'terminal.writable-pty',
      ]),
    );
    expect([...produced.keys()].sort()).toEqual([
      'keyboard-input',
      'paired-revisions',
      'pointer-geometry',
      'semantic-tree',
    ]);
    expect(produced.has('focus')).toBe(false);
    expect(produced.has('scroll')).toBe(false);
  });

  it('binds planner requirements to the canonical Condition vocabulary', () => {
    for (const node of CAPABILITY_GRAPH.nodes) {
      for (const condition of node.conditions ?? []) expect(CONDITION_KINDS).toContain(condition);
    }
    expect(capabilityNode('public.action.click').conditions).toEqual([
      'attached',
      'enabled',
      'visible',
      'pointer-region',
      'receives-pointer',
      'mouse-input-enabled',
    ]);
  });

  it('generates actionable remediation without claiming unsupported evidence', () => {
    expect(capabilityRemediation('session.pointer-geometry')).toMatchObject({
      code: 'register-application-provider',
      providerType: 'pointer-evidence',
    });
    expect(capabilityRemediation('session.painted-region')).toMatchObject({
      code: 'register-application-provider',
      providerType: 'paint-evidence',
    });
  });

  it('resolves public strategies only from frozen session and runtime nodes', () => {
    const available = new Set([
      'session.pointer-geometry',
      'session.pointer-input',
      'session.paired-revisions',
      'runtime.committed-observation',
      'runtime.terminal-input-modes-authoritative',
      'runtime.mouse-reporting-enabled',
    ] as const);
    expect(resolveCapability('public.action.click', available)).toMatchObject({
      available: true,
      missing: [],
    });
    const blocked = resolveCapability(
      'public.action.click',
      new Set([
        'session.pointer-geometry',
        'session.pointer-input',
        'session.paired-revisions',
        'runtime.committed-observation',
        'runtime.terminal-input-modes-authoritative',
      ] as const),
    );
    expect(blocked).toMatchObject({
      available: false,
      missing: ['runtime.mouse-reporting-enabled'],
      remediation: [
        {
          code: 'enable-terminal-runtime',
          runtimePrerequisite: 'mouse-reporting-enabled',
        },
      ],
    });
  });
});
