import { describe, expect, it } from 'vitest';
import type { EvidenceProviderRegistration, SemanticSnapshot } from '@termwright/protocol';
import { composeProviderEvidence } from './provider-evidence.js';

const registration: EvidenceProviderRegistration = {
  id: 'app.router',
  version: '1',
  method: 'native',
  capabilities: ['pointer-regions', 'hit-test'],
};
const frameworkEvidence = {
  source: 'framework',
  method: 'instrumented',
  strength: 'authoritative',
  providerId: 'ink',
} as const;
const unknown = {
  status: 'unknown',
  reason: 'awaiting-revision-pair',
} as const;

function snapshot(overrides: Partial<SemanticSnapshot> = {}): SemanticSnapshot {
  return {
    v: 3,
    sessionId: 's1',
    revision: 3,
    columns: 20,
    rows: 6,
    rootIds: ['root'],
    nodes: [
      {
        id: 'root',
        role: 'button',
        name: 'Reject',
        geometry: {
          displayed: unknown,
          intendedRect: unknown,
          visibleRect: unknown,
        },
      },
    ],
    coordinateSpace: {
      status: 'known',
      value: 'viewport-cells',
      evidence: frameworkEvidence,
    },
    hitGrid: {
      status: 'unsupported',
      capability: 'pointer-hit-grid',
      reason: 'framework-unobservable',
    },
    providerEvidence: [
      {
        providerId: 'app.router',
        sessionId: 's1',
        revision: 3,
        status: 'available',
        evidence: {
          source: 'application',
          method: 'native',
          strength: 'authoritative',
          providerId: 'app.router',
        },
        pointerRegions: [
          {
            recipientId: 'root',
            regionBounds: { row: 2, column: 4, width: 6, height: 1 },
            spans: [{ row: 2, from: 4, to: 10 }],
          },
        ],
        hitGrid: {
          regions: [
            {
              recipientId: 'root',
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe('provider evidence composition', () => {
  it('co-proves equivalent terminal input modes and rejects disagreement', () => {
    const inputRegistration = (id: string): EvidenceProviderRegistration => ({
      id,
      version: '1',
      method: 'native',
      capabilities: ['terminal-input-modes'],
    });
    const inputFrame = (id: string, mouseTracking: 'drag' | 'any') => ({
      providerId: id,
      sessionId: 's1',
      revision: 3,
      status: 'available' as const,
      evidence: {
        source: 'application' as const,
        method: 'native' as const,
        strength: 'authoritative' as const,
        providerId: id,
      },
      pointerRegions: [],
      inputModes: {
        mouseTracking,
        mouseEncoding: 'sgr' as const,
        focusReporting: 'on' as const,
      },
    });
    expect(
      composeProviderEvidence(snapshot({ providerEvidence: [inputFrame('app.input', 'drag')] }), [
        inputRegistration('app.input'),
      ]),
    ).toMatchObject({
      ok: true,
      inputModes: {
        value: { mouseTracking: 'drag', mouseEncoding: 'sgr' },
        providerId: 'app.input',
      },
    });
    expect(
      composeProviderEvidence(
        snapshot({
          providerEvidence: [inputFrame('first', 'drag'), inputFrame('second', 'any')],
        }),
        [inputRegistration('first'), inputRegistration('second')],
      ),
    ).toMatchObject({
      ok: false,
      problem: { kind: 'conflict', message: expect.stringContaining('input modes') },
    });
  });
  it('composes authoritative focus state and rejects provider conflicts', () => {
    const focus = (id: string, focusedRecipientId: string | null) => ({
      providerId: id,
      sessionId: 's1',
      revision: 3,
      status: 'available' as const,
      evidence: {
        source: 'application' as const,
        method: 'native' as const,
        strength: 'authoritative' as const,
        providerId: id,
      },
      pointerRegions: [],
      focusState:
        focusedRecipientId === null
          ? { status: 'none' as const }
          : { status: 'focused' as const, recipientId: focusedRecipientId },
    });
    const focusRegistration = (id: string): EvidenceProviderRegistration => ({
      id,
      version: '1',
      method: 'native',
      capabilities: ['focus-state'],
    });
    const result = composeProviderEvidence(
      snapshot({ providerEvidence: [focus('app.focus', 'root')] }),
      [focusRegistration('app.focus')],
    );
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        nodes: [{ state: { focused: true }, px: { 'state.focused': 'application' } }],
      },
    });
    expect(
      composeProviderEvidence(
        snapshot({
          providerEvidence: [focus('first', 'root'), focus('second', null)],
        }),
        [focusRegistration('first'), focusRegistration('second')],
      ),
    ).toMatchObject({
      ok: false,
      problem: { kind: 'conflict', message: expect.stringContaining('disagree') },
    });
    expect(
      composeProviderEvidence(
        snapshot({
          nodes: [{ ...snapshot().nodes[0]!, state: { focused: false } }],
          providerEvidence: [focus('app.focus', 'root')],
        }),
        [focusRegistration('app.focus')],
      ),
    ).toMatchObject({
      ok: false,
      problem: { kind: 'conflict', message: expect.stringContaining('framework') },
    });
  });

  it('composes application scroll state and rejects conflicting producers', () => {
    const scrollRegistration = (id: string): EvidenceProviderRegistration => ({
      id,
      version: '1',
      method: 'native',
      capabilities: ['scroll-state'],
    });
    const scrollFrame = (id: string, offset: number) => ({
      providerId: id,
      sessionId: 's1',
      revision: 3,
      status: 'available' as const,
      evidence: {
        source: 'application' as const,
        method: 'native' as const,
        strength: 'authoritative' as const,
        providerId: id,
      },
      pointerRegions: [],
      scrollStates: [
        {
          recipientId: 'root',
          axis: 'vertical' as const,
          offset,
          viewport: 4,
          extent: 20,
        },
      ],
    });
    expect(
      composeProviderEvidence(snapshot({ providerEvidence: [scrollFrame('app.scroll', 3)] }), [
        scrollRegistration('app.scroll'),
      ]),
    ).toMatchObject({
      ok: true,
      composedNodeIds: new Set(['root']),
      snapshot: {
        nodes: [
          {
            scroll: {
              status: 'known',
              value: { axis: 'vertical', offset: 3, viewport: 4, extent: 20 },
              evidence: { providerId: 'app.scroll' },
            },
          },
        ],
      },
    });
    expect(
      composeProviderEvidence(
        snapshot({ providerEvidence: [scrollFrame('first', 3), scrollFrame('second', 4)] }),
        [scrollRegistration('first'), scrollRegistration('second')],
      ),
    ).toMatchObject({
      ok: false,
      problem: { kind: 'conflict', message: expect.stringContaining('disagree') },
    });
  });

  it('composes authoritative paint attribution and rejects competing painters', () => {
    const registrationFor = (id: string): EvidenceProviderRegistration => ({
      id,
      version: '1',
      method: 'native',
      capabilities: ['painted-regions'],
    });
    const frame = (id: string, from: number) => ({
      providerId: id,
      sessionId: 's1',
      revision: 3,
      status: 'available' as const,
      evidence: {
        source: 'application' as const,
        method: 'native' as const,
        strength: 'authoritative' as const,
        providerId: id,
      },
      pointerRegions: [],
      paintedRegions: [
        {
          recipientId: 'root',
          regionBounds: { row: 1, column: from, width: 2, height: 1 },
          spans: [{ row: 1, from, to: from + 2 }],
        },
      ],
    });
    expect(
      composeProviderEvidence(snapshot({ providerEvidence: [frame('app.paint', 2)] }), [
        registrationFor('app.paint'),
      ]),
    ).toMatchObject({
      ok: true,
      snapshot: {
        nodes: [
          {
            paintedRegion: {
              status: 'known',
              value: {
                regionBounds: { row: 1, column: 2, width: 2, height: 1 },
                spans: [{ row: 1, from: 2, to: 4 }],
              },
              evidence: { providerId: 'app.paint' },
            },
          },
        ],
      },
    });
    expect(
      composeProviderEvidence(
        snapshot({ providerEvidence: [frame('first', 2), frame('second', 3)] }),
        [registrationFor('first'), registrationFor('second')],
      ),
    ).toMatchObject({
      ok: false,
      problem: { kind: 'conflict', message: expect.stringContaining('painted region') },
    });
  });

  it('merges equivalent application recipes and rejects authoritative conflicts', () => {
    const recipeRegistration: EvidenceProviderRegistration = {
      id: 'app.keys',
      version: '1',
      method: 'native',
      capabilities: ['action-recipes'],
    };
    const activate = {
      action: 'activate' as const,
      requiresFocus: true,
      steps: [{ kind: 'press' as const, key: 'Enter' }],
    };
    const base = snapshot({
      nodes: [
        {
          ...snapshot().nodes[0]!,
          actions: ['activate'],
          inputRecipes: [activate],
        },
      ],
      providerEvidence: [
        {
          providerId: 'app.keys',
          sessionId: 's1',
          revision: 3,
          status: 'available',
          evidence: {
            source: 'application',
            method: 'native',
            strength: 'authoritative',
            providerId: 'app.keys',
          },
          pointerRegions: [],
          actionRecipes: [{ recipientId: 'root', recipes: [activate] }],
        },
      ],
    });
    expect(composeProviderEvidence(base, [recipeRegistration])).toMatchObject({
      ok: true,
      snapshot: { nodes: [{ inputRecipes: [activate] }] },
    });
    const conflicting = {
      ...base,
      providerEvidence: [
        {
          ...base.providerEvidence![0]!,
          actionRecipes: [
            {
              recipientId: 'root',
              recipes: [
                {
                  ...activate,
                  steps: [{ kind: 'press' as const, key: 'Space' }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(composeProviderEvidence(conflicting, [recipeRegistration])).toMatchObject({
      ok: false,
      problem: {
        kind: 'conflict',
        message: expect.stringContaining('disagrees'),
      },
    });
  });

  it('qualifies hit-grid observations without rewriting layout or clipping', () => {
    const result = composeProviderEvidence(snapshot(), [registration]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.nodes[0]?.geometry).toEqual({
      displayed: unknown,
      intendedRect: unknown,
      visibleRect: unknown,
    });
    expect(result.snapshot.hitGrid).toMatchObject({
      status: 'known',
      value: { regions: [{ recipientId: 'root' }] },
    });
  });

  it('fails closed when a negotiated provider is omitted or lost', () => {
    expect(
      composeProviderEvidence({ ...snapshot(), providerEvidence: [] }, [registration]),
    ).toMatchObject({ ok: false, problem: { kind: 'lost' } });
    const lost = snapshot({
      providerEvidence: [
        {
          providerId: 'app.router',
          sessionId: 's1',
          revision: 3,
          status: 'lost',
          reason: 'router stopped',
        },
      ],
    });
    expect(composeProviderEvidence(lost, [registration])).toMatchObject({
      ok: false,
      problem: {
        kind: 'lost',
        message: expect.stringContaining('router stopped'),
      },
    });
  });

  it('rejects stale and undeclared evidence', () => {
    const base = snapshot();
    const stale = {
      ...base,
      providerEvidence: [{ ...base.providerEvidence![0]!, revision: 2 }],
    };
    expect(composeProviderEvidence(stale, [registration])).toMatchObject({
      ok: false,
      problem: { kind: 'violation', message: expect.stringContaining('stale') },
    });
    expect(composeProviderEvidence(snapshot(), [])).toMatchObject({
      ok: false,
      problem: {
        kind: 'violation',
        message: expect.stringContaining('undeclared'),
      },
    });
  });

  it('allows a clickable subregion to differ from layout but rejects pointer ownership disagreement', () => {
    const distinctLayout = snapshot({
      nodes: [
        {
          id: 'root',
          role: 'button',
          name: 'Reject',
          geometry: {
            displayed: unknown,
            intendedRect: {
              status: 'known',
              value: { row: 0, column: 0, width: 20, height: 4 },
              evidence: frameworkEvidence,
            },
            visibleRect: {
              status: 'known',
              value: { row: 0, column: 0, width: 20, height: 4 },
              evidence: frameworkEvidence,
            },
          },
        },
      ],
    });
    const composed = composeProviderEvidence(distinctLayout, [registration]);
    expect(composed.ok).toBe(true);
    if (composed.ok) {
      expect(composed.snapshot.nodes[0]?.geometry.intendedRect).toMatchObject({
        status: 'known',
        value: { row: 0, column: 0, width: 20, height: 4 },
      });
    }

    const gridConflict = snapshot({
      hitGrid: {
        status: 'known',
        evidence: frameworkEvidence,
        value: {
          regions: [
            {
              recipientId: 'root',
              rect: { row: 1, column: 1, width: 1, height: 1 },
            },
          ],
        },
      },
    });
    expect(composeProviderEvidence(gridConflict, [registration])).toMatchObject({
      ok: false,
      problem: {
        kind: 'conflict',
        message: expect.stringContaining('disagrees'),
      },
    });
  });

  it('validates independently composed region and hit-test providers as one contract', () => {
    const base = snapshot();
    const frame = base.providerEvidence![0]!;
    if (frame.status !== 'available') throw new Error('fixture provider must be available');
    const regionsOnly: EvidenceProviderRegistration = {
      id: 'app.regions',
      version: '1',
      method: 'native',
      capabilities: ['pointer-regions'],
    };
    const hitsOnly: EvidenceProviderRegistration = {
      id: 'app.hits',
      version: '1',
      method: 'native',
      capabilities: ['hit-test'],
    };
    const providerEvidence = [
      {
        providerId: regionsOnly.id,
        sessionId: frame.sessionId,
        revision: frame.revision,
        status: 'available' as const,
        evidence: { ...frame.evidence, providerId: regionsOnly.id },
        pointerRegions: frame.pointerRegions,
      },
      {
        providerId: hitsOnly.id,
        sessionId: frame.sessionId,
        revision: frame.revision,
        status: 'available' as const,
        evidence: { ...frame.evidence, providerId: hitsOnly.id },
        pointerRegions: [],
        hitGrid: {
          regions: [
            {
              recipientId: 'root',
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ];
    expect(
      composeProviderEvidence({ ...base, providerEvidence }, [regionsOnly, hitsOnly]),
    ).toMatchObject({
      ok: true,
      snapshot: { hitGrid: { status: 'known' } },
    });

    const conflictingEvidence = [
      providerEvidence[0]!,
      {
        ...providerEvidence[1]!,
        hitGrid: {
          regions: [
            {
              recipientId: 'other',
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ];
    expect(
      composeProviderEvidence({ ...base, providerEvidence: conflictingEvidence }, [
        regionsOnly,
        hitsOnly,
      ]),
    ).toMatchObject({
      ok: false,
      problem: {
        kind: 'conflict',
        message: expect.stringContaining('disagrees'),
      },
    });
  });

  it("rejects evidence outside a provider's frozen capability declaration", () => {
    const base = snapshot();
    const frame = base.providerEvidence![0]!;
    if (frame.status !== 'available') throw new Error('fixture provider must be available');
    const hitOnly: EvidenceProviderRegistration = {
      id: registration.id,
      version: '1',
      method: 'native',
      capabilities: ['hit-test'],
    };
    expect(composeProviderEvidence(base, [hitOnly])).toMatchObject({
      ok: false,
      problem: {
        kind: 'violation',
        message: expect.stringContaining('did not negotiate'),
      },
    });

    const regionsOnly: EvidenceProviderRegistration = {
      id: registration.id,
      version: '1',
      method: 'native',
      capabilities: ['pointer-regions'],
    };
    expect(
      composeProviderEvidence(
        {
          ...base,
          providerEvidence: [frame],
        },
        [regionsOnly],
      ),
    ).toMatchObject({
      ok: false,
      problem: {
        kind: 'violation',
        message: expect.stringContaining('did not negotiate'),
      },
    });
  });
});
