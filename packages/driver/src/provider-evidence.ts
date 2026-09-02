import type {
  EvidenceProviderRegistration,
  EvidenceProvenance,
  PhysicalInputRecipe,
  PointerHitGrid,
  ProviderPointerRegion,
  ProviderPaintedRegion,
  ProviderScrollState,
  ProviderTerminalInputModes,
  Rect,
  SemanticSnapshot,
} from '@termwright/protocol';

export interface ProviderEvidenceProblem {
  readonly kind: 'lost' | 'violation' | 'conflict';
  readonly message: string;
}

export type ProviderEvidenceResult =
  | {
      readonly ok: true;
      readonly snapshot: SemanticSnapshot;
      /** Nodes whose final value was enriched by application-provider evidence. */
      readonly composedNodeIds: ReadonlySet<string>;
      readonly inputModes?: {
        readonly value: ProviderTerminalInputModes;
        readonly evidence: EvidenceProvenance;
        readonly providerId: string;
      };
    }
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

function regionsAgreeWithGrid(region: ProviderPointerRegion, grid: PointerHitGrid): boolean {
  return region.spans.every((span) => {
    let cursor = span.from;
    for (const hit of grid.regions) {
      if (hit.rect.row !== span.row || hit.recipientId !== region.recipientId) continue;
      const start = Math.max(cursor, hit.rect.column);
      const end = Math.min(span.to, hit.rect.column + hit.rect.width);
      if (start === cursor && end > cursor) cursor = end;
      if (cursor === span.to) return true;
    }
    return false;
  });
}

function sameRecipe(left: PhysicalInputRecipe, right: PhysicalInputRecipe): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameScrollState(left: ProviderScrollState, right: ProviderScrollState): boolean {
  return (
    left.axis === right.axis &&
    left.offset === right.offset &&
    left.viewport === right.viewport &&
    left.extent === right.extent
  );
}

function samePaintedRegion(left: ProviderPaintedRegion, right: ProviderPaintedRegion): boolean {
  return (
    sameRect(left.regionBounds, right.regionBounds) &&
    JSON.stringify(left.spans) === JSON.stringify(right.spans)
  );
}

