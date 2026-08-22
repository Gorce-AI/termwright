import type {
  EvidenceProviderCapability,
  EvidenceProviderRegistration,
  PhysicalInputRecipe,
  PointerHitGrid,
  ProviderPointerRegion,
  ProviderPaintedRegion,
  ProviderRevisionEvidence,
  ProviderTerminalInputModes,
  SemanticScrollState,
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

export interface ApplicationPointerEvidenceObservation {
  /** Regions owned by semantic recipients in the production application. */
  readonly pointerRegions: readonly ApplicationPointerRegion[];
  /**
   * Query the application's production pointer router. This function observes
   * routing only; Termwright never calls it to dispatch an action.
   */
  readonly hitTest?: (column: number, row: number) => EvidenceRecipient | null;
}

export interface ApplicationActionStrategyObservation {
  /** Production keybindings for semantic recipients; data only, never callbacks. */
  readonly actionRecipes: readonly {
    readonly recipient: EvidenceRecipient;
    readonly recipes: readonly PhysicalInputRecipe[];
  }[];
}

export interface ApplicationFocusEvidenceObservation {
  /** Recipient selected by the application's production focus manager. */
  readonly focused: EvidenceRecipient | null;
}

export interface ApplicationScrollEvidenceObservation {
  /** Complete production viewport facts for every published scroll recipient. */
  readonly scrollStates: readonly ({
    readonly recipient: EvidenceRecipient;
  } & SemanticScrollState)[];
}

export interface ApplicationPaintEvidenceObservation {
  /** Complete production paint attribution for the committed frame. */
  readonly paintedRegions: readonly ApplicationPointerRegion[];
}

export interface ApplicationTerminalInputModeObservation {
  /** The application's actual production terminal parser configuration. */
  readonly inputModes: ProviderTerminalInputModes;
}

interface ApplicationProviderIdentity {
  readonly id: string;
  readonly version: string;
  /** `native` for a production mechanism; `declared` for an explicit app contract. */
  readonly method: "native" | "declared";
}

/** A closed provider family for production pointer ownership/routing. */
export interface ApplicationPointerEvidenceProvider
  extends ApplicationProviderIdentity {
  readonly family: "pointer";
  readonly capabilities: readonly ("pointer-regions" | "hit-test")[];
  observe(
    context: EvidenceRevisionContext,
  ): ApplicationPointerEvidenceObservation;
}

/** A closed provider family for production physical keyboard recipes. */
export interface ApplicationActionStrategyProvider
  extends ApplicationProviderIdentity {
  readonly family: "action-strategy";
  observe(
    context: EvidenceRevisionContext,
  ): ApplicationActionStrategyObservation;
}

/** A closed provider family for the application's production focus manager. */
export interface ApplicationFocusEvidenceProvider
  extends ApplicationProviderIdentity {
  readonly family: "focus";
  observe(context: EvidenceRevisionContext): ApplicationFocusEvidenceObservation;
}

/** A closed provider family for the application's production viewport model. */
export interface ApplicationScrollEvidenceProvider
  extends ApplicationProviderIdentity {
  readonly family: "scroll";
  observe(context: EvidenceRevisionContext): ApplicationScrollEvidenceObservation;
}

/** A closed provider family for the application's production painter. */
export interface ApplicationPaintEvidenceProvider
  extends ApplicationProviderIdentity {
  readonly family: "paint";
  observe(context: EvidenceRevisionContext): ApplicationPaintEvidenceObservation;
}

/** A closed provider family for production terminal parser configuration. */
export interface ApplicationTerminalInputModeEvidenceProvider
  extends ApplicationProviderIdentity {
  readonly family: "input-mode";
  observe(
    context: EvidenceRevisionContext,
  ): ApplicationTerminalInputModeObservation;
}

export type ApplicationEvidenceProvider =
  | ApplicationPointerEvidenceProvider
  | ApplicationFocusEvidenceProvider
  | ApplicationScrollEvidenceProvider
  | ApplicationPaintEvidenceProvider
  | ApplicationTerminalInputModeEvidenceProvider
  | ApplicationActionStrategyProvider;

export interface EvidenceProviderRegistrationHandle {
  /**
   * Remove a provider before negotiation. After negotiation this marks the
   * provider lost; its declaration remains part of the frozen contract.
   */
  dispose(): void;
}

interface ProviderEntry {
  readonly provider: ApplicationEvidenceProvider;
  readonly capabilities: readonly EvidenceProviderCapability[];
  active: boolean;
}

interface RegistryState {
  activeLeases: number;
  readonly entries: Map<string, ProviderEntry>;
}

export interface EvidenceProviderRegistry {
  registerPointer(
    provider: ApplicationPointerEvidenceProvider,
  ): EvidenceProviderRegistrationHandle;
  registerActionStrategies(
    provider: ApplicationActionStrategyProvider,
  ): EvidenceProviderRegistrationHandle;
  registerFocus(
    provider: ApplicationFocusEvidenceProvider,
  ): EvidenceProviderRegistrationHandle;
  registerScroll(
    provider: ApplicationScrollEvidenceProvider,
  ): EvidenceProviderRegistrationHandle;
  registerPaint(
    provider: ApplicationPaintEvidenceProvider,
  ): EvidenceProviderRegistrationHandle;
  registerInputModes(
    provider: ApplicationTerminalInputModeEvidenceProvider,
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
  provider: ApplicationEvidenceProvider,
): readonly EvidenceProviderCapability[] {
  const capabilities =
    provider.family === "action-strategy"
      ? (["action-recipes"] as const)
      : provider.family === "focus"
        ? (["focus-state"] as const)
        : provider.family === "scroll"
          ? (["scroll-state"] as const)
          : provider.family === "paint"
            ? (["painted-regions"] as const)
            : provider.family === "input-mode"
              ? (["terminal-input-modes"] as const)
            : provider.capabilities;
  const unique: EvidenceProviderCapability[] = [
    ...new Set<EvidenceProviderCapability>(capabilities as readonly EvidenceProviderCapability[]),
  ];
  if (unique.length === 0) {
    throw new TypeError(
      "provider must declare at least one evidence capability",
    );
  }
  if (
    unique.some(
      (capability) =>
        capability !== "pointer-regions" &&
        capability !== "hit-test" &&
        capability !== "focus-state" &&
        capability !== "action-recipes" &&
        capability !== "scroll-state" &&
        capability !== "painted-regions" &&
        capability !== "terminal-input-modes",
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
  const capabilities = normalizedCapabilities(provider);
  // Multiple authoritative producers may co-prove the same fact. Revision
  // composition rejects disagreement; registration order is never a winner.
  const entry: ProviderEntry = {
    provider: Object.freeze({ ...provider }),
    capabilities,
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
    entries.map(({ provider, capabilities }) =>
      Object.freeze({
        id: provider.id,
        version: provider.version,
        method: provider.method,
        capabilities: Object.freeze([...capabilities]),
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
    registerPointer: (provider: ApplicationPointerEvidenceProvider) =>
      registerIn(state, provider),
    registerActionStrategies: (provider: ApplicationActionStrategyProvider) =>
      registerIn(state, provider),
    registerFocus: (provider: ApplicationFocusEvidenceProvider) =>
      registerIn(state, provider),
    registerScroll: (provider: ApplicationScrollEvidenceProvider) =>
      registerIn(state, provider),
    registerPaint: (provider: ApplicationPaintEvidenceProvider) =>
      registerIn(state, provider),
    registerInputModes: (provider: ApplicationTerminalInputModeEvidenceProvider) =>
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
export function registerPointerEvidenceProvider(
  provider: ApplicationPointerEvidenceProvider,
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): EvidenceProviderRegistrationHandle {
  return registry.registerPointer(provider);
}

/** Register production physical input strategies before contract freeze. */
export function registerActionStrategyProvider(
  provider: ApplicationActionStrategyProvider,
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): EvidenceProviderRegistrationHandle {
  return registry.registerActionStrategies(provider);
}

/** Register production focus-manager evidence before contract freeze. */
export function registerFocusEvidenceProvider(
  provider: ApplicationFocusEvidenceProvider,
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): EvidenceProviderRegistrationHandle {
  return registry.registerFocus(provider);
}

/** Register production application viewport evidence before contract freeze. */
export function registerScrollEvidenceProvider(
  provider: ApplicationScrollEvidenceProvider,
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): EvidenceProviderRegistrationHandle {
  return registry.registerScroll(provider);
}

/** Register production paint attribution before contract freeze. */
export function registerPaintEvidenceProvider(
  provider: ApplicationPaintEvidenceProvider,
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): EvidenceProviderRegistrationHandle {
  return registry.registerPaint(provider);
}

/** Register production parser input-mode evidence before contract freeze. */
export function registerTerminalInputModeEvidenceProvider(
  provider: ApplicationTerminalInputModeEvidenceProvider,
  registry: EvidenceProviderRegistry = registryFor(defaultState()),
): EvidenceProviderRegistrationHandle {
  return registry.registerInputModes(provider);
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
    let pointerObservation: ApplicationPointerEvidenceObservation | undefined;
    let strategyObservation: ApplicationActionStrategyObservation | undefined;
    let focusObservation: ApplicationFocusEvidenceObservation | undefined;
    let scrollObservation: ApplicationScrollEvidenceObservation | undefined;
    let paintObservation: ApplicationPaintEvidenceObservation | undefined;
    let inputModeObservation: ApplicationTerminalInputModeObservation | undefined;
    if (entry.provider.family === "pointer") {
      pointerObservation = entry.provider.observe(context);
    } else if (entry.provider.family === "action-strategy") {
      strategyObservation = entry.provider.observe(context);
    } else if (entry.provider.family === "focus") {
      focusObservation = entry.provider.observe(context);
    } else if (entry.provider.family === "scroll") {
      scrollObservation = entry.provider.observe(context);
    } else if (entry.provider.family === "paint") {
      paintObservation = entry.provider.observe(context);
    } else {
      inputModeObservation = entry.provider.observe(context);
    }
    if (
      !entry.capabilities.includes("pointer-regions") &&
      pointerObservation !== undefined &&
      pointerObservation.pointerRegions.length > 0
    ) {
      throw new Error(
        "published pointer regions without negotiating pointer-regions",
      );
    }
    if (
      entry.capabilities.includes("hit-test") &&
      pointerObservation?.hitTest === undefined
    ) {
      throw new Error("negotiated hit-test callback is unavailable");
    }
    if (
      !entry.capabilities.includes("hit-test") &&
      pointerObservation?.hitTest !== undefined
    ) {
      throw new Error(
        "published a hit-test callback without negotiating hit-test",
      );
    }
    if (
      entry.capabilities.includes("action-recipes") &&
      strategyObservation?.actionRecipes === undefined
    ) {
      throw new Error("negotiated action-recipes evidence is unavailable");
    }
    if (
      !entry.capabilities.includes("action-recipes") &&
      strategyObservation?.actionRecipes !== undefined
    ) {
      throw new Error(
        "published action recipes without negotiating action-recipes",
      );
    }
    const resolve =
      context.resolveRecipient ??
      ((recipient: EvidenceRecipient): string => {
        if ("semanticId" in recipient) return recipient.semanticId;
        throw new Error("semantic recipient resolver is unavailable");
      });
    const pointerRegions = Object.freeze(
      (pointerObservation?.pointerRegions ?? []).map((region) =>
        freezeRegion(region, resolve(region.recipient)),
      ),
    );
    const hitGrid =
      pointerObservation?.hitTest === undefined
        ? undefined
        : buildHitGrid(
            pointerRegions,
            (column, row) => {
              const recipient = pointerObservation.hitTest?.(column, row) ?? null;
              return recipient === null ? null : resolve(recipient);
            },
            context,
            entry.capabilities.includes("pointer-regions"),
          );
    const actionRecipes = strategyObservation?.actionRecipes.map((entry) =>
      Object.freeze({
        recipientId: resolve(entry.recipient),
        recipes: Object.freeze(
          entry.recipes.map((recipe) =>
            Object.freeze({
              ...recipe,
              steps: Object.freeze(
                recipe.steps.map((step) => Object.freeze({ ...step })),
              ),
            }),
          ),
        ),
      }),
    );
    const scrollStates = scrollObservation?.scrollStates.map((state) => {
      if (!Number.isSafeInteger(state.offset) || !Number.isSafeInteger(state.viewport) || !Number.isSafeInteger(state.extent) || state.offset < 0 || state.viewport < 0 || state.extent < 0 || state.offset + state.viewport > state.extent) {
        throw new Error("scroll state must contain non-negative safe integers within its extent");
      }
      return Object.freeze({
        recipientId: resolve(state.recipient),
        axis: state.axis,
        offset: state.offset,
        viewport: state.viewport,
        extent: state.extent,
      });
    });
    const paintedRegions: readonly ProviderPaintedRegion[] | undefined =
      paintObservation?.paintedRegions.map((region) =>
        freezeRegion(region, resolve(region.recipient)),
      );
    const inputModes = inputModeObservation?.inputModes;
    if (inputModes !== undefined) validateInputModes(inputModes);
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
      ...(focusObservation === undefined
        ? {}
        : {
            focusState:
              focusObservation.focused === null
                ? Object.freeze({ status: "none" as const })
                : Object.freeze({
                    status: "focused" as const,
                    recipientId: resolve(focusObservation.focused),
                  }),
          }),
      ...(actionRecipes === undefined
        ? {}
        : { actionRecipes: Object.freeze(actionRecipes) }),
      ...(scrollStates === undefined
        ? {}
        : { scrollStates: Object.freeze(scrollStates) }),
      ...(paintedRegions === undefined
        ? {}
        : { paintedRegions: Object.freeze(paintedRegions) }),
      ...(inputModes === undefined
        ? {}
        : { inputModes: Object.freeze({ ...inputModes }) }),
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

function validateInputModes(modes: ProviderTerminalInputModes): void {
  if (!["none", "x10", "vt200", "drag", "any"].includes(modes.mouseTracking)) {
    throw new Error("input modes contain an invalid mouseTracking value");
  }
  if (!["default", "sgr", "urxvt", "utf8"].includes(modes.mouseEncoding)) {
    throw new Error("input modes contain an invalid mouseEncoding value");
  }
  if (modes.focusReporting !== "on" && modes.focusReporting !== "off") {
    throw new Error("input modes contain an invalid focusReporting value");
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
