import type {
  EvidenceProviderRegistration,
  EvidenceProvenance,
  PointerHitGrid,
  ProviderPointerRegion,
  Rect,
  SemanticSnapshot,
} from "@termwright/protocol";

export interface ProviderEvidenceProblem {
  readonly kind: "lost" | "violation";
  readonly message: string;
}

export type ProviderEvidenceResult =
  | { readonly ok: true; readonly snapshot: SemanticSnapshot }
  | { readonly ok: false; readonly problem: ProviderEvidenceProblem };

function sameRect(left: Rect, right: Rect): boolean {
  return (
    left.row === right.row &&
    left.column === right.column &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sameGrid(left: PointerHitGrid, right: PointerHitGrid): boolean {
  return (
    left.regions.length === right.regions.length &&
    left.regions.every((region, index) => {
      const other = right.regions[index];
      return (
        other !== undefined &&
        region.recipientId === other.recipientId &&
        sameRect(region.rect, other.rect)
      );
    })
  );
}

function regionsAgreeWithGrid(
  region: ProviderPointerRegion,
  grid: PointerHitGrid,
): boolean {
  return region.spans.every((span) => {
    let cursor = span.from;
    for (const hit of grid.regions) {
      if (hit.rect.row !== span.row || hit.recipientId !== region.recipientId)
        continue;
      const start = Math.max(cursor, hit.rect.column);
      const end = Math.min(span.to, hit.rect.column + hit.rect.width);
      if (start === cursor && end > cursor) cursor = end;
      if (cursor === span.to) return true;
    }
    return false;
  });
}

/**
 * Qualify provider evidence before it reaches locators.
 *
 * This is composition, not dispatch: it produces the ordinary node geometry
 * and hit grid consumed by the action planner. Pointer actions still travel as
 * terminal input bytes through the PTY.
 */
export function composeProviderEvidence(
  snapshot: SemanticSnapshot,
  registrations: readonly EvidenceProviderRegistration[],
): ProviderEvidenceResult {
  const declared = new Map(
    registrations.map((provider) => [provider.id, provider]),
  );
  const frames = new Map(
    (snapshot.providerEvidence ?? []).map((frame) => [frame.providerId, frame]),
  );
  if (frames.size !== (snapshot.providerEvidence ?? []).length) {
    return {
      ok: false,
      problem: {
        kind: "violation",
        message: "provider evidence contains a duplicate id",
      },
    };
  }
  for (const providerId of frames.keys()) {
    if (!declared.has(providerId)) {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `undeclared provider ${providerId} published evidence`,
        },
      };
    }
  }

  const byTarget = new Map<
    string,
    { region: ProviderPointerRegion; evidence: EvidenceProvenance }
  >();
  let providerGrid: {
    grid: PointerHitGrid;
    evidence: EvidenceProvenance;
    providerId: string;
  } | null = null;
  for (const registration of registrations) {
    const frame = frames.get(registration.id);
    if (frame === undefined) {
      return {
        ok: false,
        problem: {
          kind: "lost",
          message: `provider ${registration.id} omitted revision ${snapshot.revision}`,
        },
      };
    }
    if (frame.sessionId !== snapshot.sessionId) {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `provider ${registration.id} published evidence for session ${frame.sessionId}; expected ${snapshot.sessionId}`,
        },
      };
    }
    if (frame.revision !== snapshot.revision) {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `provider ${registration.id} published stale revision ${frame.revision}; expected ${snapshot.revision}`,
        },
      };
    }
    if (frame.status === "lost") {
      return {
        ok: false,
        problem: {
          kind: "lost",
          message: `provider ${registration.id} was lost: ${frame.reason}`,
        },
      };
    }
    if (frame.status === "violation") {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `provider ${registration.id} violated its contract: ${frame.reason}`,
        },
      };
    }
    if (frame.evidence.method !== registration.method) {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `provider ${registration.id} provenance method disagrees with its declaration`,
        },
      };
    }
    if (
      frame.evidence.providerId !== registration.id ||
      frame.evidence.source !== "application" ||
      frame.evidence.strength !== "authoritative"
    ) {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `provider ${registration.id} published non-authoritative or forged provenance`,
        },
      };
    }
    if (
      registration.capabilities.includes("hit-test") &&
      frame.hitGrid === undefined
    ) {
      return {
        ok: false,
        problem: {
          kind: "lost",
          message: `provider ${registration.id} omitted its negotiated hit-test evidence`,
        },
      };
    }
    if (
      !registration.capabilities.includes("hit-test") &&
      frame.hitGrid !== undefined
    ) {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `provider ${registration.id} published hit-test evidence it did not negotiate`,
        },
      };
    }
    if (
      !registration.capabilities.includes("pointer-regions") &&
      frame.pointerRegions.length > 0
    ) {
      return {
        ok: false,
        problem: {
          kind: "violation",
          message: `provider ${registration.id} published pointer-region evidence it did not negotiate`,
        },
      };
    }
    if (frame.hitGrid !== undefined) {
      if (
        frame.pointerRegions.some(
          (region) => !regionsAgreeWithGrid(region, frame.hitGrid!),
        )
      ) {
        return {
          ok: false,
          problem: {
            kind: "violation",
            message: `provider ${registration.id} pointer regions disagree with its production hit test`,
          },
        };
      }
      if (
        providerGrid !== null &&
        !sameGrid(providerGrid.grid, frame.hitGrid)
      ) {
        return {
          ok: false,
          problem: {
            kind: "violation",
            message: `providers ${providerGrid.providerId} and ${registration.id} disagree on pointer ownership`,
          },
        };
      }
      providerGrid = {
        grid: frame.hitGrid,
        evidence: frame.evidence,
        providerId: registration.id,
      };
    }
    for (const region of frame.pointerRegions) {
      const previous = byTarget.get(region.recipientId);
      if (
        previous !== undefined &&
        (!sameRect(previous.region.regionBounds, region.regionBounds) ||
          JSON.stringify(previous.region.spans) !==
            JSON.stringify(region.spans))
      ) {
        return {
          ok: false,
          problem: {
            kind: "violation",
            message: `providers disagree on region for ${region.recipientId}`,
          },
        };
      }
      byTarget.set(region.recipientId, { region, evidence: frame.evidence });
    }
  }

  if (
    providerGrid !== null &&
    snapshot.hitGrid.status === "known" &&
    !sameGrid(snapshot.hitGrid.value, providerGrid.grid)
  ) {
    return {
      ok: false,
      problem: {
        kind: "violation",
        message: `provider ${providerGrid.providerId} hit test disagrees with framework pointer ownership`,
      },
    };
  }
  if (providerGrid !== null) {
    for (const [recipientId, entry] of byTarget) {
      if (!regionsAgreeWithGrid(entry.region, providerGrid.grid)) {
        return {
          ok: false,
          problem: {
            kind: "violation",
            message: `pointer region for ${recipientId} disagrees with provider ${providerGrid.providerId} production hit test`,
          },
        };
      }
    }
  }
  const hitGrid =
    providerGrid === null
      ? snapshot.hitGrid
      : Object.freeze({
          status: "known" as const,
          value: providerGrid.grid,
          evidence: providerGrid.evidence,
        });
  return {
    ok: true,
    snapshot: Object.freeze({ ...snapshot, hitGrid }),
  };
}
