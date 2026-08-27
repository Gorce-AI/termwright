/**
 * Locators: lazy handles that are re-resolved before every action.
 *
 * Strict by default (design §5.2): zero matches wait until the deadline, more
 * than one match fails with bounded candidate diagnostics. `first()`/`nth()`
 * opt out of the ambiguity check but never out of waiting.
 *
 * Every action goes through the PTY. There is no semantic callback channel —
 * clicking a button writes the same bytes a human's terminal would.
 */
import type {
  LocatorGeometry,
  LocatorVisibility,
  CoordinateSpace,
  ActionabilityExplanation,
  ActionIntent,
  ExecutableActionPlan,
  ActionReceipt,
  ArtifactValuePolicy,
  Condition,
  ExecutableDeviceOperation,
  ExecutableValue,
  Observation,
  ObservationStamp,
  PointerHitTest,
  Rect,
  EvidenceProvenance,
  SemanticExtendedState,
  SemanticNode,
  SemanticState,
  SemanticScrollState,
  SemanticValueObservation,
  ViewportIntersection,
} from '@termwright/protocol';
import { recordActionPlan, recordDeviceOperation } from '@termwright/protocol';
import type {
  CellSnapshot,
  ErrorDiagnostics,
  AnyLocator,
  LocatorCellSnapshot,
  LocatorCellSnapshotOptions,
  SemanticLocatorFilterOptions,
  ScreenLocatorFilterOptions,
  LocatorDragOptions,
  LocatorWheelOptions,
  PointerOptions,
  ResolvedTarget,
  RoleLocatorOptions,
  ScreenTextLocatorOptions,
  TextLocatorOptions,
  TerminalModes,
  TimeoutClasses,
  WaitOptions,
} from './api.js';
import {
  AmbiguousLocatorError,
  CapabilityUnavailableError,
  SemanticCapabilityUnavailableError,
  StaleSnapshotError,
  TermwrightError,
  TimeoutError,
} from './errors.js';
import { unwrap } from './debug.js';
import {
  ActionPlanner,
  evaluateCondition as evaluateCanonicalCondition,
  isAuthoritativeRegionOwnership,
  type LeafCondition,
} from './action-planner.js';
import { ActionRetryController } from './internal/action-retry.js';
import { Deadline } from './internal/deadline.js';
import { matchGrid, matchSemantic, textInRect, type SemanticIndex } from './matching.js';
import type { CapturedRow } from './screen.js';
import {
  gridQuery,
  labelQuery,
  parseSelector,
  semanticNodeId,
  roleQuery,
  testIdQuery,
  textMatcher,
  textQuery,
  type GenericQuery,
  type LocatorQuery,
  type RefQuery,
  type SemanticQuery,
  type TextMatcher,
} from './selectors.js';

/** Everything a locator needs from its session. */
export interface LocatorContext {
  readonly sessionId: string;
  readonly timeouts: Required<TimeoutClasses>;
  readonly artifactValuePolicy: ArtifactValuePolicy;
  operationTimeout?(requestedMs: number, operation: string): number;
  actionObservationState():
    'settled' | 'parser-in-flight' | 'semantic-frame-open' | 'pairing-pending';
  negotiationPending(): boolean;
  /** Resolves once semantic negotiation has settled one way or the other. */
  negotiationSettled(): Promise<void>;
  semanticIndex(): SemanticIndex | null;
  /** True once an adapter completed the handshake, even before its first tree. */
  semanticAttached(): boolean;
  /** True while a semantic tree may still arrive (negotiation or grace open). */
  semanticPossible(): boolean;
  /** The error that closed the semantic channel, if one did. */
  semanticViolation(): TermwrightError | null;
  semanticRevision(): number;
  screenRevision(): number;
  checkpoint(): ObservationStamp;
  contract(): import('@termwright/protocol').EffectiveSessionContract | null;
  semanticNode(id: string): SemanticNode | undefined;
  hitGrid(): Observation<import('@termwright/protocol').PointerHitGrid> | undefined;
  pointerRegion(id: string):
    | {
        readonly regionBounds: Rect;
        readonly spans: import('@termwright/protocol').PhysicalRegion['spans'];
        readonly evidence: EvidenceProvenance;
      }
    | undefined;
  screenRegionUnchangedSince(
    revision: number,
    spans: import('@termwright/protocol').PhysicalRegion['spans'],
  ): boolean;
  /** Why the region is unusable at that revision; see VtScreen.regionChangeSince. */
  screenRegionChangeSince?(
    revision: number,
    spans: import('@termwright/protocol').PhysicalRegion['spans'],
  ): string;
  rows(): readonly CapturedRow[];
  modes(): TerminalModes;
  /** The best identity the attached producer can offer for a node. */
  identityKind(): ResolvedTarget['identity'];
  /** True only when semantic bounds address absolute terminal cells. */
  semanticBoundsAreAbsolute(): boolean;
  /** Resolves when a screen or semantic revision is published, or the deadline passes. */
  waitForChange(deadline: number): Promise<void>;
  armChange?(deadline: number): { wait(): Promise<void>; cancel(): void };
  /** Reports the exact causal boundary an action is waiting to cross. */
  actionObservationWait?(
    actionId: string,
    state: 'parser-in-flight' | 'semantic-frame-open' | 'pairing-pending',
  ): void;
  sendInput(data: Uint8Array, kind: 'key' | 'mouse' | 'paste' | 'raw'): Promise<void>;
  executeDeviceOperations(
    operations: readonly ExecutableDeviceOperation[],
    expected: ObservationStamp,
    deadline?: number,
  ): Promise<readonly ExecutableDeviceOperation[]>;
  /** Publishes the start of an action and returns its session-local id. */
  beginAction(api: string, about?: { selector?: string }): string;
  /** Publishes the authoritative completion of an action. */
  endAction(
    actionId: string,
    api: string,
    ok: boolean,
    about?: {
      selector?: string;
      ref?: string;
      error?: string;
      receipt?: ActionReceipt;
      actionability?: ActionabilityExplanation;
    },
  ): void;
  errorDiagnostics(extra?: Partial<ErrorDiagnostics>): ErrorDiagnostics;
  assertOpen(): void;
}

/** Maximum candidates rendered into an ambiguity diagnostic. */
const MAX_CANDIDATES = 10;

const EVIDENCE_BY_KIND = Object.freeze({
  adapter: Object.freeze({
    source: 'application',
    method: 'declared',
    strength: 'authoritative',
    providerId: 'semantic-adapter',
  }),
  probe: Object.freeze({
    source: 'framework',
    method: 'instrumented',
    strength: 'authoritative',
    providerId: 'framework-probe',
  }),
  'terminal-grid': Object.freeze({
    source: 'terminal',
    method: 'native',
    strength: 'authoritative',
    providerId: 'termwright-vt',
  }),
  'viewport-clip': Object.freeze({
    source: 'driver',
    method: 'derived',
    strength: 'authoritative',
    providerId: 'termwright-driver',
  }),
  'paint-order': Object.freeze({
    source: 'framework',
    method: 'instrumented',
    strength: 'authoritative',
    providerId: 'framework-probe',
  }),
  'hit-grid': Object.freeze({
    source: 'framework',
    method: 'instrumented',
    strength: 'authoritative',
    providerId: 'framework-hit-grid',
  }),
} as const satisfies Record<string, EvidenceProvenance>);

function known<T>(
  value: T,
  evidence: EvidenceProvenance | keyof typeof EVIDENCE_BY_KIND,
): Observation<T> {
  return Object.freeze({
    status: 'known',
    value,
    evidence: typeof evidence === 'string' ? EVIDENCE_BY_KIND[evidence] : evidence,
  });
}

function absent<T>(
  reason: 'detached' | 'not-displayed' | 'not-laid-out',
  evidence: EvidenceProvenance | keyof typeof EVIDENCE_BY_KIND,
): Observation<T> {
  const provenance = typeof evidence === 'string' ? EVIDENCE_BY_KIND[evidence] : evidence;
  if (provenance.strength !== 'authoritative')
    throw new TypeError('absent observation requires authoritative evidence');
  return Object.freeze({
    status: 'absent',
    reason,
    evidence: Object.freeze({ ...provenance, strength: 'authoritative' as const }),
  });
}

function withoutValue<T>(observation: Observation<unknown>): Observation<T> {
  switch (observation.status) {
    case 'known':
      throw new TypeError('cannot erase a known observation value');
    case 'absent':
      return Object.freeze({
        status: 'absent',
        reason: observation.reason,
        evidence: observation.evidence,
      });
    case 'unknown':
      return Object.freeze({ status: 'unknown', reason: observation.reason });
    case 'unsupported':
      return Object.freeze({
        status: 'unsupported',
        capability: observation.capability,
        reason: observation.reason,
      });
  }
}

interface LocatorFilter {
  readonly hasText?: TextMatcher;
  readonly has?: LocatorExpr;
  readonly hasNot?: LocatorExpr;
}

type LocatorDomain = 'semantic' | 'screen';

