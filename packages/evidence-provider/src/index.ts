import type {
  EvidenceProviderCapability,
  EvidenceProviderRegistration,
  PointerHitGrid,
  ProviderPointerRegion,
  ProviderRevisionEvidence,
  Rect,
} from "@termwright/protocol";

const REGISTRY = Symbol.for("termwright.application-evidence-providers.v1");

export interface EvidenceRevisionContext {
  /** Driver-issued session identity; prevents revision reuse across reconnects. */
  readonly sessionId: string;
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
}

/** Stable way for application routing to name a semantic recipient. */
export type EvidenceRecipient =
  | { readonly semanticId: string }
  | { readonly testId: string }
  | { readonly role: string; readonly name: string };

export interface ApplicationPointerRegion {
  readonly recipient: EvidenceRecipient;
  readonly regionBounds: Rect;
  readonly spans: readonly {
    readonly row: number;
    readonly from: number;
    readonly to: number;
  }[];
}

export interface ApplicationEvidenceObservation {
  /** Regions owned by semantic recipients in the production application. */
  readonly pointerRegions: readonly ApplicationPointerRegion[];
  /**
   * Query the application's production pointer router. This function observes
   * routing only; Termwright never calls it to dispatch an action.
   */
  readonly hitTest?: (column: number, row: number) => EvidenceRecipient | null;
}

export interface ApplicationEvidenceProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly EvidenceProviderCapability[];
  /** `native` for a production router; `declared` for explicit region contracts. */
  readonly method: "native" | "declared";
  observe(context: EvidenceRevisionContext): ApplicationEvidenceObservation;
}

export interface EvidenceProviderRegistrationHandle {
  /**
   * Remove a provider before negotiation. After negotiation this marks the
   * provider lost; its declaration remains part of the frozen contract.
   */
  dispose(): void;
}

interface ProviderEntry {
  readonly provider: ApplicationEvidenceProvider;
  active: boolean;
}

interface RegistryState {
  activeLeases: number;
  readonly entries: Map<string, ProviderEntry>;
}

export interface EvidenceProviderRegistry {
  register(
    provider: ApplicationEvidenceProvider,
  ): EvidenceProviderRegistrationHandle;
  /** @internal Framework probes lease a frozen declaration set per session. */
  freeze(): FrozenEvidenceProviderRegistry;
}

export interface FrozenEvidenceProviderRegistry {
  readonly registrations: readonly EvidenceProviderRegistration[];
  collect(
    context: EvidenceRevisionContext & {
      /** @internal Strict adapter-owned semantic recipient resolution. */
      readonly resolveRecipient?: (recipient: EvidenceRecipient) => string;
    },
  ): readonly ProviderRevisionEvidence[];
  close(): void;
}

function defaultState(): RegistryState {
  const host = globalThis as typeof globalThis & { [REGISTRY]?: RegistryState };
  return (host[REGISTRY] ??= { activeLeases: 0, entries: new Map() });
}

function assertIdentifier(value: string, field: string): void {
  if (value.length === 0 || value.length > 128) {
    throw new TypeError(`${field} must contain 1..128 characters`);
  }
}

function normalizedCapabilities(
  capabilities: readonly EvidenceProviderCapability[],
): readonly EvidenceProviderCapability[] {
  const unique = [...new Set(capabilities)];
  if (unique.length === 0) {
    throw new TypeError(
      "provider must declare at least one evidence capability",
    );
  }
  if (
    unique.some(
      (capability) =>
        capability !== "pointer-regions" && capability !== "hit-test",
    )
  ) {
    throw new TypeError("provider declares an unknown evidence capability");
  }
  return Object.freeze(unique);
}

