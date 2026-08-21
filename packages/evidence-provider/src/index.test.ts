import { afterEach, describe, expect, it } from "vitest";
import {
  EvidenceProviderLifecycleError,
  createEvidenceProviderRegistry,
  freezeEvidenceProviders,
  registerEvidenceProvider,
  resetEvidenceProvidersForTesting,
} from "./index.js";

afterEach(() => resetEvidenceProvidersForTesting());

const region = {
  recipient: { semanticId: "reject" },
  regionBounds: { row: 2, column: 4, width: 6, height: 1 },
  spans: [{ row: 2, from: 4, to: 10 }],
} as const;

const provider = (id = "router") => ({
  id,
  version: "1.0.0",
  method: "native" as const,
  capabilities: ["pointer-regions", "hit-test"] as const,
  observe: () => ({
    pointerRegions: [region],
    hitTest: (column: number, row: number) =>
      row === 2 && column >= 4 && column < 10 ? { semanticId: "reject" } : null,
  }),
});

describe("application evidence provider lifecycle", () => {
  it("freezes declarations and materializes production hit testing per revision", () => {
    registerEvidenceProvider(provider("permission-router"));
    const lease = freezeEvidenceProviders();
    expect(lease.registrations).toEqual([
      {
        id: "permission-router",
        version: "1.0.0",
        method: "native",
        capabilities: ["pointer-regions", "hit-test"],
      },
    ]);
    expect(
      lease.collect({
        sessionId: "session-a",
        revision: 7,
        columns: 20,
        rows: 5,
      }),
    ).toMatchObject([
      {
        providerId: "permission-router",
        sessionId: "session-a",
        revision: 7,
        status: "available",
        hitGrid: {
          regions: [
            {
              recipientId: "reject",
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ]);
  });

  it("rejects duplicate ids, competing pointer owners, and late registration", () => {
    registerEvidenceProvider(provider());
    expect(() => registerEvidenceProvider(provider())).toThrow(
      /already registered/,
    );
    expect(() => registerEvidenceProvider(provider("other"))).toThrow(
      /exclusive pointer-regions ownership/,
    );
    const lease = freezeEvidenceProviders();
    expect(() =>
      registerEvidenceProvider({
        id: "late",
        version: "1",
        method: "declared",
        capabilities: [],
        observe: () => ({ pointerRegions: [] }),
      }),
    ).toThrow(EvidenceProviderLifecycleError);
    lease.close();
  });

  it("publishes loss instead of silently weakening a frozen declaration", () => {
    const registration = registerEvidenceProvider(provider());
    const lease = freezeEvidenceProviders();
    registration.dispose();
    expect(
      lease.collect({
        sessionId: "session-a",
        revision: 2,
        columns: 20,
        rows: 5,
      }),
    ).toEqual([
      {
        providerId: "router",
        sessionId: "session-a",
        revision: 2,
        status: "lost",
        reason: "provider was disposed after negotiation",
      },
    ]);
  });

  it("publishes provider exceptions as violations, not loss", () => {
    registerEvidenceProvider({
      id: "router",
      version: "1",
      method: "native",
      capabilities: ["pointer-regions"],
      observe: () => {
        throw new Error("production router unavailable");
      },
    });
    expect(
      freezeEvidenceProviders().collect({
        sessionId: "session-a",
        revision: 4,
        columns: 20,
        rows: 5,
      }),
    ).toEqual([
      {
        providerId: "router",
        sessionId: "session-a",
        revision: 4,
        status: "violation",
        reason: "production router unavailable",
      },
    ]);
  });

  it.each([
    [
      "a hole",
      (column: number, row: number) =>
        row === 2 && column >= 4 && column < 9
          ? { semanticId: "reject" }
          : null,
    ],
    [
      "an owner outside declarations",
      (column: number, row: number) =>
        row === 0 && column === 0
          ? { semanticId: "reject" }
          : row === 2 && column >= 4 && column < 10
            ? { semanticId: "reject" }
            : null,
    ],
    [
      "the wrong recipient",
      (column: number, row: number) =>
        row === 2 && column >= 4 && column < 10
          ? { semanticId: "approve" }
          : null,
    ],
  ])("rejects production hit testing with %s", (_label, hitTest) => {
    registerEvidenceProvider({
      ...provider(),
      observe: () => ({ pointerRegions: [region], hitTest }),
    });
    expect(
      freezeEvidenceProviders().collect({
        sessionId: "session-a",
        revision: 1,
        columns: 20,
        rows: 5,
      }),
    ).toMatchObject([
      {
        providerId: "router",
        status: "violation",
        reason: expect.stringContaining("production hit test"),
      },
    ]);
  });

  it("isolates explicit registries and independent parallel session leases", () => {
    const first = createEvidenceProviderRegistry();
    const second = createEvidenceProviderRegistry();
    first.register(provider());
    second.register(provider());
    const firstLease = first.freeze();
    const parallelLease = first.freeze();
    const late = {
      id: "late",
      version: "1",
      method: "declared" as const,
      capabilities: [] as const,
      observe: () => ({ pointerRegions: [] }),
    };
    expect(() => first.register(late)).toThrow(/frozen/);
    firstLease.close();
    expect(() => first.register({ ...late, id: "still-late" })).toThrow(
      /frozen/,
    );
    parallelLease.close();
    expect(second.freeze().registrations).toHaveLength(1);
  });

  it("supports a region-only declared provider composed with an independent native hit-test", () => {
    const registry = createEvidenceProviderRegistry();
    registry.register({
      id: "declared-regions",
      version: "1",
      method: "declared",
      capabilities: ["pointer-regions"],
      observe: () => ({ pointerRegions: [region] }),
    });
    registry.register({
      id: "production-router",
      version: "2",
      method: "native",
      capabilities: ["hit-test"],
      observe: () => ({
        pointerRegions: [],
        hitTest: (column, row) =>
          row === 2 && column >= 4 && column < 10
            ? { semanticId: "reject" }
            : null,
      }),
    });
    const evidence = registry.freeze().collect({
      sessionId: "session-a",
      revision: 9,
      columns: 20,
      rows: 5,
    });
    expect(evidence).toMatchObject([
      {
        providerId: "declared-regions",
        status: "available",
        pointerRegions: [{ recipientId: "reject" }],
      },
      {
        providerId: "production-router",
        status: "available",
        pointerRegions: [],
        hitGrid: { regions: [{ recipientId: "reject" }] },
      },
    ]);
  });

  it("fails closed when a provider publishes evidence outside its frozen declaration", () => {
    const registry = createEvidenceProviderRegistry();
    registry.register({
      id: "regions",
      version: "1",
      method: "declared",
      capabilities: ["pointer-regions"],
      observe: () => ({ pointerRegions: [region], hitTest: () => null }),
    });
    expect(
      registry
        .freeze()
        .collect({ sessionId: "s", revision: 1, columns: 20, rows: 5 }),
    ).toMatchObject([
      {
        status: "violation",
        reason: expect.stringContaining("without negotiating hit-test"),
      },
    ]);
  });
});