function sameInputModes(
  left: ProviderTerminalInputModes,
  right: ProviderTerminalInputModes,
): boolean {
  return (
    left.mouseTracking === right.mouseTracking &&
    left.mouseEncoding === right.mouseEncoding &&
    left.focusReporting === right.focusReporting
  );
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
  const declared = new Map(registrations.map((provider) => [provider.id, provider]));
  const frames = new Map(
    (snapshot.providerEvidence ?? []).map((frame) => [frame.providerId, frame]),
  );
  if (frames.size !== (snapshot.providerEvidence ?? []).length) {
    return {
      ok: false,
      problem: {
        kind: 'violation',
        message: 'provider evidence contains a duplicate id',
      },
    };
  }
  for (const providerId of frames.keys()) {
    if (!declared.has(providerId)) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
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
  const recipesByTarget = new Map<
    string,
    Map<string, { recipe: PhysicalInputRecipe; providerId: string }>
  >();
  let focusedRecipient: { recipientId: string | null; providerId: string } | undefined;
  const scrollByTarget = new Map<
    string,
    { state: ProviderScrollState; evidence: EvidenceProvenance; providerId: string }
  >();
  const paintByTarget = new Map<
    string,
    { region: ProviderPaintedRegion; evidence: EvidenceProvenance; providerId: string }
  >();
  let providerInputModes:
    | {
        value: ProviderTerminalInputModes;
        evidence: EvidenceProvenance;
        providerId: string;
      }
    | undefined;
  for (const registration of registrations) {
    const frame = frames.get(registration.id);
    if (frame === undefined) {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} omitted revision ${snapshot.revision}`,
        },
      };
    }
    if (frame.sessionId !== snapshot.sessionId) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published evidence for session ${frame.sessionId}; expected ${snapshot.sessionId}`,
        },
      };
    }
    if (frame.revision !== snapshot.revision) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published stale revision ${frame.revision}; expected ${snapshot.revision}`,
        },
      };
    }
    if (frame.status === 'lost') {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} was lost: ${frame.reason}`,
        },
      };
    }
    if (frame.status === 'violation') {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} violated its contract: ${frame.reason}`,
        },
      };
    }
    if (frame.evidence.method !== registration.method) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} provenance method disagrees with its declaration`,
        },
      };
    }
    if (
      frame.evidence.providerId !== registration.id ||
      frame.evidence.source !== 'application' ||
      frame.evidence.strength !== 'authoritative'
    ) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published non-authoritative or forged provenance`,
        },
      };
    }
    if (registration.capabilities.includes('hit-test') && frame.hitGrid === undefined) {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} omitted its negotiated hit-test evidence`,
        },
      };
    }
    if (!registration.capabilities.includes('hit-test') && frame.hitGrid !== undefined) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published hit-test evidence it did not negotiate`,
        },
      };
    }
    if (!registration.capabilities.includes('pointer-regions') && frame.pointerRegions.length > 0) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published pointer-region evidence it did not negotiate`,
        },
      };
    }
    if (registration.capabilities.includes('action-recipes') && frame.actionRecipes === undefined) {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} omitted its negotiated action-recipes evidence`,
        },
      };
    }
    if (registration.capabilities.includes('focus-state') && frame.focusState === undefined) {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} omitted its negotiated focus-state evidence`,
        },
      };
    }
    if (registration.capabilities.includes('scroll-state') && frame.scrollStates === undefined) {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} omitted its negotiated scroll-state evidence`,
        },
      };
    }
    if (!registration.capabilities.includes('scroll-state') && frame.scrollStates !== undefined) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published scroll-state evidence it did not negotiate`,
        },
      };
    }
    if (
      registration.capabilities.includes('painted-regions') &&
      frame.paintedRegions === undefined
    ) {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} omitted its negotiated painted-regions evidence`,
        },
      };
    }
    if (
      !registration.capabilities.includes('painted-regions') &&
      frame.paintedRegions !== undefined
    ) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published painted-region evidence it did not negotiate`,
        },
      };
    }
    if (
      registration.capabilities.includes('terminal-input-modes') &&
      frame.inputModes === undefined
    ) {
      return {
        ok: false,
        problem: {
          kind: 'lost',
          message: `provider ${registration.id} omitted its negotiated terminal-input-modes evidence`,
        },
      };
    }
    if (
      !registration.capabilities.includes('terminal-input-modes') &&
      frame.inputModes !== undefined
    ) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published terminal-input-modes evidence it did not negotiate`,
        },
      };
    }
    if (frame.inputModes !== undefined) {
      if (
        providerInputModes !== undefined &&
        !sameInputModes(providerInputModes.value, frame.inputModes)
      ) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
            message: `providers ${providerInputModes.providerId} and ${registration.id} disagree on terminal input modes`,
          },
        };
      }
      providerInputModes = {
        value: frame.inputModes,
        evidence: frame.evidence,
        providerId: registration.id,
      };
    }
    for (const region of frame.paintedRegions ?? []) {
      if (!snapshot.nodes.some((node) => node.id === region.recipientId)) {
        return {
          ok: false,
          problem: {
            kind: 'violation',
            message: `provider ${registration.id} published painted region for unknown recipient ${region.recipientId}`,
          },
        };
      }
      const previous = paintByTarget.get(region.recipientId);
      if (previous !== undefined && !samePaintedRegion(previous.region, region)) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
            message: `providers ${previous.providerId} and ${registration.id} disagree on painted region for ${region.recipientId}`,
          },
        };
      }
      paintByTarget.set(region.recipientId, {
        region,
        evidence: frame.evidence,
        providerId: registration.id,
      });
    }
    for (const state of frame.scrollStates ?? []) {
      if (!snapshot.nodes.some((node) => node.id === state.recipientId)) {
        return {
          ok: false,
          problem: {
            kind: 'violation',
            message: `provider ${registration.id} published scroll state for unknown recipient ${state.recipientId}`,
          },
        };
      }
      const previous = scrollByTarget.get(state.recipientId);
      if (previous !== undefined && !sameScrollState(previous.state, state)) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
            message: `providers ${previous.providerId} and ${registration.id} disagree on scroll state for ${state.recipientId}`,
          },
        };
      }
      scrollByTarget.set(state.recipientId, {
        state,
        evidence: frame.evidence,
        providerId: registration.id,
      });
    }
    if (!registration.capabilities.includes('focus-state') && frame.focusState !== undefined) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published focus-state evidence it did not negotiate`,
        },
      };
    }
    if (frame.focusState !== undefined) {
      const focusedRecipientId =
        frame.focusState.status === 'focused' ? frame.focusState.recipientId : null;
      if (
        focusedRecipientId !== null &&
        !snapshot.nodes.some((node) => node.id === focusedRecipientId)
      ) {
        return {
          ok: false,
          problem: {
            kind: 'violation',
            message: `provider ${registration.id} focused unknown recipient ${focusedRecipientId}`,
          },
        };
      }
      if (focusedRecipient !== undefined && focusedRecipient.recipientId !== focusedRecipientId) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
            message: `providers ${focusedRecipient.providerId} and ${registration.id} disagree on focus state`,
          },
        };
      }
      focusedRecipient = {
        recipientId: focusedRecipientId,
        providerId: registration.id,
      };
    }
    if (
      !registration.capabilities.includes('action-recipes') &&
      frame.actionRecipes !== undefined
    ) {
      return {
        ok: false,
        problem: {
          kind: 'violation',
          message: `provider ${registration.id} published action recipes it did not negotiate`,
        },
      };
    }
    if (frame.hitGrid !== undefined) {
      if (frame.pointerRegions.some((region) => !regionsAgreeWithGrid(region, frame.hitGrid!))) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
            message: `provider ${registration.id} pointer regions disagree with its production hit test`,
          },
        };
      }
      if (providerGrid !== null && !sameGrid(providerGrid.grid, frame.hitGrid)) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
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
          JSON.stringify(previous.region.spans) !== JSON.stringify(region.spans))
      ) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
            message: `providers disagree on region for ${region.recipientId}`,
          },
        };
      }
      byTarget.set(region.recipientId, { region, evidence: frame.evidence });
    }
    for (const entry of frame.actionRecipes ?? []) {
      const target = snapshot.nodes.find((node) => node.id === entry.recipientId);
      if (target === undefined) {
        return {
          ok: false,
          problem: {
            kind: 'violation',
            message: `provider ${registration.id} published action recipes for unknown recipient ${entry.recipientId}`,
          },
        };
      }
      const intents = new Set(target.actions ?? []);
      const targetRecipes = recipesByTarget.get(entry.recipientId) ?? new Map();
      for (const recipe of entry.recipes) {
        if (!intents.has(recipe.action)) {
          return {
            ok: false,
            problem: {
              kind: 'violation',
              message: `provider ${registration.id} published ${recipe.action} without a matching semantic action intent on ${entry.recipientId}`,
            },
          };
        }
        const previous = targetRecipes.get(recipe.action);
        if (previous !== undefined && !sameRecipe(previous.recipe, recipe)) {
          return {
            ok: false,
            problem: {
              kind: 'conflict',
              message: `providers ${previous.providerId} and ${registration.id} disagree on ${recipe.action} recipe for ${entry.recipientId}`,
            },
          };
        }
        targetRecipes.set(recipe.action, {
          recipe,
          providerId: registration.id,
        });
      }
      recipesByTarget.set(entry.recipientId, targetRecipes);
    }
  }

  if (
    providerGrid !== null &&
    snapshot.hitGrid.status === 'known' &&
    !sameGrid(snapshot.hitGrid.value, providerGrid.grid)
  ) {
    return {
      ok: false,
      problem: {
        kind: 'conflict',
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
            kind: 'conflict',
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
          status: 'known' as const,
          value: providerGrid.grid,
          evidence: providerGrid.evidence,
        });
  if (focusedRecipient !== undefined) {
    for (const node of snapshot.nodes) {
      const frameworkFocused = node.state?.focused;
      const providerFocused = node.id === focusedRecipient.recipientId;
      if (frameworkFocused !== undefined && frameworkFocused !== providerFocused) {
        return {
          ok: false,
          problem: {
            kind: 'conflict',
            message: `provider ${focusedRecipient.providerId} focus state disagrees with framework focus state for ${node.id}`,
          },
        };
      }
    }
  }
  const nodes = snapshot.nodes.map((node) => {
    const provided = recipesByTarget.get(node.id);
    const focusState =
      focusedRecipient === undefined
        ? {}
        : {
            state: Object.freeze({
              ...node.state,
              focused: node.id === focusedRecipient.recipientId,
            }),
            px: Object.freeze({ ...node.px, 'state.focused': 'application' as const }),
          };
    const providedScroll = scrollByTarget.get(node.id);
    const providedPaint = paintByTarget.get(node.id);
    if (
      providedScroll !== undefined &&
      node.scroll?.status === 'known' &&
      (node.scroll.value.axis !== providedScroll.state.axis ||
        node.scroll.value.offset !== providedScroll.state.offset ||
        node.scroll.value.viewport !== providedScroll.state.viewport ||
        node.scroll.value.extent !== providedScroll.state.extent)
    ) {
      return null;
    }
    const scroll =
      providedScroll === undefined
        ? {}
        : {
            scroll: Object.freeze({
              status: 'known' as const,
              value: Object.freeze({
                axis: providedScroll.state.axis,
                offset: providedScroll.state.offset,
                viewport: providedScroll.state.viewport,
                extent: providedScroll.state.extent,
              }),
              evidence: providedScroll.evidence,
            }),
          };
    if (
      providedPaint !== undefined &&
      node.paintedRegion?.status === 'known' &&
      !samePaintedRegion(
        { recipientId: node.id, ...node.paintedRegion.value },
        providedPaint.region,
      )
    ) {
      return null;
    }
    const paintedRegion =
      providedPaint === undefined
        ? {}
        : {
            paintedRegion: Object.freeze({
              status: 'known' as const,
              value: Object.freeze({
                regionBounds: Object.freeze({ ...providedPaint.region.regionBounds }),
                spans: Object.freeze(
                  providedPaint.region.spans.map((span) => Object.freeze({ ...span })),
                ),
              }),
              evidence: providedPaint.evidence,
            }),
          };
    if (provided === undefined) {
      return Object.keys(focusState).length === 0 &&
        Object.keys(scroll).length === 0 &&
        Object.keys(paintedRegion).length === 0
        ? node
        : Object.freeze({ ...node, ...focusState, ...scroll, ...paintedRegion });
    }
    const merged = new Map(
      (node.inputRecipes ?? []).map((recipe) => [recipe.action, recipe] as const),
    );
    for (const [action, entry] of provided) {
      const existing = merged.get(action as PhysicalInputRecipe['action']);
      if (existing !== undefined && !sameRecipe(existing, entry.recipe)) {
        return null;
      }
      merged.set(action as PhysicalInputRecipe['action'], entry.recipe);
    }
    return Object.freeze({
      ...node,
      ...focusState,
      ...scroll,
      ...paintedRegion,
      inputRecipes: Object.freeze([...merged.values()]),
    });
  });
  const conflictIndex = nodes.findIndex((node) => node === null);
  if (conflictIndex !== -1) {
    const target = snapshot.nodes[conflictIndex]!;
    return {
      ok: false,
      problem: {
        kind: 'conflict',
        message: `application provider evidence disagrees with framework evidence for ${target.id}`,
      },
    };
  }
  const composedNodeIds = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (node !== snapshot.nodes[index]) composedNodeIds.add(node!.id);
  }
  return {
    ok: true,
    snapshot: Object.freeze({
      ...snapshot,
      nodes: Object.freeze(nodes as typeof snapshot.nodes),
      hitGrid,
    }),
    composedNodeIds,
    ...(providerInputModes === undefined ? {} : { inputModes: Object.freeze(providerInputModes) }),
  };
}