/** Register application-owned evidence before the framework probe connects. */
function registerIn(
  registry: RegistryState,
  provider: ApplicationEvidenceProvider,
): EvidenceProviderRegistrationHandle {
  if (registry.activeLeases > 0) {
    throw new EvidenceProviderLifecycleError(
      `provider ${provider.id || "<empty>"} registered after the session contract was frozen`,
    );
  }
  assertIdentifier(provider.id, "provider id");
  assertIdentifier(provider.version, "provider version");
  if (registry.entries.has(provider.id)) {
    throw new EvidenceProviderLifecycleError(
      `provider ${provider.id} is already registered`,
    );
  }
  const capabilities = normalizedCapabilities(provider.capabilities);
  for (const existing of registry.entries.values()) {
    const competingCapability = capabilities.find((capability) =>
      existing.provider.capabilities.includes(capability),
    );
    if (competingCapability !== undefined) {
      throw new EvidenceProviderLifecycleError(
        `providers ${existing.provider.id} and ${provider.id} both claim exclusive ${competingCapability} ownership`,
      );
    }
  }
  const entry: ProviderEntry = {
    provider: Object.freeze({
      ...provider,
      capabilities,
    }),
    active: true,
  };
  registry.entries.set(provider.id, entry);
  return Object.freeze({
    dispose() {
      if (!entry.active) return;
      entry.active = false;
      registry.entries.delete(provider.id);
    },
  });
}

function freezeState(registry: RegistryState): FrozenEvidenceProviderRegistry {
  registry.activeLeases += 1;
  const entries = [...registry.entries.values()];
  const registrations = Object.freeze(
    entries.map(({ provider }) =>
      Object.freeze({
        id: provider.id,
        version: provider.version,
        method: provider.method,
        capabilities: Object.freeze([...provider.capabilities]),
      }),
    ),
  );
  let closed = false;
  return Object.freeze({
    registrations,
    collect(
      context: EvidenceRevisionContext,
    ): readonly ProviderRevisionEvidence[] {
      return Object.freeze(
        entries.map((entry) => collectEntry(entry, context)),
      );
    },
    close(): void {
      if (closed) return;
      closed = true;
      registry.activeLeases -= 1;
    },
  });
}

function registryFor(state: RegistryState): EvidenceProviderRegistry {
  return Object.freeze({
    register: (provider: ApplicationEvidenceProvider) =>
      registerIn(state, provider),
    freeze: () => freezeState(state),
  });
}

/** Create an isolated registry for an application or component host. */
export function createEvidenceProviderRegistry(): EvidenceProviderRegistry {
  return registryFor({ activeLeases: 0, entries: new Map() });
}

/**
 * Register in the process facade used by zero-config probes. Pass an explicit
 * registry when one process hosts independently configured applications.
 */
export function registerEvidenceProvider(
  provider: ApplicationEvidenceProvider,
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): EvidenceProviderRegistrationHandle {
  return registry.register(provider);
}

/** @internal Framework probes create one frozen lease per connection. */
export function freezeEvidenceProviders(
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): FrozenEvidenceProviderRegistry {
  return registry.freeze();
}