/** Immutable lazy query algebra. Operator order is part of the expression. */
type LocatorExpr =
  | { readonly kind: 'leaf'; readonly query: LocatorQuery; readonly domain: LocatorDomain }
  | {
      readonly kind: 'descendant';
      readonly parent: LocatorExpr;
      readonly child: LocatorExpr;
      readonly domain: LocatorDomain;
    }
  | {
      readonly kind: 'select';
      readonly source: LocatorExpr;
      readonly index: number | 'last';
      readonly domain: LocatorDomain;
    }
  | {
      readonly kind: 'filter';
      readonly source: LocatorExpr;
      readonly filter: LocatorFilter;
      readonly domain: LocatorDomain;
    }
  | {
      readonly kind: 'and' | 'or';
      readonly left: LocatorExpr;
      readonly right: LocatorExpr;
      readonly domain: LocatorDomain;
    };

function queryDomain(query: LocatorQuery): LocatorDomain {
  if (query.kind === 'semantic') return 'semantic';
  if (query.kind === 'generic') return 'screen';
  return query.ref.kind === 'node' ? 'semantic' : 'screen';
}

function describeExpr(expr: LocatorExpr): string {
  switch (expr.kind) {
    case 'leaf':
      return expr.query.description;
    case 'descendant':
      return `${describeExpr(expr.parent)} >> ${describeExpr(expr.child)}`;
    case 'select':
      return `${describeExpr(expr.source)} >> ${expr.index === 'last' ? 'last()' : `nth(${expr.index})`}`;
    case 'filter':
      return `${describeExpr(expr.source)} >> filter()`;
    case 'and':
      return `(${describeExpr(expr.left)}) and (${describeExpr(expr.right)})`;
    case 'or':
      return `(${describeExpr(expr.left)}) or (${describeExpr(expr.right)})`;
  }
}

function nodeTarget(
  node: SemanticNode,
  revision: number,
  identity: ResolvedTarget['identity'],
): ResolvedTarget {
  return Object.freeze({
    domain: 'semantic',
    ref: `semantic:${node.id}@${revision}`,
    revision,
    semantic: true,
    // Only a qualified visible region is a safe semantic-to-physical bridge.
    // Intended geometry remains available through geometry(), but is not
    // silently promoted to action coordinates.
    rect: node.geometry?.visibleRect.status === 'known' ? node.geometry.visibleRect.value : null,
    role: node.role,
    name: node.name,
    identity,
    ...(node.frameworkType !== undefined ? { frameworkType: node.frameworkType } : {}),
    ...(node.p !== undefined ? { provenance: node.p } : {}),
  });
}

function rectTarget(rect: Rect, revision: number): ResolvedTarget {
  return Object.freeze({
    domain: 'screen',
    ref: `screen:${rect.row},${rect.column},${rect.width},${rect.height}@${revision}`,
    revision,
    // A grid ref carries its own coordinates, so it re-resolves by
    // construction whatever the framework can or cannot identify.
    identity: 'stable' as const,
    semantic: false,
    rect,
  });
}

/** Internal engine behind both public locator domains. */
export class LocatorImpl {
  readonly #ctx: LocatorContext;
  readonly #expr: LocatorExpr;

  constructor(ctx: LocatorContext, query: LocatorQuery, expr?: LocatorExpr) {
    this.#ctx = ctx;
    this.#expr = expr ?? Object.freeze({ kind: 'leaf', query, domain: queryDomain(query) });
  }

  /** Human-readable form used in error messages. */
  get description(): string {
    return describeExpr(this.#expr);
  }

  get domain(): LocatorDomain {
    return this.#expr.domain;
  }

  #timeout(requestedMs: number, operation: string): number {
    return this.#ctx.operationTimeout?.(requestedMs, `locator.${operation}`) ?? requestedMs;
  }

