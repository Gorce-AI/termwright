import { afterEach, describe, expect, it } from "vitest";
import {
  EvidenceProviderLifecycleError,
  createEvidenceProviderRegistry,
  freezeEvidenceProviders,
  registerActionStrategyProvider,
  registerFocusEvidenceProvider,
  registerPointerEvidenceProvider,
  registerPaintEvidenceProvider,
  registerScrollEvidenceProvider,
  registerTerminalInputModeEvidenceProvider,
  resetEvidenceProvidersForTesting,
} from "./index.js";
import type { EvidenceRecipient } from "./index.js";

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
  family: "pointer" as const,
  capabilities: ["pointer-regions", "hit-test"] as const,
  observe: () => ({
    pointerRegions: [region],
    hitTest: (column: number, row: number) =>
      row === 2 && column >= 4 && column < 10 ? { semanticId: "reject" } : null,
  }),
});

describe("application evidence provider lifecycle", () => {
  it("freezes declarations and materializes production hit testing per revision", () => {
    registerPointerEvidenceProvider(provider("permission-router"));
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

  it("rejects duplicate ids and late registration without registration-order ownership", () => {
    registerPointerEvidenceProvider(provider());
    expect(() => registerPointerEvidenceProvider(provider())).toThrow(
      /already registered/,
    );
    expect(() => registerPointerEvidenceProvider(provider("other"))).not.toThrow();
    const lease = freezeEvidenceProviders();
    expect(() =>
      registerPointerEvidenceProvider({
        id: "late",
        version: "1",
        method: "declared",
        family: "pointer",
        capabilities: [],
        observe: () => ({ pointerRegions: [] }),
      }),
    ).toThrow(EvidenceProviderLifecycleError);
    lease.close();
  });

  it("publishes revision-bound production keybinding recipes as data", () => {
    registerActionStrategyProvider({
      id: "app.keys",
      version: "1",
      method: "native",
      family: "action-strategy",
      observe: () => ({
        actionRecipes: [
          {
            recipient: { testId: "editor" },
            recipes: [
              {
                action: "setValue",
                requiresFocus: true,
                steps: [
                  { kind: "press", key: "Control+U" },
                  { kind: "insert-action-value" },
                ],
              },
            ],
          },
        ],
      }),
    });
    const [frame] = freezeEvidenceProviders().collect({
      sessionId: "session-a",
      revision: 4,
      columns: 20,
      rows: 5,
      resolveRecipient: (recipient) =>
        "testId" in recipient ? `resolved:${recipient.testId}` : "other",
    });
    expect(frame).toMatchObject({
      status: "available",
      actionRecipes: [
        {
          recipientId: "resolved:editor",
          recipes: [{ action: "setValue" }],
        },
      ],
    });
  });

  it("publishes the exact production focus recipient, including authoritative absence", () => {
    const registry = createEvidenceProviderRegistry();
    registry.registerFocus({
      id: "app.focus",
      version: "1",
      method: "native",
      family: "focus",
      observe: ({ revision }) => ({
        focused: revision === 4 ? { testId: "editor" } : null,
      }),
    });
    const lease = registry.freeze();
    expect(lease.registrations[0]?.capabilities).toEqual(["focus-state"]);
    const resolveRecipient = (recipient: EvidenceRecipient) =>
      `resolved:${"testId" in recipient ? recipient.testId : "other"}`;
    expect(
      lease.collect({
        sessionId: "s",
        revision: 4,
        columns: 10,
        rows: 4,
        resolveRecipient,
      }),
    ).toMatchObject([{ status: "available", focusState: { status: "focused", recipientId: "resolved:editor" } }]);
    expect(
      lease.collect({
        sessionId: "s",
        revision: 5,
        columns: 10,
        rows: 4,
        resolveRecipient,
      }),
    ).toMatchObject([{ status: "available", focusState: { status: "none" } }]);

    const global = registerFocusEvidenceProvider({
      id: "global.focus",
      version: "1",
      method: "declared",
      family: "focus",
      observe: () => ({ focused: null }),
    });
    global.dispose();
  });

  it("publishes bounded production application viewport state", () => {
    registerScrollEvidenceProvider({
      id: "app.scroll",
      version: "1",
      method: "native",
      family: "scroll",
      observe: ({ revision }) => ({
        scrollStates: [{
          recipient: { testId: "results" },
          axis: "vertical",
          offset: revision,
          viewport: 4,
          extent: 20,
        }],
      }),
    });
    const lease = freezeEvidenceProviders();
    expect(lease.registrations[0]?.capabilities).toEqual(["scroll-state"]);
    expect(lease.collect({
      sessionId: "s",
      revision: 5,
      columns: 20,
      rows: 5,
      resolveRecipient: () => "results-node",
    })).toMatchObject([{
      status: "available",
      scrollStates: [{
        recipientId: "results-node",
        axis: "vertical",
        offset: 5,
        viewport: 4,
        extent: 20,
      }],
    }]);
    lease.close();
  });

  it("turns impossible scroll ranges into provider contract violations", () => {
    registerScrollEvidenceProvider({
      id: "app.scroll",
      version: "1",
      method: "native",
      family: "scroll",
      observe: () => ({
        scrollStates: [{
          recipient: { semanticId: "results" },
          axis: "vertical",
          offset: 18,
          viewport: 4,
          extent: 20,
        }],
      }),
    });
    expect(freezeEvidenceProviders().collect({
      sessionId: "s",
      revision: 1,
      columns: 20,
      rows: 5,
    })).toMatchObject([{
      status: "violation",
      reason: expect.stringContaining("within its extent"),
    }]);
  });

  it("publishes production paint attribution independently of layout and pointer routing", () => {
    registerPaintEvidenceProvider({
      id: "app.painter",
      version: "1",
      method: "native",
      family: "paint",
      observe: () => ({ paintedRegions: [region] }),
    });
    const lease = freezeEvidenceProviders();
    expect(lease.registrations[0]?.capabilities).toEqual(["painted-regions"]);
    expect(lease.collect({
      sessionId: "s",
      revision: 2,
      columns: 20,
      rows: 5,
    })).toMatchObject([{
      status: "available",
      paintedRegions: [{
        recipientId: "reject",
        regionBounds: { row: 2, column: 4, width: 6, height: 1 },
        spans: [{ row: 2, from: 4, to: 10 }],
      }],
    }]);
    lease.close();
  });

  it("publishes authoritative production terminal parser modes", () => {
    registerTerminalInputModeEvidenceProvider({
      id: "app.input-parser",
      version: "1",
      method: "native",
      family: "input-mode",
      observe: () => ({
        inputModes: {
          mouseTracking: "drag",
          mouseEncoding: "sgr",
          focusReporting: "on",
        },
      }),
    });
    const lease = freezeEvidenceProviders();
    expect(lease.registrations[0]?.capabilities).toEqual([
      "terminal-input-modes",
    ]);
    expect(
      lease.collect({
        sessionId: "s",
        revision: 2,
        columns: 20,
        rows: 5,
      }),
    ).toMatchObject([
      {
        status: "available",
        inputModes: {
          mouseTracking: "drag",
          mouseEncoding: "sgr",
          focusReporting: "on",
        },
      },
    ]);
    lease.close();
  });

  it("publishes loss instead of silently weakening a frozen declaration", () => {
    const registration = registerPointerEvidenceProvider(provider());
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
    registerPointerEvidenceProvider({
      id: "router",
      version: "1",
      method: "native",
      family: "pointer",
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
    registerPointerEvidenceProvider({
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
    first.registerPointer(provider());
    second.registerPointer(provider());
    const firstLease = first.freeze();
    const parallelLease = first.freeze();
    const late = {
      id: "late",
      version: "1",
      method: "declared" as const,
      family: "pointer" as const,
      capabilities: [] as const,
      observe: () => ({ pointerRegions: [] }),
    };
    expect(() => first.registerPointer(late)).toThrow(/frozen/);
    firstLease.close();
    expect(() => first.registerPointer({ ...late, id: "still-late" })).toThrow(
      /frozen/,
    );
    parallelLease.close();
    expect(second.freeze().registrations).toHaveLength(1);
  });

  it("supports a region-only declared provider composed with an independent native hit-test", () => {
    const registry = createEvidenceProviderRegistry();
    registry.registerPointer({
      id: "declared-regions",
      version: "1",
      method: "declared",
      family: "pointer",
      capabilities: ["pointer-regions"],
      observe: () => ({ pointerRegions: [region] }),
    });
    registry.registerPointer({
      id: "production-router",
      version: "2",
      method: "native",
      family: "pointer",
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
    registry.registerPointer({
      id: "regions",
      version: "1",
      method: "declared",
      family: "pointer",
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