function collectEntry(
  entry: ProviderEntry,
  context: EvidenceRevisionContext & {
    readonly resolveRecipient?: (recipient: EvidenceRecipient) => string;
  },
): ProviderRevisionEvidence {
  const providerId = entry.provider.id;
  if (!entry.active) {
    return Object.freeze({
      providerId,
      sessionId: context.sessionId,
      revision: context.revision,
      status: "lost" as const,
      reason: "provider was disposed after negotiation",
    });
  }
  try {
    const observation = entry.provider.observe(context);
    if (
      !entry.provider.capabilities.includes("pointer-regions") &&
      observation.pointerRegions.length > 0
    ) {
      throw new Error(
        "published pointer regions without negotiating pointer-regions",
      );
    }
    if (
      entry.provider.capabilities.includes("hit-test") &&
      observation.hitTest === undefined
    ) {
      throw new Error("negotiated hit-test callback is unavailable");
    }
    if (
      !entry.provider.capabilities.includes("hit-test") &&
      observation.hitTest !== undefined
    ) {
      throw new Error(
        "published a hit-test callback without negotiating hit-test",
      );
    }
    const resolve =
      context.resolveRecipient ??
      ((recipient: EvidenceRecipient): string => {
        if ("semanticId" in recipient) return recipient.semanticId;
        throw new Error("semantic recipient resolver is unavailable");
      });
    const pointerRegions = Object.freeze(
      observation.pointerRegions.map((region) =>
        freezeRegion(region, resolve(region.recipient)),
      ),
    );
    const hitGrid =
      observation.hitTest === undefined
        ? undefined
        : buildHitGrid(
            pointerRegions,
            (column, row) => {
              const recipient = observation.hitTest?.(column, row) ?? null;
              return recipient === null ? null : resolve(recipient);
            },
            context,
            entry.provider.capabilities.includes("pointer-regions"),
          );
    return Object.freeze({
      providerId,
      sessionId: context.sessionId,
      revision: context.revision,
      status: "available" as const,
      evidence: Object.freeze({
        source: "application" as const,
        method: entry.provider.method,
        strength: "authoritative" as const,
        providerId,
      }),
      pointerRegions,
      ...(hitGrid === undefined ? {} : { hitGrid }),
    });
  } catch (error) {
    return Object.freeze({
      providerId,
      sessionId: context.sessionId,
      revision: context.revision,
      status: "violation" as const,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function freezeRegion(
  region: ApplicationPointerRegion,
  recipientId: string,
): ProviderPointerRegion {
  return Object.freeze({
    recipientId,
    regionBounds: Object.freeze({ ...region.regionBounds }),
    spans: Object.freeze(
      region.spans.map((span) => Object.freeze({ ...span })),
    ),
  });
}

function buildHitGrid(
  regions: readonly ProviderPointerRegion[],
  hitTest: (column: number, row: number) => string | null,
  context: EvidenceRevisionContext,
  verifyDeclaredRegions: boolean,
): PointerHitGrid {
  const cellCount = context.columns * context.rows;
  if (!Number.isSafeInteger(cellCount) || cellCount > 1_000_000) {
    throw new Error(
      `hit-test viewport ${context.columns}x${context.rows} exceeds the 1000000-cell provider limit`,
    );
  }
  const declared = new Map<string, string>();
  for (const region of regions) {
    for (const span of region.spans) {
      for (let column = span.from; column < span.to; column += 1) {
        if (
          span.row >= 0 &&
          span.row < context.rows &&
          column >= 0 &&
          column < context.columns
        ) {
          const key = `${span.row}:${column}`;
          const previous = declared.get(key);
          if (previous !== undefined && previous !== region.recipientId) {
            throw new Error(
              `declared pointer regions overlap at ${column},${span.row}`,
            );
          }
          declared.set(key, region.recipientId);
        }
      }
    }
  }
  const rows = new Map<number, { column: number; recipientId: string }[]>();
  for (let row = 0; row < context.rows; row += 1) {
    for (let column = 0; column < context.columns; column += 1) {
      const actual = hitTest(column, row);
      const expected = declared.get(`${row}:${column}`) ?? null;
      if (verifyDeclaredRegions && actual !== expected) {
        throw new Error(
          `production hit test returned ${String(actual)} at ${column},${row}; declared pointer owner is ${String(expected)}`,
        );
      }
      if (actual === null) continue;
      const rowCells = rows.get(row) ?? [];
      rowCells.push({ column, recipientId: actual });
      rows.set(row, rowCells);
    }
  }
  const output: { recipientId: string; rect: Rect }[] = [];
  for (const [row, rowCells] of [...rows].sort(
    ([left], [right]) => left - right,
  )) {
    rowCells.sort((left, right) => left.column - right.column);
    let start = rowCells[0];
    if (start === undefined) continue;
    let end = start.column + 1;
    for (const cell of rowCells.slice(1)) {
      if (cell.column === end && cell.recipientId === start.recipientId) {
        end += 1;
        continue;
      }
      output.push({
        recipientId: start.recipientId,
        rect: {
          row,
          column: start.column,
          width: end - start.column,
          height: 1,
        },
      });
      start = cell;
      end = cell.column + 1;
    }
    output.push({
      recipientId: start.recipientId,
      rect: { row, column: start.column, width: end - start.column, height: 1 },
    });
  }
  return Object.freeze({
    regions: Object.freeze(
      output.map((region) =>
        Object.freeze({
          recipientId: region.recipientId,
          rect: Object.freeze(region.rect),
        }),
      ),
    ),
  });
}

export class EvidenceProviderLifecycleError extends Error {
  override readonly name = "EvidenceProviderLifecycleError";
}

/** @internal Test isolation for the SDK package itself. */
export function resetEvidenceProvidersForTesting(): void {
  const host = globalThis as typeof globalThis & { [REGISTRY]?: RegistryState };
  delete host[REGISTRY];
}