  within(parent: AnyLocator): AnyLocator {
    // A debug-instrumented locator is a Proxy; the raw object is what may be
    // stored and later reached into.
    const raw = unwrap(parent);
    if (!(raw instanceof LocatorImpl) || raw.#ctx !== this.#ctx) {
      throw new TypeError('within() requires a locator from the same terminal session');
    }
    this.#assertDomain(raw.#expr.domain, 'within()');
    return this.#fromExpr(
      Object.freeze({
        kind: 'descendant',
        parent: raw.#expr,
        child: this.#expr,
        domain: this.#expr.domain,
      }),
    ) as unknown as AnyLocator;
  }

  getByRole(
    role: import('@termwright/protocol').SemanticRole,
    opts?: RoleLocatorOptions,
  ): AnyLocator {
    const name = opts?.name === undefined ? undefined : textMatcher(opts.name, opts.exact ?? false);
    const frameworkType =
      opts?.frameworkType === undefined ? undefined : textMatcher(opts.frameworkType, true);
    return this.#descendant(roleQuery(role, name, opts?.state ?? {}, frameworkType));
  }

  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): AnyLocator {
    return this.#descendant(labelQuery(textMatcher(text, opts?.exact ?? false)));
  }

  getByText(text: string | RegExp, opts?: TextLocatorOptions): AnyLocator {
    return this.#descendant(textQuery(textMatcher(text, opts?.exact ?? false)));
  }

  getByScreenText(text: string | RegExp, opts?: ScreenTextLocatorOptions): AnyLocator {
    const style =
      opts?.fg !== undefined || opts?.bg !== undefined || opts?.attributes !== undefined
        ? {
            ...(opts.fg !== undefined ? { fg: opts.fg } : {}),
            ...(opts.bg !== undefined ? { bg: opts.bg } : {}),
            ...(opts.attributes !== undefined ? { attributes: opts.attributes } : {}),
          }
        : undefined;
    return this.#descendant(
      gridQuery(textMatcher(text, opts?.exact ?? false), opts?.occurrence, style),
    );
  }

  getByTestId(testId: string): AnyLocator {
    return this.#descendant(testIdQuery(testId));
  }

  locator(selector: string): AnyLocator {
    return this.#descendant(parseSelector(selector));
  }

  #descendant(query: LocatorQuery): AnyLocator {
    const child = Object.freeze<LocatorExpr>({ kind: 'leaf', query, domain: queryDomain(query) });
    this.#assertDomain(child.domain, 'descendant locator');
    return this.#fromExpr(
      Object.freeze({ kind: 'descendant', parent: this.#expr, child, domain: child.domain }),
    ) as unknown as AnyLocator;
  }

  #fromExpr(expr: LocatorExpr): LocatorImpl {
    const leaf = this.#firstLeaf(expr);
    return new LocatorImpl(this.#ctx, leaf.query, expr);
  }

  #firstLeaf(expr: LocatorExpr): Extract<LocatorExpr, { kind: 'leaf' }> {
    if (expr.kind === 'leaf') return expr;
    if (expr.kind === 'descendant') return this.#firstLeaf(expr.parent);
    if (expr.kind === 'select' || expr.kind === 'filter') return this.#firstLeaf(expr.source);
    return this.#firstLeaf(expr.left);
  }

  #assertDomain(domain: LocatorDomain, api: string): void {
    if (domain !== this.#expr.domain) {
      throw new TypeError(
        `${api} cannot combine semantic and terminal-grid locators; use an explicit screen query instead`,
      );
    }
  }

  first(): AnyLocator {
    return this.nth(0);
  }

  last(): AnyLocator {
    return this.#fromExpr(
      Object.freeze({
        kind: 'select',
        source: this.#expr,
        index: 'last',
        domain: this.#expr.domain,
      }),
    ) as unknown as AnyLocator;
  }

  nth(index: number): AnyLocator {
    if (!Number.isInteger(index) || index < 0) {
      throw new TypeError(`nth() needs a non-negative integer, received ${index}`);
    }
    return this.#fromExpr(
      Object.freeze({ kind: 'select', source: this.#expr, index, domain: this.#expr.domain }),
    ) as unknown as AnyLocator;
  }

  filter(options: SemanticLocatorFilterOptions | ScreenLocatorFilterOptions): AnyLocator {
    const has =
      options.has === undefined ? undefined : this.#sameHarness(options.has, 'filter({has})');
    const hasNot =
      options.hasNot === undefined
        ? undefined
        : this.#sameHarness(options.hasNot, 'filter({hasNot})');
    if (options.hasText === undefined && has === undefined && hasNot === undefined) {
      throw new TypeError('filter() requires hasText, has, or hasNot');
    }
    const filter: LocatorFilter = {
      ...(options.hasText === undefined ? {} : { hasText: textMatcher(options.hasText) }),
      ...(has === undefined ? {} : { has: has.#expr }),
      ...(hasNot === undefined ? {} : { hasNot: hasNot.#expr }),
    };
    return this.#fromExpr(
      Object.freeze({
        kind: 'filter',
        source: this.#expr,
        filter: Object.freeze(filter),
        domain: this.#expr.domain,
      }),
    ) as unknown as AnyLocator;
  }

  and(other: AnyLocator): AnyLocator {
    return this.#combine('and', other);
  }

  or(other: AnyLocator): AnyLocator {
    return this.#combine('or', other);
  }

  #combine(mode: 'and' | 'or', other: AnyLocator): AnyLocator {
    const right = this.#sameHarness(other, `${mode}()`);
    this.#assertDomain(right.#expr.domain, `${mode}()`);
    return this.#fromExpr(
      Object.freeze({
        kind: mode,
        left: this.#expr,
        right: right.#expr,
        domain: this.#expr.domain,
      }),
    ) as unknown as AnyLocator;
  }

  #sameHarness(locator: AnyLocator, api: string): LocatorImpl {
    const raw = unwrap(locator);
    if (!(raw instanceof LocatorImpl) || raw.#ctx !== this.#ctx) {
      throw new TypeError(`${api} requires a locator from the same terminal session`);
    }
    return raw;
  }

  async count(): Promise<number> {
    this.#ctx.assertOpen();
    const deadline = Deadline.after(this.#timeout(this.#ctx.timeouts.action, 'count'));
    await this.#awaitNegotiation(deadline, 'count()');
    while (
      this.#expr.domain === 'semantic' &&
      this.#ctx.semanticIndex() === null &&
      this.#ctx.semanticPossible()
    ) {
      if (deadline.expired()) break;
      await this.#ctx.waitForChange(deadline.at);
    }
    return this.#evaluate(this.#expr, null).length;
  }

  async resolve(opts?: WaitOptions): Promise<ResolvedTarget> {
    this.#ctx.assertOpen();
    const deadline = Deadline.after(
      this.#timeout(opts?.timeout ?? this.#ctx.timeouts.action, 'resolve'),
    );
    await this.#awaitNegotiation(deadline, 'resolve()');
    for (;;) {
      this.#ctx.assertOpen();
      const matches = this.#evaluate(this.#expr, null);
      const selected = this.#select(matches);
      if (selected !== null) return selected;
      if (deadline.expired()) {
        throw new TimeoutError(
          `locator ${this.description} matched ${matches.length} nodes; expected exactly one`,
          this.#ctx.errorDiagnostics({
            candidates: matches.slice(0, MAX_CANDIDATES),
            suggestion:
              matches.length === 0
                ? 'check the selector against screen() output, or await a wait helper before acting'
                : 'narrow the locator with within(), a name option, or select one with first()/nth()',
          }),
        );
      }
      await this.#ctx.waitForChange(deadline.at);
    }
  }

  checkpoint(): ObservationStamp {
    return this.#ctx.checkpoint();
  }

  async waitForCheckpointChange(
    options: { readonly after: ObservationStamp } & WaitOptions,
  ): Promise<ObservationStamp> {
    const deadline = Deadline.after(
      this.#timeout(options.timeout ?? this.#ctx.timeouts.action, 'waitForCheckpointChange'),
    );
    for (;;) {
      const armChange = this.#ctx.armChange;
      if (armChange === undefined)
        throw new Error('locator context does not implement race-free observation arming');
      const arm = armChange.call(this.#ctx, deadline.at);
      const current = this.#ctx.checkpoint();
      if (
        current.sessionId !== options.after.sessionId ||
        current.contractId !== options.after.contractId
      ) {
        arm.cancel();
        throw new StaleSnapshotError(
          'checkpoint belongs to a different locator session contract',
          this.#ctx.errorDiagnostics(),
        );
      }
      if (current.sequence > options.after.sequence) {
        arm.cancel();
        return current;
      }
      if (deadline.expired()) {
        arm.cancel();
        throw new TimeoutError(
          `locator observation did not advance beyond ${options.after.sequence}`,
          this.#ctx.errorDiagnostics(),
        );
      }
      await arm.wait();
    }
  }

  async waitFor(
    opts?: {
      state?:
        | 'visible'
        | 'hidden'
        | 'attached'
        | 'detached'
        | 'displayed'
        | 'offscreen'
        | 'focused'
        | 'enabled'
        | 'disabled'
        | 'checked'
        | 'selected'
        | 'expanded'
        | 'collapsed';
    } & WaitOptions,
  ): Promise<void> {
    this.#ctx.assertOpen();
    const wanted = opts?.state ?? 'visible';
    const deadline = Deadline.after(
      this.#timeout(
        opts?.timeout ?? this.#ctx.timeouts.action,
        `waitFor(${opts?.state ?? 'visible'})`,
      ),
    );
    await this.#awaitNegotiation(deadline, `waitFor(${wanted})`);
    for (;;) {
      this.#ctx.assertOpen();
      const matches = await this.#tryEvaluate(deadline.at);
      const selected = this.#select(matches);
      const condition: Condition =
        wanted === 'checked'
          ? { kind: 'checked', target: this.description, value: true }
          : wanted === 'selected'
            ? { kind: 'selected', target: this.description, value: true }
            : wanted === 'expanded'
              ? { kind: 'expanded', target: this.description, value: true }
              : { kind: wanted, target: this.description };
      const evaluation = evaluateCanonicalCondition(condition, this.#ctx.checkpoint(), (leaf) =>
        this.#observeCondition(leaf, selected),
      );
      if (evaluation.verdict === 'satisfied') return;
      if (deadline.expired()) {
        throw new TimeoutError(
          `locator ${this.description} did not become ${wanted} in time`,
          this.#ctx.errorDiagnostics({ candidates: matches.slice(0, MAX_CANDIDATES) }),
        );
      }
      await this.#ctx.waitForChange(deadline.at);
    }
  }

  async evaluateCondition(
    condition: Condition,
    opts?: WaitOptions,
  ): Promise<import('@termwright/protocol').ConditionResult> {
    this.#ctx.assertOpen();
    const deadline = Deadline.after(
      this.#timeout(opts?.timeout ?? this.#ctx.timeouts.action, 'evaluateCondition'),
    );
    await this.#awaitNegotiation(deadline, 'evaluateCondition()');
    const before = this.#ctx.checkpoint();
    const selected = this.#select(await this.#tryEvaluate(deadline.at));
    const after = this.#ctx.checkpoint();
    if (before.contractId !== after.contractId || before.sequence !== after.sequence) {
      return Object.freeze({
        condition,
        checkpoint: after,
        observation: Object.freeze({ status: 'unknown', reason: 'stale-revision' }),
        verdict: 'inconclusive',
      });
    }
    return evaluateCanonicalCondition(condition, before, (leaf) =>
      this.#observeCondition(leaf, selected),
    );
  }

  async geometry(): Promise<LocatorGeometry> {
    const target = await this.#readStrict();
    const stamp = this.#stamp();
    if (target === null) {
      const detached = absent<never>('detached', 'adapter');
      return Object.freeze({
        stamp,
        coordinateSpace: detached,
        intendedRect: detached,
        visibleRect: detached,
      });
    }
    if (!target.semantic && target.rect !== null) {
      return Object.freeze({
        stamp,
        coordinateSpace: known<CoordinateSpace>('viewport-cells', {
          source: 'terminal',
          method: 'native',
          strength: 'authoritative',
          providerId: 'termwright-vt',
        }),
        intendedRect: known(target.rect, {
          source: 'terminal',
          method: 'measured',
          strength: 'authoritative',
          providerId: 'termwright-vt',
        }),
        visibleRect: known(this.#clip(target.rect), {
          source: 'driver',
          method: 'derived',
          strength: 'authoritative',
          providerId: 'termwright-driver',
        }),
      });
    }
    const qualifiedNode = this.#node(target);
    if (qualifiedNode.geometry !== undefined) {
      return Object.freeze({
        stamp,
        coordinateSpace:
          this.#ctx.semanticIndex()?.snapshot.coordinateSpace ??
          Object.freeze({
            status: 'unsupported',
            capability: 'coordinate-space',
            reason: 'not-negotiated',
          } as const),
        intendedRect: qualifiedNode.geometry.intendedRect,
        visibleRect: qualifiedNode.geometry.visibleRect,
      });
    }
    const unsupported = Object.freeze({
      status: 'unsupported',
      capability: 'intended-geometry',
      reason: 'not-negotiated',
    } as const);
    return Object.freeze({
      stamp,
      coordinateSpace: unsupported,
      intendedRect: unsupported,
      visibleRect: unsupported,
    });
  }

  async visibility(): Promise<LocatorVisibility> {
    const target = await this.#readStrict();
    const stamp = this.#stamp();
    if (target === null) {
      const detached = absent<never>('detached', 'adapter');
      return Object.freeze({
        stamp,
        attached: known(false, 'adapter'),
        displayed: detached,
        viewport: detached,
        offscreen: detached,
      });
    }
    if (!target.semantic && target.rect !== null) {
      const viewport = this.#viewport(target.rect);
      return Object.freeze({
        stamp,
        attached: known(true, 'terminal-grid'),
        displayed: known(true, 'terminal-grid'),
        viewport: known(viewport, 'viewport-clip'),
        offscreen: known(viewport.ratio === 0, 'viewport-clip'),
      });
    }
    const node = this.#node(target);
    if (node.geometry !== undefined) {
      const intended = node.geometry.intendedRect;
      const visible = node.geometry.visibleRect;
      const displayed = node.geometry.displayed;
      const notDisplayed = absent<never>(
        'not-displayed',
        displayed.status === 'known' ? displayed.evidence : 'adapter',
      );
      const viewport: LocatorVisibility['viewport'] =
        displayed.status === 'known' && displayed.value === false
          ? notDisplayed
          : intended.status === 'known' && visible.status === 'known'
            ? known(
                {
                  rect: visible.value,
                  ratio:
                    intended.value.width * intended.value.height === 0
                      ? 0
                      : (visible.value.width * visible.value.height) /
                        (intended.value.width * intended.value.height),
                  fullyInside:
                    intended.value.row === visible.value.row &&
                    intended.value.column === visible.value.column &&
                    intended.value.width === visible.value.width &&
                    intended.value.height === visible.value.height,
                },
                'viewport-clip',
              )
            : visible.status !== 'known'
              ? withoutValue<ViewportIntersection>(visible)
              : withoutValue<ViewportIntersection>(intended);
      const offscreen: LocatorVisibility['offscreen'] =
        displayed.status === 'known' && displayed.value === false
          ? notDisplayed
          : intended.status === 'known' && visible.status === 'known'
            ? known(
                intended.value.width * intended.value.height > 0 &&
                  visible.value.width * visible.value.height === 0,
                'viewport-clip',
              )
            : visible.status !== 'known'
              ? withoutValue<boolean>(visible)
              : withoutValue<boolean>(intended);
      return Object.freeze({
        stamp,
        attached: known(true, 'adapter'),
        displayed,
        viewport,
        offscreen,
      });
    }
    const unsupported = Object.freeze({
      status: 'unsupported',
      capability: 'clipped-geometry',
      reason: 'not-negotiated',
    } as const);
    return Object.freeze({
      stamp,
      attached: known(true, 'adapter'),
      displayed: unsupported,
      viewport: unsupported,
      offscreen: unsupported,
    });
  }

  async hitTest(opts?: {
    readonly position?: PointerOptions['position'];
  }): Promise<PointerHitTest> {
    const target = await this.#readStrict();
    const stamp = this.#stamp();
    if (target === null) {
      const detached = absent<never>('detached', 'adapter');
      return Object.freeze({
        stamp,
        point: detached,
        receivesEvents: detached,
        recipient: detached,
      });
    }
    if (target.rect === null) {
      const notLaidOut = absent<never>('not-laid-out', 'adapter');
      return Object.freeze({
        stamp,
        point: notLaidOut,
        receivesEvents: notLaidOut,
        recipient: notLaidOut,
      });
    }
    if (target.semantic && stamp.pairedScreenRevision !== stamp.screenRevision) {
      const pairingFailure =
        this.#ctx.contract()?.capabilities['paired-revisions'].status === 'supported'
          ? Object.freeze({ status: 'unknown', reason: 'stale-revision' } as const)
          : Object.freeze({
              status: 'unsupported',
              capability: 'paired-revisions',
              reason: 'not-negotiated',
            } as const);
      return Object.freeze({
        stamp,
        point: pairingFailure,
        receivesEvents: pairingFailure,
        recipient: pairingFailure,
      });
    }
    const point = this.#center(target, opts?.position);
    const snapshot = this.#ctx.semanticIndex()?.snapshot;
    if (snapshot !== undefined) {
      if (snapshot.hitGrid.status !== 'known') {
        return Object.freeze({
          stamp,
          point: known(point, 'probe'),
          receivesEvents: snapshot.hitGrid,
          recipient: snapshot.hitGrid,
        });
      }
      const owner = snapshot.hitGrid.value.regions.find(
        ({ rect }) =>
          point.row >= rect.row &&
          point.row < rect.row + rect.height &&
          point.column >= rect.column &&
          point.column < rect.column + rect.width,
      );
      if (owner === undefined) {
        const noRecipient = absent<string>('not-laid-out', 'hit-grid');
        return Object.freeze({
          stamp,
          point: known(point, 'hit-grid'),
          receivesEvents: known(false, 'hit-grid'),
          recipient: noRecipient,
        });
      }
      const targetId = semanticNodeId(target.ref) ?? '';
      return Object.freeze({
        stamp,
        point: known(point, 'hit-grid'),
        receivesEvents: known(owner.recipientId === targetId, 'hit-grid'),
        recipient: known(owner.recipientId, 'hit-grid'),
      });
    }
    const unsupported = Object.freeze({
      status: 'unsupported',
      capability: 'pointer-hit-testing',
      reason: 'not-negotiated',
    } as const);
    return Object.freeze({
      stamp,
      point: known(point, 'probe'),
      receivesEvents: unsupported,
      recipient: unsupported,
    });
  }

  async cellSnapshot(opts: LocatorCellSnapshotOptions = {}): Promise<LocatorCellSnapshot> {
    const geometry = await this.geometry();
    if (
      this.#expr.domain === 'semantic' &&
      geometry.stamp.pairedScreenRevision !== geometry.stamp.screenRevision
    ) {
      if (this.#ctx.contract()?.capabilities['paired-revisions'].status === 'supported') {
        throw new StaleSnapshotError(
          'cellSnapshot() semantic geometry is waiting for its committed terminal frame',
          this.#ctx.errorDiagnostics({ suggestion: 'retry after the paired observation commits' }),
        );
      }
      throw new CapabilityUnavailableError(
        'cellSnapshot() requires semantic geometry paired with the committed terminal frame',
        this.#ctx.errorDiagnostics({
          suggestion: 'use a certified adapter that negotiates render-revisions',
        }),
      );
    }
    const observation = opts.box === 'intended' ? geometry.intendedRect : geometry.visibleRect;
    if (observation.status !== 'known') {
      throw new CapabilityUnavailableError(
        `cellSnapshot() needs known ${opts.box ?? 'visible'} bounds; received ${observation.status}`,
        this.#ctx.errorDiagnostics({
          suggestion: 'use a grid locator or a probe that publishes qualified viewport geometry',
        }),
      );
    }
    const pad =
      typeof opts.padding === 'number'
        ? { top: opts.padding, right: opts.padding, bottom: opts.padding, left: opts.padding }
        : {
            top: opts.padding?.top ?? 0,
            right: opts.padding?.right ?? 0,
            bottom: opts.padding?.bottom ?? 0,
            left: opts.padding?.left ?? 0,
          };
    if (Object.values(pad).some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new TypeError('cellSnapshot() padding must contain non-negative safe integers');
    }
    const requested = {
      row: observation.value.row - pad.top,
      column: observation.value.column - pad.left,
      width: observation.value.width + pad.left + pad.right,
      height: observation.value.height + pad.top + pad.bottom,
    };
    const rect = this.#clip(requested);
    const before = this.#ctx.screenRevision();
    const source = this.#ctx.rows();
    const after = this.#ctx.screenRevision();
    if (before !== after || before !== geometry.stamp.screenRevision) {
      throw new StaleSnapshotError(
        `cellSnapshot() crossed screen revisions ${geometry.stamp.screenRevision}, ${before} and ${after}`,
        this.#ctx.errorDiagnostics({ suggestion: 'retry the snapshot after the screen settles' }),
      );
    }
    const cells = Array.from({ length: rect.height }, (_, row) =>
      Object.freeze(
        (source[rect.row + row]?.cells.slice(rect.column, rect.column + rect.width) ?? []).slice(),
      ),
    );
    const lines = cells.map((row) =>
      row
        .filter((cell) => cell.width !== 0)
        .map((cell) => (cell.char === '' ? ' ' : cell.char))
        .join('')
        .replace(/ +$/u, ''),
    );
    const empty: CellSnapshot = Object.freeze<CellSnapshot>({
      char: '',
      width: 1,
      fg: { kind: 'default' },
      bg: { kind: 'default' },
      attributes: {
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        inverse: false,
        strikethrough: false,
      },
    });
    return Object.freeze({
      stamp: geometry.stamp,
      origin: Object.freeze({ row: rect.row, column: rect.column }),
      columns: rect.width,
      rows: rect.height,
      text: () => lines.join('\n'),
      line: (row: number) => lines[row] ?? '',
      cell: (row: number, column: number) => cells[row]?.[column] ?? empty,
    });
  }

  /** Evaluates without propagating a parent-scope timeout: no scope, no matches. */
  async #tryEvaluate(_deadline: number): Promise<ResolvedTarget[]> {
    return this.#evaluate(this.#expr, null);
  }

  /** Immediate strict observation: zero is detached; ambiguity is an error. */
  async #readStrict(): Promise<ResolvedTarget | null> {
    this.#ctx.assertOpen();
    const deadline = Deadline.after(
      this.#timeout(this.#ctx.timeouts.action, 'locator observation'),
    );
    await this.#awaitNegotiation(deadline, 'locator observation');
    const matches = await this.#tryEvaluate(deadline.at);
    return this.#select(matches);
  }

  async #awaitNegotiation(deadline: Deadline, operation: string): Promise<void> {
    if (!this.#ctx.negotiationPending()) return;
    const settled = this.#ctx.negotiationSettled().then(() => true);
    for (;;) {
      if (deadline.expired()) {
        throw new TimeoutError(
          `${operation} exceeded its timeout during semantic capability negotiation`,
          this.#ctx.errorDiagnostics({
            suggestion:
              'increase the timeout or diagnose why the framework probe did not complete negotiation',
          }),
        );
      }
      const completed = await Promise.race([
        settled,
        this.#ctx.waitForChange(deadline.at).then(() => false),
      ]);
      if (deadline.expired()) {
        throw new TimeoutError(
          `${operation} exceeded its timeout during semantic capability negotiation`,
          this.#ctx.errorDiagnostics({
            suggestion:
              'increase the timeout or diagnose why the framework probe did not complete negotiation',
          }),
        );
      }
      if (completed || !this.#ctx.negotiationPending()) return;
    }
  }

  #stamp(): ObservationStamp {
    return this.#ctx.checkpoint();
  }

  async textContent(): Promise<string> {
    const target = await this.resolve();
    if (target.semantic) {
      const node = this.#node(target);
      // A published value wins even when it is empty: an empty textbox has no
      // text, and reporting its label instead would make `toHaveText('')`
      // unsatisfiable. The name is a fallback for nodes that carry no value.
      return node.value?.status === 'known' ? node.value.value : node.name;
    }
    return target.rect === null ? '' : textInRect(this.#ctx.rows(), target.rect);
  }

  async semanticState(): Promise<SemanticState | null> {
    const target = await this.resolve();
    if (!target.semantic) return null;
    return this.#node(target).state ?? {};
  }

  async semanticValue(): Promise<SemanticValueObservation> {
    const target = await this.resolve();
    if (!target.semantic)
      return Object.freeze({
        status: 'unsupported',
        capability: 'semantic-value',
        reason: 'not-negotiated',
      });
    const node = this.#node(target);
    if (node.value !== undefined) return node.value;
    const evidence = this.#ctx.contract()?.capabilities['semantic-tree'];
    if (evidence?.status === 'supported' && evidence.evidence.strength === 'authoritative') {
      return Object.freeze({
        status: 'absent',
        reason: 'no-value',
        evidence: { ...evidence.evidence, strength: 'authoritative' as const },
      });
    }
    return Object.freeze({
      status: 'unsupported',
      capability: 'semantic-value',
      reason: 'capability',
    });
  }

  async semanticScroll(): Promise<Observation<SemanticScrollState>> {
    const target = await this.resolve();
    if (!target.semantic) {
      return Object.freeze({
        status: 'unsupported',
        capability: 'scroll',
        reason: 'not-negotiated',
      });
    }
    const capability = this.#ctx.contract()?.capabilities.scroll;
    if (capability?.status !== 'supported') {
      return Object.freeze({
        status: 'unsupported',
        capability: 'scroll',
        reason:
          capability?.reason === 'framework-unobservable'
            ? 'framework-unobservable'
            : capability?.reason === 'not-negotiated' || capability === undefined
              ? 'not-negotiated'
              : 'capability',
      });
    }
    const node = this.#node(target);
    if (node.scroll !== undefined) return node.scroll;
    return Object.freeze({
      status: 'absent',
      reason: 'not-laid-out',
      evidence: Object.freeze({ ...capability.evidence, strength: 'authoritative' as const }),
    });
  }

  async paintedRegion(): Promise<
    Observation<import('@termwright/protocol').SemanticPaintedRegion>
  > {
    const target = await this.resolve();
    if (!target.semantic) {
      return Object.freeze({
        status: 'unsupported',
        capability: 'painted-region',
        reason: 'not-negotiated',
      });
    }
    const capability = this.#ctx.contract()?.capabilities['painted-region'];
    if (capability?.status !== 'supported') {
      return Object.freeze({
        status: 'unsupported',
        capability: 'painted-region',
        reason:
          capability?.reason === 'framework-unobservable'
            ? 'framework-unobservable'
            : capability?.reason === 'not-negotiated' || capability === undefined
              ? 'not-negotiated'
              : 'capability',
      });
    }
    const node = this.#node(target);
    if (node.paintedRegion !== undefined) return node.paintedRegion;
    return Object.freeze({
      status: 'absent',
      reason: 'not-laid-out',
      evidence: Object.freeze({ ...capability.evidence, strength: 'authoritative' as const }),
    });
  }

  async extendedState(): Promise<SemanticExtendedState | null> {
    const target = await this.resolve();
    if (!target.semantic) return null;
    return this.#node(target).extended ?? null;
  }

  // -------------------------------------------------------------------------
  // Actions

  async click(opts?: PointerOptions): Promise<ActionReceipt> {
    return this.#act('click', (record, actionId) =>
      this.#plannedPointer({ kind: 'click', selector: this.description }, opts, record, actionId),
    );
  }

  async doubleClick(opts?: PointerOptions): Promise<ActionReceipt> {
    return this.#act('doubleClick', (record, actionId) =>
      this.#plannedPointer(
        { kind: 'double-click', selector: this.description },
        opts,
        record,
        actionId,
      ),
    );
  }

  async hover(opts?: PointerOptions): Promise<ActionReceipt> {
    return this.#act('hover', (record, actionId) =>
      this.#plannedPointer({ kind: 'hover', selector: this.description }, opts, record, actionId),
    );
  }

  async actionability(
    action:
      | 'click'
      | 'double-click'
      | 'hover'
      | 'focus'
      | 'activate'
      | 'press'
      | 'type'
      | 'fill'
      | 'check'
      | 'uncheck',
    opts?: PointerOptions & { readonly value?: string },
  ): Promise<ActionabilityExplanation> {
    const target = await this.resolve(opts);
    return new ActionPlanner(this.#ctx).explain(
      { kind: action, selector: this.description, targetRef: target.ref },
      target,
      opts,
      opts?.value,
    );
  }

  async dragTo(target: AnyLocator, opts?: LocatorDragOptions): Promise<ActionReceipt> {
    return this.#act('dragTo', (record, actionId) => this.#dragTo(target, record, actionId, opts));
  }

  async #dragTo(
    target: AnyLocator,
    record: (t: ResolvedTarget) => void,
    actionId: string,
    opts?: LocatorDragOptions,
  ): Promise<ActionReceipt> {
    const raw = unwrap(target);
    if (!(raw instanceof LocatorImpl)) {
      throw new TypeError('dragTo() requires a locator created by this harness');
    }
    const retry = new ActionRetryController(
      this.#timeout(opts?.timeout ?? this.#ctx.timeouts.action, 'drag'),
    );
    for (;;) {
      try {
        const remaining = retry.remaining();
        const source = await this.resolve({ ...opts, timeout: remaining });
        record(source);
        const destination = await raw.resolve({ ...opts, timeout: retry.remaining() });
        const { plan } = new ActionPlanner(this.#ctx).planDrag(
          actionId,
          { kind: 'drag', selector: this.description, targetRef: source.ref },
          source,
          destination,
          opts,
        );
        retry.assertBeforeInput(this.#ctx.errorDiagnostics({ candidates: [source, destination] }));
        return await this.#executePlan(plan, retry);
      } catch (error) {
        await retry.retry(error, this.#ctx, actionId);
      }
    }
  }

  async wheel(opts: LocatorWheelOptions): Promise<ActionReceipt> {
    return this.#act('wheel', (record, actionId) => this.#wheel(opts, record, actionId));
  }

  async #wheel(
    opts: LocatorWheelOptions,
    record: (target: ResolvedTarget) => void,
    actionId: string,
  ): Promise<ActionReceipt> {
    const retry = new ActionRetryController(
      this.#timeout(opts.timeout ?? this.#ctx.timeouts.action, 'wheel'),
    );
    for (;;) {
      try {
        const target = await this.resolve({ ...opts, timeout: retry.remaining() });
        record(target);
        const { plan } = new ActionPlanner(this.#ctx).planWheel(
          actionId,
          { kind: 'wheel', selector: this.description, targetRef: target.ref },
          target,
          opts,
        );
        retry.assertBeforeInput(this.#ctx.errorDiagnostics({ candidates: [target] }));
        return await this.#executePlan(plan, retry);
      } catch (error) {
        await retry.retry(error, this.#ctx, actionId);
      }
    }
  }

  async press(keys: string, opts?: WaitOptions): Promise<ActionReceipt> {
    return this.#act('press', async (record, actionId) => {
      const { receipt } = await this.#plannedKeyboard(
        { kind: 'press', selector: this.description },
        keys,
        opts,
        record,
        actionId,
      );
      return receipt;
    });
  }

  async type(text: ExecutableValue, opts?: WaitOptions): Promise<ActionReceipt> {
    return this.#act('type', async (record, actionId) => {
      const { receipt } = await this.#plannedKeyboard(
        { kind: 'type', selector: this.description },
        text,
        opts,
        record,
        actionId,
      );
      return receipt;
    });
  }

  async fill(text: ExecutableValue, opts?: WaitOptions): Promise<ActionReceipt> {
    return this.#act('fill', async (record, actionId) => {
      const { receipt, target, retry } = await this.#plannedKeyboard(
        { kind: 'fill', selector: this.description },
        text,
        opts,
        record,
        actionId,
      );
      const before = target.semantic
        ? this.#ctx.semanticNode(semanticNodeId(target.ref) ?? '')?.value
        : undefined;
      if (receipt.plan.operations.length > 0 && before?.status === 'known') {
        const expected = typeof text === 'string' ? text : text.value;
        await this.#waitForSemanticPostcondition(
          'fill',
          target,
          retry,
          (node) => node.value?.status === 'known' && node.value.value === expected,
          `semantic value ${JSON.stringify(expected)}`,
        );
      }
      return Object.freeze({ ...receipt, after: this.#ctx.checkpoint() });
    });
  }

  async focus(opts?: WaitOptions): Promise<ActionReceipt> {
    return this.#act('focus', async (record, actionId) => {
      const { receipt, target, retry } = await this.#plannedKeyboard(
        { kind: 'focus', selector: this.description },
        '',
        opts,
        record,
        actionId,
      );
      if (receipt.plan.operations.length > 0) {
        await this.#waitForSemanticPostcondition(
          'focus',
          target,
          retry,
          (node) => node.state?.focused === true,
          'focused=true',
        );
      }
      return Object.freeze({ ...receipt, after: this.#ctx.checkpoint() });
    });
  }

  async activate(opts?: WaitOptions): Promise<ActionReceipt> {
    return this.#act('activate', async (record, actionId) => {
      const { receipt } = await this.#plannedKeyboard(
        { kind: 'activate', selector: this.description },
        '',
        opts,
        record,
        actionId,
      );
      return receipt;
    });
  }

  async check(opts?: WaitOptions): Promise<ActionReceipt> {
    return this.#checkedAction(true, opts);
  }

  async uncheck(opts?: WaitOptions): Promise<ActionReceipt> {
    return this.#checkedAction(false, opts);
  }

  async #checkedAction(value: boolean, opts?: WaitOptions): Promise<ActionReceipt> {
    const api = value ? 'check' : 'uncheck';
    return this.#act(api, async (record, actionId) => {
      const { receipt, target, retry } = await this.#plannedKeyboard(
        { kind: value ? 'check' : 'uncheck', selector: this.description },
        '',
        opts,
        record,
        actionId,
      );
      if (receipt.plan.operations.length > 0) {
        for (;;) {
          const current = await this.resolve({ timeout: retry.remaining() });
          const node = current.semantic
            ? this.#ctx.semanticNode(semanticNodeId(current.ref) ?? '')
            : undefined;
          if (node?.state?.checked === value) break;
          if (retry.expired()) {
            throw new TimeoutError(
              `${api}() did not observe checked=${String(value)} after the physical action`,
              this.#ctx.errorDiagnostics({ candidates: [target] }),
            );
          }
          await this.#ctx.waitForChange(retry.deadline);
          if (retry.expired()) {
            throw new TimeoutError(
              `${api}() did not observe checked=${String(value)} after the physical action`,
              this.#ctx.errorDiagnostics({ candidates: [target] }),
            );
          }
        }
      }
      return Object.freeze({ ...receipt, after: this.#ctx.checkpoint() });
    });
  }

  async #waitForSemanticPostcondition(
    api: string,
    target: ResolvedTarget,
    retry: ActionRetryController,
    satisfied: (node: SemanticNode) => boolean,
    expected: string,
  ): Promise<void> {
    for (;;) {
      const current = await this.resolve({ timeout: retry.remaining() });
      const node = current.semantic
        ? this.#ctx.semanticNode(semanticNodeId(current.ref) ?? '')
        : undefined;
      if (node !== undefined && satisfied(node)) return;
      if (retry.expired()) {
        throw new TimeoutError(
          `${api}() did not observe ${expected} after the physical action`,
          this.#ctx.errorDiagnostics({ candidates: [target] }),
        );
      }
      await this.#ctx.waitForChange(retry.deadline);
      if (retry.expired()) {
        throw new TimeoutError(
          `${api}() did not observe ${expected} after the physical action`,
          this.#ctx.errorDiagnostics({ candidates: [target] }),
        );
      }
    }
  }

  async #plannedKeyboard(
    intent: Omit<ActionIntent, 'targetRef'>,
    value: ExecutableValue,
    opts: WaitOptions | undefined,
    record: (target: ResolvedTarget) => void,
    actionId: string,
  ): Promise<{
    readonly receipt: ActionReceipt;
    readonly target: ResolvedTarget;
    readonly retry: ActionRetryController;
  }> {
    const retry = new ActionRetryController(
      this.#timeout(opts?.timeout ?? this.#ctx.timeouts.action, intent.kind),
    );
    for (;;) {
      const target = await this.resolve({ ...opts, timeout: retry.remaining() });
      record(target);
      try {
        const plan = new ActionPlanner(this.#ctx).planKeyboard(
          actionId,
          { ...intent, targetRef: target.ref },
          target,
          value,
        );
        retry.assertBeforeInput(this.#ctx.errorDiagnostics({ candidates: [target] }));
        return Object.freeze({ receipt: await this.#executePlan(plan, retry), target, retry });
      } catch (error) {
        await retry.retry(error, this.#ctx, actionId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals

  /**
   * Runs a locator action and reports it afterwards, successfully or not.
   *
   * `record` is handed to the body so the event can name the target the action
   * actually resolved. Keeping it per-call rather than on the instance matters:
   * a locator is reused, and a ref left over from a previous action would
   * attach itself to the next one.
   */
  async #act(
    api: string,
    run: (record: (target: ResolvedTarget) => void, actionId: string) => Promise<ActionReceipt>,
  ): Promise<ActionReceipt> {
    this.#timeout(this.#ctx.timeouts.action, api);
    const actionId = this.#ctx.beginAction(api, { selector: this.description });
    let ref: string | undefined;
    const record = (target: ResolvedTarget): void => {
      ref = target.ref;
    };
    try {
      const result = await run(record, actionId);
      this.#ctx.endAction(actionId, api, true, {
        selector: this.description,
        ...(ref !== undefined ? { ref } : {}),
        receipt: result,
      });
      return result;
    } catch (error) {
      this.#ctx.endAction(actionId, api, false, {
        selector: this.description,
        ...(ref !== undefined ? { ref } : {}),
        error:
          error instanceof TermwrightError
            ? error.code
            : error instanceof Error
              ? error.name
              : 'unknown',
        ...(error instanceof TermwrightError && error.actionability !== undefined
          ? { actionability: error.actionability }
          : {}),
      });
      throw error;
    }
  }

  async #plannedPointer(
    intent: ActionIntent,
    opts: PointerOptions | undefined,
    record: (target: ResolvedTarget) => void,
    actionId: string,
  ): Promise<ActionReceipt> {
    const retry = new ActionRetryController(
      this.#timeout(opts?.timeout ?? this.#ctx.timeouts.action, intent.kind),
    );
    for (;;) {
      const target = await this.resolve({ ...opts, timeout: retry.remaining() });
      record(target);
      try {
        const { plan } = new ActionPlanner(this.#ctx).planPointer(
          actionId,
          { ...intent, targetRef: target.ref },
          target,
          opts,
        );
        retry.assertBeforeInput(this.#ctx.errorDiagnostics({ candidates: [target] }));
        return await this.#executePlan(plan, retry);
      } catch (error) {
        // Planning has not emitted input yet. A render committed between lazy
        // locator resolution and evidence collection, so wait for the next
        // paired observation and resolve the locator again instead of using
        // stale coordinates or surfacing a race to the test author.
        await retry.retry(error, this.#ctx, actionId);
      }
    }
  }

  async #executePlan(
    plan: ExecutableActionPlan,
    retry: ActionRetryController,
  ): Promise<ActionReceipt> {
    retry.assertBeforeInput(this.#ctx.errorDiagnostics());
    const executed = await this.#ctx.executeDeviceOperations(
      plan.operations,
      plan.checkpoint,
      retry.deadline,
    );
    const recordedPlan = recordActionPlan(plan, this.#ctx.artifactValuePolicy);
    return Object.freeze({
      intent: plan.intent,
      plan: recordedPlan,
      before: plan.checkpoint,
      after: this.#ctx.checkpoint(),
      executed: Object.freeze(
        executed.map((operation) =>
          recordDeviceOperation(operation, this.#ctx.artifactValuePolicy),
        ),
      ),
      outcome: 'completed',
    });
  }

  #center(
    target: ResolvedTarget,
    position?: PointerOptions['position'],
  ): { row: number; column: number } {
    const rect = target.rect;
    if (rect === null) {
      throw new CapabilityUnavailableError(
        `${this.description} has no bounds, so it has no clickable cell`,
        this.#ctx.errorDiagnostics({ candidates: [target] }),
      );
    }
    if (position !== undefined) {
      return {
        row: rect.row + position.rowOffset,
        column: rect.column + position.columnOffset,
      };
    }
    return {
      row: rect.row + Math.floor(Math.max(0, rect.height - 1) / 2),
      column: rect.column + Math.floor(Math.max(0, rect.width - 1) / 2),
    };
  }

  #inViewport(rect: Rect): boolean {
    return this.#viewport(rect).ratio > 0;
  }

  #clip(rect: Rect): Rect {
    return this.#viewport(rect).rect;
  }

  #viewport(rect: Rect): {
    readonly rect: Rect;
    readonly ratio: number;
    readonly fullyInside: boolean;
  } {
    const rows = this.#ctx.rows();
    const columns = rows[0]?.cells.length ?? 0;
    const row = Math.max(0, rect.row);
    const column = Math.max(0, rect.column);
    const bottom = Math.min(rows.length, rect.row + rect.height);
    const right = Math.min(columns, rect.column + rect.width);
    const clipped = Object.freeze({
      row,
      column,
      width: Math.max(0, right - column),
      height: Math.max(0, bottom - row),
    });
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const visible = clipped.width * clipped.height;
    return Object.freeze({
      rect: clipped,
      ratio: area === 0 ? 0 : visible / area,
      fullyInside: area > 0 && visible === area,
    });
  }

  #observeCondition(condition: LeafCondition, target: ResolvedTarget | null): Observation<boolean> {
    const kind = condition.kind;
    const capability = this.#expr.domain === 'semantic' ? 'semantic-tree' : 'keyboard-input';
    const availability = this.#ctx.contract()?.capabilities[capability];
    if (availability?.status !== 'supported') {
      return Object.freeze({
        status: 'unsupported',
        capability,
        reason:
          availability?.reason === 'framework-unobservable'
            ? 'framework-unobservable'
            : availability?.reason === undefined || availability.reason === 'not-negotiated'
              ? 'not-negotiated'
              : 'capability',
      });
    }
    const bool = (
      value: boolean,
      evidence: EvidenceProvenance = availability.evidence,
    ): Observation<boolean> => Object.freeze({ status: 'known', value, evidence });
    // Before the first committed semantic tree, an empty match set is not
    // evidence of absence. In particular hidden/detached must not false-green
    // while an attached provider is still producing its initial revision.
    if (this.#expr.domain === 'semantic' && this.#ctx.semanticIndex() === null) {
      return Object.freeze({ status: 'unknown', reason: 'awaiting-revision-pair' });
    }
    if (kind === 'attached' || kind === 'detached')
      return bool(kind === 'attached' ? target !== null : target === null);
    if (target === null) {
      // Hidden intentionally includes detachment. This is the ergonomic
      // condition for transient UI such as loaders; callers that need to
      // distinguish removal from display:none use `detached` explicitly.
      if (kind === 'hidden') return bool(true);
      return absent<boolean>('detached', availability.evidence);
    }
    if (!target.semantic) {
      if (kind === 'displayed') return bool(true);
      if (kind === 'hidden') return bool(false);
      if (kind === 'visible' || kind === 'in-viewport' || kind === 'offscreen') {
        const ratio = target.rect === null ? 0 : this.#viewport(target.rect).ratio;
        return bool(
          kind === 'offscreen'
            ? ratio === 0
            : kind === 'visible'
              ? ratio > 0
              : ratio >= (condition.kind === 'in-viewport' ? condition.minRatio : 0),
        );
      }
      return Object.freeze({ status: 'unsupported', capability: kind, reason: 'capability' });
    }
    const node = this.#ctx.semanticIndex()?.node(semanticNodeId(target.ref) ?? '');
    if (node === undefined) return absent<boolean>('detached', availability.evidence);
    const displayed = node.geometry.displayed;
    if (kind === 'displayed' || kind === 'hidden') {
      return displayed.status === 'known'
        ? bool(kind === 'displayed' ? displayed.value : !displayed.value, displayed.evidence)
        : withoutValue<boolean>(displayed);
    }
    if (kind === 'visible' || kind === 'in-viewport' || kind === 'offscreen') {
      if (displayed.status !== 'known') return withoutValue<boolean>(displayed);
      if (!displayed.value) return bool(kind === 'offscreen' ? false : false, displayed.evidence);
      const intended = node.geometry.intendedRect;
      const visible = node.geometry.visibleRect;
      if (intended.status !== 'known') return withoutValue<boolean>(intended);
      if (visible.status !== 'known') return withoutValue<boolean>(visible);
      const intendedArea = intended.value.width * intended.value.height;
      const visibleArea = visible.value.width * visible.value.height;
      const ratio = intendedArea === 0 ? 0 : visibleArea / intendedArea;
      return bool(
        kind === 'offscreen'
          ? intendedArea > 0 && visibleArea === 0
          : kind === 'visible'
            ? visibleArea > 0
            : ratio >= (condition.kind === 'in-viewport' ? condition.minRatio : 0),
        visible.evidence,
      );
    }
    if (kind === 'pointer-input') {
      const pointer = this.#ctx.contract()?.capabilities['pointer-input'];
      return pointer?.status === 'supported'
        ? bool(true, pointer.evidence)
        : Object.freeze({
            status: 'unsupported',
            capability: kind,
            reason:
              pointer?.reason === 'not-negotiated' || pointer === undefined
                ? 'not-negotiated'
                : 'capability',
          });
    }
    if (kind === 'mouse-input-enabled') {
      const modes = this.#ctx.modes();
      const evidence = Object.freeze({
        source: 'terminal',
        method: 'native',
        strength: 'authoritative',
        providerId: 'termwright-vt',
      } as const);
      return modes.mouseTracking === 'unknown' || modes.mouseEncoding === 'unknown'
        ? Object.freeze({ status: 'unknown', reason: 'provider-refresh' })
        : bool(modes.mouseTracking !== 'none', evidence);
    }
    if (kind === 'pointer-region' || kind === 'receives-pointer') {
      const pointer =
        this.#ctx.contract()?.capabilities[
          kind === 'pointer-region' ? 'pointer-geometry' : 'pointer-hit-testing'
        ];
      if (pointer?.status !== 'supported') {
        if (kind === 'receives-pointer') {
          const nodeId = semanticNodeId(target.ref) ?? '';
          const region = this.#ctx.pointerRegion(nodeId);
          if (
            region !== undefined &&
            isAuthoritativeRegionOwnership(this.#ctx.contract(), region.evidence)
          ) {
            return bool(region.spans.length > 0, region.evidence);
          }
        }
        return Object.freeze({
          status: 'unsupported',
          capability: kind,
          reason:
            pointer?.reason === 'framework-unobservable'
              ? 'framework-unobservable'
              : pointer?.reason === 'not-negotiated' || pointer === undefined
                ? 'not-negotiated'
                : 'capability',
        });
      }
      const nodeId = semanticNodeId(target.ref) ?? '';
      const region = this.#ctx.pointerRegion(nodeId);
      if (kind === 'pointer-region')
        return bool(region !== undefined && region.spans.length > 0, pointer.evidence);
      const grid = this.#ctx.hitGrid();
      if (grid === undefined)
        return Object.freeze({ status: 'unknown', reason: 'provider-refresh' });
      if (grid.status !== 'known') return withoutValue<boolean>(grid);
      if (region === undefined) return bool(false, grid.evidence);
      const receives = region.spans.some((span) =>
        grid.value.regions.some(
          (hit) =>
            hit.recipientId === nodeId &&
            span.row >= hit.rect.row &&
            span.row < hit.rect.row + hit.rect.height &&
            Math.max(span.from, hit.rect.column) <
              Math.min(span.to, hit.rect.column + hit.rect.width),
        ),
      );
      return bool(receives, grid.evidence);
    }
    const stateEvidence =
      this.#ctx.contract()?.capabilities[kind === 'focused' ? 'focus' : 'semantic-tree'];
    if (stateEvidence?.status !== 'supported') {
      return Object.freeze({
        status: 'unsupported',
        capability: kind,
        reason:
          stateEvidence?.reason === 'framework-unobservable'
            ? 'framework-unobservable'
            : stateEvidence?.reason === 'not-negotiated' || stateEvidence === undefined
              ? 'not-negotiated'
              : 'capability',
      });
    }
    const state = node.state ?? {};
    if (kind === 'focused') return bool(state.focused === true, stateEvidence.evidence);
    if (kind === 'enabled' || kind === 'disabled')
      return bool(
        kind === 'enabled' ? state.disabled !== true : state.disabled === true,
        stateEvidence.evidence,
      );
    if (kind === 'checked')
      return state.checked === undefined
        ? Object.freeze({
            status: 'unsupported',
            capability: 'checked-state',
            reason: 'capability',
          })
        : bool(state.checked === condition.value, stateEvidence.evidence);
    if (kind === 'selected')
      return state.selected === undefined
        ? Object.freeze({
            status: 'unsupported',
            capability: 'selected-state',
            reason: 'capability',
          })
        : bool(state.selected === condition.value, stateEvidence.evidence);
    if (kind === 'expanded')
      return state.expanded === undefined
        ? Object.freeze({
            status: 'unsupported',
            capability: 'expanded-state',
            reason: 'capability',
          })
        : bool(state.expanded === condition.value, stateEvidence.evidence);
    if (kind === 'collapsed')
      return state.expanded === undefined
        ? Object.freeze({
            status: 'unsupported',
            capability: 'expanded-state',
            reason: 'capability',
          })
        : bool(state.expanded === false, stateEvidence.evidence);
    if (kind === 'value') {
      const observation = node.value;
      if (observation === undefined || observation.status === 'absent')
        return Object.freeze({
          status: 'unsupported',
          capability: 'semantic-value',
          reason: 'capability',
        });
      if (
        observation.status === 'unknown' ||
        observation.status === 'unsupported' ||
        observation.status === 'withheld'
      )
        return Object.freeze({
          status: 'unsupported',
          capability: 'semantic-value',
          reason: 'capability',
        });
      const value = observation.value;
      const matcher = condition.matcher;
      const matches =
        matcher.kind === 'regex'
          ? new RegExp(matcher.source, matcher.flags.replace(/[gy]/gu, '')).test(value)
          : matcher.kind === 'exact'
            ? value === matcher.text
            : value.includes(matcher.text);
      return bool(matches, stateEvidence.evidence);
    }
    return Object.freeze({ status: 'unsupported', capability: kind, reason: 'capability' });
  }

  /** Re-reads the node behind a ref; a vanished stable identity is stale. */
  #node(target: ResolvedTarget): SemanticNode {
    const index = this.#ctx.semanticIndex();
    const id = target.ref.startsWith('semantic:')
      ? target.ref.slice('semantic:'.length, target.ref.lastIndexOf('@'))
      : '';
    const node = index?.node(id);
    if (node === undefined) {
      throw new StaleSnapshotError(
        `ref ${target.ref} no longer exists at semantic revision ${this.#ctx.semanticRevision()}`,
        this.#ctx.errorDiagnostics({
          suggestion: 're-resolve the locator; the node identity is no longer present',
        }),
      );
    }
    return node;
  }

  #evaluate(expr: LocatorExpr, scope: ResolvedTarget | null): ResolvedTarget[] {
    switch (expr.kind) {
      case 'leaf':
        return expr.query.kind === 'semantic'
          ? this.#evaluateSemantic(expr.query, scope)
          : expr.query.kind === 'ref'
            ? this.#evaluateRef(expr.query)
            : this.#evaluateGeneric(expr.query, scope);
      case 'descendant': {
        const parents = this.#evaluate(expr.parent, scope);
        return parents.flatMap((parent) => this.#evaluate(expr.child, parent));
      }
      case 'select': {
        const matches = this.#evaluate(expr.source, scope);
        const match = expr.index === 'last' ? matches.at(-1) : matches[expr.index];
        return match === undefined ? [] : [match];
      }
      case 'filter':
        return this.#evaluate(expr.source, scope).filter((target) =>
          this.#matchesFilter(target, expr.filter),
        );
      case 'and': {
        const left = this.#evaluate(expr.left, scope);
        const rightRefs = new Set(this.#evaluate(expr.right, scope).map((target) => target.ref));
        return left.filter((target) => rightRefs.has(target.ref));
      }
      case 'or': {
        const left = this.#evaluate(expr.left, scope);
        const refs = new Set(left.map((target) => target.ref));
        return [
          ...left,
          ...this.#evaluate(expr.right, scope).filter((target) => !refs.has(target.ref)),
        ];
      }
    }
  }

  #matchesFilter(target: ResolvedTarget, filter: LocatorFilter): boolean {
    if (filter.hasText !== undefined) {
      const text = target.semantic
        ? (() => {
            const index = this.#ctx.semanticIndex();
            const node = index?.node(semanticNodeId(target.ref) ?? '');
            if (node === undefined) return '';
            const nodes = [
              node,
              ...(index?.nodes.filter((candidate) => index.isDescendantOf(candidate, node.id)) ??
                []),
            ];
            return nodes
              .flatMap((candidate) => [
                candidate.name,
                candidate.value?.status === 'known' ? candidate.value.value : undefined,
                index?.label(candidate),
              ])
              .filter(Boolean)
              .join(' ');
          })()
        : target.rect === null
          ? ''
          : textInRect(this.#ctx.rows(), target.rect);
      const matcher = filter.hasText;
      const matches =
        matcher.kind === 'regex'
          ? new RegExp(matcher.source.source, matcher.source.flags.replace(/[gy]/gu, '')).test(text)
          : matcher.kind === 'exact'
            ? text.trim() === matcher.text.trim()
            : text.toLowerCase().includes(matcher.text.trim().toLowerCase());
      if (!matches) return false;
    }
    if (filter.has !== undefined && this.#evaluate(filter.has, target).length === 0) return false;
    if (filter.hasNot !== undefined && this.#evaluate(filter.hasNot, target).length > 0)
      return false;
    return true;
  }

  /** Resolves a grid ref in its frame, or a semantic ref by producer identity. */
  #evaluateRef(query: RefQuery): ResolvedTarget[] {
    const ref = query.ref;
    if (ref.kind === 'rect') {
      const live = this.#ctx.screenRevision();
      if (live !== ref.revision) {
        throw new StaleSnapshotError(
          `${query.description} was minted at screen revision ${ref.revision}; the live revision is ${live}`,
          this.#ctx.errorDiagnostics({
            suggestion: 'take a fresh screen() snapshot and use the refs it mints',
          }),
        );
      }
      return [rectTarget(ref.rect, live)];
    }

    const index = this.#ctx.semanticIndex();
    if (index === null) {
      const violation = this.#ctx.semanticViolation();
      if (violation !== null) throw violation;
      if (this.#ctx.semanticPossible()) return [];
      throw new SemanticCapabilityUnavailableError(
        `${query.description} needs a semantic tree, but this session has none`,
        this.#ctx.errorDiagnostics({
          suggestion: 'target by text or by grid coordinates in a generic session',
        }),
      );
    }
    const live = index.snapshot.revision;
    if (live !== ref.revision && this.#ctx.identityKind() !== 'stable') {
      throw new StaleSnapshotError(
        `${query.description} was minted at semantic revision ${ref.revision}; the live revision is ${live}`,
        this.#ctx.errorDiagnostics({
          suggestion: 're-read semanticTree() or re-resolve the locator and use the fresh refs',
        }),
      );
    }
    const node = index.node(ref.nodeId);
    if (node === undefined) {
      throw new StaleSnapshotError(
        `${query.description} no longer exists at semantic revision ${live}`,
        this.#ctx.errorDiagnostics({ suggestion: 're-resolve the locator and use the fresh refs' }),
      );
    }
    return [nodeTarget(node, live, this.#ctx.identityKind())];
  }

  #evaluateSemantic(query: SemanticQuery, scope: ResolvedTarget | null): ResolvedTarget[] {
    const providerFailure = this.#ctx.semanticViolation();
    if (providerFailure !== null) throw providerFailure;
    const index = this.#ctx.semanticIndex();
    if (index === null) {
      // A channel that died before publishing anything is reported as what it
      // was — a protocol violation — instead of a generic missing tree.
      const violation = this.#ctx.semanticViolation();
      if (violation !== null) throw violation;
      // A tree that may still arrive is a wait, not an error: an attached
      // adapter whose first tree is in flight, or a child still booting inside
      // the late-attach grace. The caller's deadline decides.
      if (this.#ctx.semanticPossible()) return [];
      throw new SemanticCapabilityUnavailableError(
        `locator ${this.description} needs a semantic tree, but this session has none`,
        this.#ctx.errorDiagnostics({
          suggestion:
            'use getByScreenText() for an uninstrumented program, or install the matching Termwright framework integration',
        }),
      );
    }
    if (scope !== null && !scope.semantic) {
      throw new TypeError('within() cannot scope a semantic locator to a grid match');
    }
    const scopeId = scope === null ? undefined : (semanticNodeId(scope.ref) ?? undefined);
    const revision = index.snapshot.revision;
    const identity = this.#ctx.identityKind();
    return matchSemantic(index, query.steps, scopeId).map((node) =>
      nodeTarget(node, revision, identity),
    );
  }

  #evaluateGeneric(query: GenericQuery, scope: ResolvedTarget | null): ResolvedTarget[] {
    if (scope?.semantic === true) {
      throw new TypeError(
        'terminal-grid locators cannot be scoped through semantic geometry implicitly; ' +
          'query the screen explicitly with getByScreenText()',
      );
    }
    const revision = this.#ctx.screenRevision();
    return matchGrid(this.#ctx.rows(), query, scope?.rect ?? null).map((rect) =>
      rectTarget(rect, revision),
    );
  }

  /** Applies strict-mode selection; returns `null` when nothing is selectable yet. */
  #select(matches: readonly ResolvedTarget[]): ResolvedTarget | null {
    if (matches.length === 1) return matches[0] ?? null;
    if (matches.length > 1) {
      throw new AmbiguousLocatorError(
        `locator ${this.description} matched ${matches.length} nodes in strict mode`,
        matches.slice(0, MAX_CANDIDATES),
        this.#ctx.errorDiagnostics({
          suggestion:
            'narrow the locator with within(), a name option, or select one with first()/nth()',
        }),
      );
    }
    return null;
  }
}
