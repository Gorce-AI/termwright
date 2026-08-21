import { describe, expect, it } from "vitest";
import type {
  EvidenceProviderRegistration,
  SemanticSnapshot,
} from "@termwright/protocol";
import { composeProviderEvidence } from "./provider-evidence.js";

const registration: EvidenceProviderRegistration = {
  id: "app.router",
  version: "1",
  method: "native",
  capabilities: ["pointer-regions", "hit-test"],
};
const frameworkEvidence = {
  source: "framework",
  method: "instrumented",
  strength: "authoritative",
  providerId: "ink",
} as const;
const unknown = {
  status: "unknown",
  reason: "awaiting-revision-pair",
} as const;

function snapshot(overrides: Partial<SemanticSnapshot> = {}): SemanticSnapshot {
  return {
    v: 2,
    sessionId: "s1",
    revision: 3,
    columns: 20,
    rows: 6,
    rootIds: ["root"],
    nodes: [
      {
        id: "root",
        role: "button",
        name: "Reject",
        geometry: {
          displayed: unknown,
          intendedRect: unknown,
          visibleRect: unknown,
        },
      },
    ],
    coordinateSpace: {
      status: "known",
      value: "viewport-cells",
      evidence: frameworkEvidence,
    },
    hitGrid: {
      status: "unsupported",
      capability: "pointer-hit-grid",
      reason: "framework-unobservable",
    },
    providerEvidence: [
      {
        providerId: "app.router",
        sessionId: "s1",
        revision: 3,
        status: "available",
        evidence: {
          source: "application",
          method: "native",
          strength: "authoritative",
          providerId: "app.router",
        },
        pointerRegions: [
          {
            recipientId: "root",
            regionBounds: { row: 2, column: 4, width: 6, height: 1 },
            spans: [{ row: 2, from: 4, to: 10 }],
          },
        ],
        hitGrid: {
          regions: [
            {
              recipientId: "root",
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe("provider evidence composition", () => {
  it("qualifies hit-grid observations without rewriting layout or clipping", () => {
    const result = composeProviderEvidence(snapshot(), [registration]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.nodes[0]?.geometry).toEqual({
      displayed: unknown,
      intendedRect: unknown,
      visibleRect: unknown,
    });
    expect(result.snapshot.hitGrid).toMatchObject({
      status: "known",
      value: { regions: [{ recipientId: "root" }] },
    });
  });

  it("fails closed when a negotiated provider is omitted or lost", () => {
    expect(
      composeProviderEvidence({ ...snapshot(), providerEvidence: [] }, [
        registration,
      ]),
    ).toMatchObject({ ok: false, problem: { kind: "lost" } });
    const lost = snapshot({
      providerEvidence: [
        {
          providerId: "app.router",
          sessionId: "s1",
          revision: 3,
          status: "lost",
          reason: "router stopped",
        },
      ],
    });
    expect(composeProviderEvidence(lost, [registration])).toMatchObject({
      ok: false,
      problem: {
        kind: "lost",
        message: expect.stringContaining("router stopped"),
      },
    });
  });

  it("rejects stale and undeclared evidence", () => {
    const base = snapshot();
    const stale = {
      ...base,
      providerEvidence: [{ ...base.providerEvidence![0]!, revision: 2 }],
    };
    expect(composeProviderEvidence(stale, [registration])).toMatchObject({
      ok: false,
      problem: { kind: "violation", message: expect.stringContaining("stale") },
    });
    expect(composeProviderEvidence(snapshot(), [])).toMatchObject({
      ok: false,
      problem: {
        kind: "violation",
        message: expect.stringContaining("undeclared"),
      },
    });
  });

  it("allows a clickable subregion to differ from layout but rejects pointer ownership disagreement", () => {
    const distinctLayout = snapshot({
      nodes: [
        {
          id: "root",
          role: "button",
          name: "Reject",
          geometry: {
            displayed: unknown,
            intendedRect: {
              status: "known",
              value: { row: 0, column: 0, width: 20, height: 4 },
              evidence: frameworkEvidence,
            },
            visibleRect: {
              status: "known",
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
        status: "known",
        value: { row: 0, column: 0, width: 20, height: 4 },
      });
    }

    const gridConflict = snapshot({
      hitGrid: {
        status: "known",
        evidence: frameworkEvidence,
        value: {
          regions: [
            {
              recipientId: "root",
              rect: { row: 1, column: 1, width: 1, height: 1 },
            },
          ],
        },
      },
    });
    expect(composeProviderEvidence(gridConflict, [registration])).toMatchObject(
      {
        ok: false,
        problem: {
          kind: "violation",
          message: expect.stringContaining("disagrees"),
        },
      },
    );
  });

  it("validates independently composed region and hit-test providers as one contract", () => {
    const base = snapshot();
    const frame = base.providerEvidence![0]!;
    if (frame.status !== "available")
      throw new Error("fixture provider must be available");
    const regionsOnly: EvidenceProviderRegistration = {
      id: "app.regions",
      version: "1",
      method: "native",
      capabilities: ["pointer-regions"],
    };
    const hitsOnly: EvidenceProviderRegistration = {
      id: "app.hits",
      version: "1",
      method: "native",
      capabilities: ["hit-test"],
    };
    const providerEvidence = [
      {
        providerId: regionsOnly.id,
        sessionId: frame.sessionId,
        revision: frame.revision,
        status: "available" as const,
        evidence: { ...frame.evidence, providerId: regionsOnly.id },
        pointerRegions: frame.pointerRegions,
      },
      {
        providerId: hitsOnly.id,
        sessionId: frame.sessionId,
        revision: frame.revision,
        status: "available" as const,
        evidence: { ...frame.evidence, providerId: hitsOnly.id },
        pointerRegions: [],
        hitGrid: {
          regions: [
            {
              recipientId: "root",
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ];
    expect(
      composeProviderEvidence({ ...base, providerEvidence }, [
        regionsOnly,
        hitsOnly,
      ]),
    ).toMatchObject({
      ok: true,
      snapshot: { hitGrid: { status: "known" } },
    });

    const conflictingEvidence = [
      providerEvidence[0]!,
      {
        ...providerEvidence[1]!,
        hitGrid: {
          regions: [
            {
              recipientId: "other",
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ];
    expect(
      composeProviderEvidence(
        { ...base, providerEvidence: conflictingEvidence },
        [regionsOnly, hitsOnly],
      ),
    ).toMatchObject({
      ok: false,
      problem: {
        kind: "violation",
        message: expect.stringContaining("disagrees"),
      },
    });
  });

  it("rejects evidence outside a provider's frozen capability declaration", () => {
    const base = snapshot();
    const frame = base.providerEvidence![0]!;
    if (frame.status !== "available")
      throw new Error("fixture provider must be available");
    const hitOnly: EvidenceProviderRegistration = {
      id: registration.id,
      version: "1",
      method: "native",
      capabilities: ["hit-test"],
    };
    expect(composeProviderEvidence(base, [hitOnly])).toMatchObject({
      ok: false,
      problem: {
        kind: "violation",
        message: expect.stringContaining("did not negotiate"),
      },
    });

    const regionsOnly: EvidenceProviderRegistration = {
      id: registration.id,
      version: "1",
      method: "native",
      capabilities: ["pointer-regions"],
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
        kind: "violation",
        message: expect.stringContaining("did not negotiate"),
      },
    });
  });
});
