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
  Observation,
  ObservationStamp,
  PointerHitTest,
  Rect,
  SemanticExtendedState,
  SemanticNode,
  SemanticState,
} from '@termwright/protocol';
import type {
  ActivateReceipt,
  CellSnapshot,
  ErrorDiagnostics,
  Locator,
  LocatorCellSnapshot,
  LocatorCellSnapshotOptions,
  PointerOptions,
  ResolvedTarget,
  TerminalModes,
  TimeoutClasses,
  WaitOptions,
} from './api.js';
import {
  AmbiguousLocatorError,
  StaleSnapshotError,
  TermwrightError,
  TimeoutError,
  UnsupportedActionError,
} from './errors.js';
import { unwrap } from './debug.js';
import { encodeKeys, encodeText } from './keys.js';
import { concatBytes, encodeMouse, type MouseButton, type MouseEvent } from './mouse.js';
import { matchGrid, matchSemantic, textInRect, type SemanticIndex } from './matching.js';
import type { CapturedRow } from './screen.js';
import type { GenericQuery, LocatorQuery, RefQuery, SemanticQuery } from './selectors.js';

/** Everything a locator needs from its session. */
export interface LocatorContext {
  readonly sessionId: string;
  readonly timeouts: Required<TimeoutClasses>;
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
  rows(): readonly CapturedRow[];
  modes(): TerminalModes;
  /** The best identity the attached producer can offer for a node. */
  identityKind(): ResolvedTarget['identity'];
  /** True only when semantic bounds address absolute terminal cells. */
  semanticBoundsAreAbsolute(): boolean;
  /** Resolves when a screen or semantic revision is published, or the deadline passes. */
  waitForChange(deadline: number): Promise<void>;
  sendInput(data: Uint8Array, kind: 'key' | 'mouse' | 'paste' | 'raw'): Promise<void>;
  /** Publishes the start of an action and returns its session-local id. */
  beginAction(api: string, about?: { selector?: string }): string;
  /** Publishes the authoritative completion of an action. */
  endAction(
    actionId: string,
    api: string,
    ok: boolean,
    about?: { selector?: string; ref?: string; error?: string },
  ): void;
  errorDiagnostics(extra?: Partial<ErrorDiagnostics>): ErrorDiagnostics;
  assertOpen(): void;
}

/** Maximum candidates rendered into an ambiguity diagnostic. */
const MAX_CANDIDATES = 10;

/** Wheel events sent per unit of `deltaY`, capped so a typo cannot spin forever. */
const MAX_WHEEL_STEPS = 100;

function known<T>(value: T, evidence: 'adapter' | 'probe' | 'terminal-grid' | 'viewport-clip' | 'paint-order' | 'hit-grid' | 'legacy-v1'): Observation<T> {
  return Object.freeze({ status: 'known', value, evidence });
}

interface LocatorState {
  readonly parent?: LocatorImpl;
  /** Index selection from `first()`/`nth()`; `undefined` keeps strict mode. */
  readonly index?: number;
}

function nodeTarget(
  node: SemanticNode,
  revision: number,
  identity: ResolvedTarget['identity'],
): ResolvedTarget {
  return Object.freeze({
    ref: `${node.id}@${revision}`,
    revision,
    semantic: true,
    rect:
      node.geometry?.visibleRect.status === 'known'
        ? node.geometry.visibleRect.value
        : node.geometry?.intendedRect.status === 'known'
          ? node.geometry.intendedRect.value
          : node.bounds ?? null,
    role: node.role,
    name: node.name,
    identity,
    ...(node.frameworkType !== undefined ? { frameworkType: node.frameworkType } : {}),
    ...(node.p !== undefined ? { provenance: node.p } : {}),
    ...(node.occlusion !== undefined ? { occlusion: node.occlusion } : {}),
  });
}

function rectTarget(rect: Rect, revision: number): ResolvedTarget {
  return Object.freeze({
    ref: `grid:${rect.row},${rect.column},${rect.width},${rect.height}@${revision}`,
    revision,
    // A grid ref carries its own coordinates, so it re-resolves by
    // construction whatever the framework can or cannot identify.
    identity: 'stable' as const,
    semantic: false,
    rect,
  });
}

/** Concrete {@link Locator}; created only by the session and by `within/first/nth`. */
export class LocatorImpl implements Locator {
  readonly #ctx: LocatorContext;
  readonly #query: LocatorQuery;
  readonly #state: LocatorState;

  constructor(ctx: LocatorContext, query: LocatorQuery, state: LocatorState = {}) {
    this.#ctx = ctx;
    this.#query = query;
    this.#state = state;
  }

  /** Human-readable form used in error messages. */
  get description(): string {
    const own = this.#query.description;
    const scoped = this.#state.parent === undefined ? own : `${this.#state.parent.description} >> ${own}`;
    return this.#state.index === undefined ? scoped : `${scoped} >> nth(${this.#state.index})`;
  }

  within(parent: Locator): Locator {
    // A debug-instrumented locator is a Proxy; the raw object is what may be
    // stored and later reached into.
    const raw = unwrap(parent);
    if (!(raw instanceof LocatorImpl)) {
      throw new UnsupportedActionError('within() requires a locator created by this harness', {
        semanticTree: this.#ctx.semanticAttached(),
      });
    }
    return new LocatorImpl(this.#ctx, this.#query, { ...this.#state, parent: raw });
  }

  first(): Locator {
    return this.nth(0);
  }

  nth(index: number): Locator {
    if (!Number.isInteger(index) || index < 0) {
      throw new UnsupportedActionError(`nth() needs a non-negative integer, received ${index}`, {
        semanticTree: this.#ctx.semanticAttached(),
      });
    }
    return new LocatorImpl(this.#ctx, this.#query, { ...this.#state, index });
  }

  async count(): Promise<number> {
    this.#ctx.assertOpen();
    await this.#ctx.negotiationSettled();
    const scope = await this.#resolveScope(Date.now() + this.#ctx.timeouts.action);
    return this.#evaluate(scope).length;
  }

  async resolve(opts?: WaitOptions): Promise<ResolvedTarget> {
    this.#ctx.assertOpen();
    await this.#ctx.negotiationSettled();
    const deadline = Date.now() + (opts?.timeout ?? this.#ctx.timeouts.action);
    for (;;) {
      this.#ctx.assertOpen();
      const scope = await this.#resolveScope(deadline);
      const matches = this.#evaluate(scope);
      const selected = this.#select(matches);
      if (selected !== null) return selected;
      if (Date.now() >= deadline) {
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
      await this.#ctx.waitForChange(deadline);
    }
  }

  async waitFor(opts?: { state?: 'visible' | 'hidden' | 'attached' } & WaitOptions): Promise<void> {
    this.#ctx.assertOpen();
    await this.#ctx.negotiationSettled();
    const wanted = opts?.state ?? 'visible';
    const deadline = Date.now() + (opts?.timeout ?? this.#ctx.timeouts.action);
    for (;;) {
      this.#ctx.assertOpen();
      const matches = await this.#tryEvaluate(deadline);
      const selected = this.#select(matches);
      const visible = selected === null ? false : this.#knownVisibleState(selected);
      const satisfied = wanted === 'attached'
        ? selected !== null
        : wanted === 'hidden'
          ? selected === null || visible === false
          : visible === true;
      if (satisfied) return;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `locator ${this.description} did not become ${wanted} in time`,
          this.#ctx.errorDiagnostics({ candidates: matches.slice(0, MAX_CANDIDATES) }),
        );
      }
      await this.#ctx.waitForChange(deadline);
    }
  }

  async geometry(): Promise<LocatorGeometry> {
    const target = await this.#readStrict();
    const stamp = this.#stamp();
    if (target === null) {
      const absent = Object.freeze({ status: 'absent', reason: 'detached' } as const);
      return Object.freeze({ stamp, coordinateSpace: absent, intendedRect: absent, visibleRect: absent });
    }
    if (!target.semantic && target.rect !== null) {
      return Object.freeze({
        stamp,
        coordinateSpace: known<CoordinateSpace>('viewport-cells', 'terminal-grid'),
        intendedRect: known(target.rect, 'terminal-grid'),
        visibleRect: known(this.#clip(target.rect), 'viewport-clip'),
      });
    }
    const qualifiedNode = this.#node(target);
    if (qualifiedNode.geometry !== undefined) {
      return Object.freeze({
        stamp,
        coordinateSpace:
          this.#ctx.semanticIndex()?.snapshot.coordinateSpace ??
          Object.freeze({ status: 'unknown', reason: 'not-reported' } as const),
        intendedRect: qualifiedNode.geometry.intendedRect,
        visibleRect: qualifiedNode.geometry.visibleRect,
      });
    }
    if (target.rect === null) {
      const unknown = Object.freeze({ status: 'unknown', reason: 'not-reported' } as const);
      return Object.freeze({ stamp, coordinateSpace: unknown, intendedRect: unknown, visibleRect: unknown });
    }
    // termwright/1 did not qualify whether bounds were intended, clipped or
    // actually visible. Preserve that uncertainty rather than retroactively
    // changing the v1 wire contract.
    return Object.freeze({
      stamp,
      coordinateSpace: this.#ctx.semanticBoundsAreAbsolute()
        ? known<CoordinateSpace>('viewport-cells', 'legacy-v1')
        : known<CoordinateSpace>('framework-local-cells', 'legacy-v1'),
      intendedRect: Object.freeze({ status: 'unknown', reason: 'legacy-unqualified' } as const),
      visibleRect: Object.freeze({ status: 'unknown', reason: 'legacy-unqualified' } as const),
    });
  }

  async visibility(): Promise<LocatorVisibility> {
    const target = await this.#readStrict();
    const stamp = this.#stamp();
    if (target === null) {
      const absent = Object.freeze({ status: 'absent', reason: 'detached' } as const);
      return Object.freeze({
        stamp,
        attached: known(false, 'adapter'),
        displayed: absent,
        viewport: absent,
        offscreen: absent,
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
      const notDisplayed = Object.freeze({ status: 'absent', reason: 'not-displayed' } as const);
      const viewport: LocatorVisibility['viewport'] = displayed.status === 'known' && displayed.value === false
        ? notDisplayed
        : intended.status === 'known' && visible.status === 'known'
        ? known({
            rect: visible.value,
            ratio: intended.value.width * intended.value.height === 0
              ? 0
              : (visible.value.width * visible.value.height) / (intended.value.width * intended.value.height),
            fullyInside:
              intended.value.row === visible.value.row &&
              intended.value.column === visible.value.column &&
              intended.value.width === visible.value.width &&
              intended.value.height === visible.value.height,
          }, 'viewport-clip')
        : visible.status === 'unsupported' || visible.status === 'absent'
          ? visible
          : Object.freeze({ status: 'unknown', reason: visible.status === 'unknown' ? visible.reason : 'not-reported' } as const);
      const offscreen: LocatorVisibility['offscreen'] = displayed.status === 'known' && displayed.value === false
        ? notDisplayed
        : intended.status === 'known' && visible.status === 'known'
          ? known(intended.value.width * intended.value.height > 0 && visible.value.width * visible.value.height === 0, 'viewport-clip')
          : visible.status === 'unsupported'
            ? visible
            : Object.freeze({ status: 'unknown', reason: visible.status === 'unknown' ? visible.reason : 'not-reported' } as const);
      return Object.freeze({ stamp, attached: known(true, 'adapter'), displayed, viewport, offscreen });
    }
    const hidden = node.state?.hidden;
    const offscreen = node.state?.offscreen;
    const displayed: Observation<boolean> = offscreen === true
      ? known(true, 'probe')
      : hidden === true
        ? known(false, 'probe')
        : hidden === false
          ? known(true, 'probe')
        : Object.freeze({ status: 'unknown', reason: 'not-reported' } as const);
    const viewport: LocatorVisibility['viewport'] = offscreen === true
      ? known({ rect: target.rect ?? { row: 0, column: 0, width: 0, height: 0 }, ratio: 0, fullyInside: false }, 'viewport-clip')
      : Object.freeze({ status: 'unknown', reason: target.rect === null ? 'not-reported' : 'legacy-unqualified' } as const);
    return Object.freeze({
      stamp,
      attached: known(true, 'adapter'),
      displayed,
      viewport,
      offscreen: offscreen === true
        ? known(true, 'probe')
        : offscreen === false
          ? known(false, 'probe')
        : Object.freeze({ status: 'unknown', reason: 'clip-unobservable' } as const),
    });
  }

  async hitTest(opts?: { readonly position?: PointerOptions['position'] }): Promise<PointerHitTest> {
    const target = await this.#readStrict();
    const stamp = this.#stamp();
    if (target === null) {
      const absent = Object.freeze({ status: 'absent', reason: 'detached' } as const);
      return Object.freeze({ stamp, point: absent, receivesEvents: absent, recipient: absent });
    }
    if (target.rect === null) {
      const absent = Object.freeze({ status: 'absent', reason: 'not-laid-out' } as const);
      return Object.freeze({ stamp, point: absent, receivesEvents: absent, recipient: absent });
    }
    const point = this.#center(target, opts?.position);
    const snapshot = this.#ctx.semanticIndex()?.snapshot;
    if (snapshot?.v === 2 && snapshot.hitGrid !== undefined) {
      if (snapshot.hitGrid.status !== 'known') {
        return Object.freeze({
          stamp,
          point: known(point, 'probe'),
          receivesEvents: snapshot.hitGrid,
          recipient: snapshot.hitGrid,
        });
      }
      const owner = snapshot.hitGrid.value.regions.find(({ rect }) =>
        point.row >= rect.row && point.row < rect.row + rect.height &&
        point.column >= rect.column && point.column < rect.column + rect.width,
      );
      if (owner === undefined) {
        const absent = Object.freeze({ status: 'absent', reason: 'not-laid-out' } as const);
        return Object.freeze({ stamp, point: known(point, 'hit-grid'), receivesEvents: known(false, 'hit-grid'), recipient: absent });
      }
      const targetId = target.ref.split('@')[0] ?? '';
      return Object.freeze({
        stamp,
        point: known(point, 'hit-grid'),
        receivesEvents: known(owner.recipientId === targetId, 'hit-grid'),
        recipient: known(owner.recipientId, 'hit-grid'),
      });
    }
    // v1's occlusion flag says that paint order was observable. It does not
    // identify the topmost recipient at this point, so it can never prove a
    // click reaches the selected node.
    const unknown = Object.freeze({ status: 'unknown', reason: 'legacy-unqualified' } as const);
    return Object.freeze({ stamp, point: known(point, 'legacy-v1'), receivesEvents: unknown, recipient: unknown });
  }

  async cellSnapshot(opts: LocatorCellSnapshotOptions = {}): Promise<LocatorCellSnapshot> {
    const geometry = await this.geometry();
    const observation = opts.box === 'intended' ? geometry.intendedRect : geometry.visibleRect;
    if (observation.status !== 'known') {
      throw new UnsupportedActionError(
        `cellSnapshot() needs known ${opts.box ?? 'visible'} bounds; received ${observation.status}`,
        this.#ctx.errorDiagnostics({ suggestion: 'use a grid locator or a probe that publishes qualified viewport geometry' }),
      );
    }
    const pad = typeof opts.padding === 'number'
      ? { top: opts.padding, right: opts.padding, bottom: opts.padding, left: opts.padding }
      : { top: opts.padding?.top ?? 0, right: opts.padding?.right ?? 0, bottom: opts.padding?.bottom ?? 0, left: opts.padding?.left ?? 0 };
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
      Object.freeze((source[rect.row + row]?.cells.slice(rect.column, rect.column + rect.width) ?? []).slice()),
    );
    const lines = cells.map((row) => row.filter((cell) => cell.width !== 0).map((cell) => cell.char === '' ? ' ' : cell.char).join('').replace(/ +$/u, ''));
    const empty: CellSnapshot = Object.freeze<CellSnapshot>({
      char: '', width: 1, fg: { kind: 'default' }, bg: { kind: 'default' },
      attributes: { bold: false, dim: false, italic: false, underline: false, inverse: false, strikethrough: false },
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
  async #tryEvaluate(deadline: number): Promise<ResolvedTarget[]> {
    let scope: ResolvedTarget | null;
    try {
      scope = await this.#resolveScope(deadline);
    } catch (error) {
      if (error instanceof TimeoutError) return [];
      throw error;
    }
    return this.#evaluate(scope);
  }

  /** Immediate strict observation: zero is detached; ambiguity is an error. */
  async #readStrict(): Promise<ResolvedTarget | null> {
    this.#ctx.assertOpen();
    await this.#ctx.negotiationSettled();
    const matches = await this.#tryEvaluate(Date.now());
    return this.#select(matches);
  }

  #stamp(): ObservationStamp {
    return Object.freeze({
      sessionId: this.#ctx.sessionId,
      screenRevision: this.#ctx.screenRevision(),
      semanticRevision: this.#ctx.semanticIndex()?.snapshot.revision ?? null,
    });
  }

  async textContent(): Promise<string> {
    const target = await this.resolve();
    if (target.semantic) {
      const node = this.#node(target);
      // A published value wins even when it is empty: an empty textbox has no
      // text, and reporting its label instead would make `toHaveText('')`
      // unsatisfiable. The name is a fallback for nodes that carry no value.
      return node.value ?? node.name;
    }
    return target.rect === null ? '' : textInRect(this.#ctx.rows(), target.rect);
  }

  async semanticState(): Promise<SemanticState | null> {
    const target = await this.resolve();
    if (!target.semantic) return null;
    return this.#node(target).state ?? null;
  }

  async extendedState(): Promise<SemanticExtendedState | null> {
    const target = await this.resolve();
    if (!target.semantic) return null;
    return this.#node(target).extended ?? null;
  }

  // -------------------------------------------------------------------------
  // Actions

  async click(opts?: PointerOptions): Promise<void> {
    await this.#act('click', (record) => this.#pointer(opts, 1, record));
  }

  async doubleClick(opts?: PointerOptions): Promise<void> {
    await this.#act('doubleClick', (record) => this.#pointer(opts, 2, record));
  }

  async dragTo(target: Locator, opts?: WaitOptions): Promise<void> {
    return this.#act('dragTo', (record) => this.#dragTo(target, record, opts));
  }

  async #dragTo(
    target: Locator,
    record: (t: ResolvedTarget) => void,
    opts?: WaitOptions,
  ): Promise<void> {
    const raw = unwrap(target);
    if (!(raw instanceof LocatorImpl)) {
      throw new UnsupportedActionError('dragTo() requires a locator created by this harness', this.#ctx.errorDiagnostics());
    }
    const source = await this.#actionTarget('dragTo', opts);
    record(source);
    this.#assertPointable(source);
    const from = this.#center(source);
    const destination = await raw.#actionTarget('dragTo', opts);
    raw.#assertPointable(destination);
    const to = this.#center(destination);
    await this.#dragBetween(from, to);
  }

  async drag(opts: { from: { row: number; column: number }; to: { row: number; column: number } }): Promise<void> {
    await this.#act('drag', () => this.#dragBetween(opts.from, opts.to));
  }

  async #dragBetween(
    from: { row: number; column: number },
    to: { row: number; column: number },
  ): Promise<void> {
    const opts = { from, to };
    this.#ctx.assertOpen();
    const modes = this.#ctx.modes();
    const events: MouseEvent[] = [
      { kind: 'press', button: 'left', row: opts.from.row, column: opts.from.column },
      { kind: 'move', button: 'left', row: opts.to.row, column: opts.to.column, dragging: true },
      { kind: 'release', button: 'left', row: opts.to.row, column: opts.to.column },
    ];
    await this.#ctx.sendInput(
      concatBytes(events.map((event) => encodeMouse(event, modes))),
      'mouse',
    );
  }

  async wheel(opts: { deltaY: number; deltaX?: number }): Promise<void> {
    await this.#act('wheel', (record) => this.#wheel(opts, record));
  }

  async #wheel(
    opts: { deltaY: number; deltaX?: number },
    record: (target: ResolvedTarget) => void,
  ): Promise<void> {
    const target = await this.#actionTarget('wheel');
    record(target);
    this.#assertPointable(target);
    const { row, column } = this.#center(target);
    const modes = this.#ctx.modes();
    const steps = Math.min(Math.abs(Math.trunc(opts.deltaY)), MAX_WHEEL_STEPS);
    if (steps === 0) return;
    const event: MouseEvent = { kind: 'wheel', row, column, wheelDelta: opts.deltaY };
    const bytes = Array.from({ length: steps }, () => encodeMouse(event, modes));
    await this.#ctx.sendInput(concatBytes(bytes), 'mouse');
  }

  async press(keys: string, opts?: WaitOptions): Promise<void> {
    await this.#act('press', async () => {
      await this.#ensureFocused('press', opts);
      await this.#ctx.sendInput(encodeKeys(keys, this.#ctx.modes()), 'key');
    });
  }

  async type(text: string, opts?: WaitOptions): Promise<void> {
    await this.#act('type', async () => {
      await this.#ensureFocused('type', opts);
      await this.#ctx.sendInput(encodeText(text), 'key');
    });
  }

  async focusNode(opts?: WaitOptions): Promise<void> {
    await this.#act('focusNode', async (record) => {
      const target = await this.#actionTarget('focusNode', opts);
      record(target);
      if (target.semantic && this.#node(target).state?.focused === true) return;
      await this.#clickTarget(target, 'left', 1);
    });
  }

  async activate(opts?: WaitOptions): Promise<ActivateReceipt> {
    return this.#act('activate', (record) => this.#activate(record, opts));
  }

  async #activate(record: (t: ResolvedTarget) => void, opts?: WaitOptions): Promise<ActivateReceipt> {
    const target = await this.#actionTarget('activate', opts, false);
    record(target);
    const node = target.semantic ? this.#node(target) : null;
    const focused = node?.state?.focused === true;

    if (focused) {
      const strategy = node !== null && (node.role === 'checkbox' || node.role === 'radio')
        ? 'focus-space'
        : 'focus-enter';
      await this.#ctx.sendInput(
        encodeKeys(strategy === 'focus-space' ? 'Space' : 'Enter', this.#ctx.modes()),
        'key',
      );
      return Object.freeze({ strategy, ref: target.ref });
    }

    if (this.#ctx.modes().mouseTracking !== 'none' && target.rect !== null) {
      await this.#clickTarget(target, 'left', 1);
      return Object.freeze({ strategy: 'click' as const, ref: target.ref });
    }

    throw new UnsupportedActionError(
      `activate() cannot reach ${this.description}: the node is not focused and mouse input is unavailable`,
      this.#ctx.errorDiagnostics({
        candidates: [target],
        suggestion:
          'move focus with press() first, or run the application under test with mouse reporting enabled',
      }),
    );
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
  async #act<T>(api: string, run: (record: (target: ResolvedTarget) => void) => Promise<T>): Promise<T> {
    const actionId = this.#ctx.beginAction(api, { selector: this.description });
    let ref: string | undefined;
    const record = (target: ResolvedTarget): void => {
      ref = target.ref;
    };
    try {
      const result = await run(record);
      this.#ctx.endAction(actionId, api, true, { selector: this.description, ...(ref !== undefined ? { ref } : {}) });
      return result;
    } catch (error) {
      this.#ctx.endAction(actionId, api, false, {
        selector: this.description,
        ...(ref !== undefined ? { ref } : {}),
        error: error instanceof TermwrightError ? error.code : error instanceof Error ? error.name : 'unknown',
      });
      throw error;
    }
  }

  async #pointer(
    opts: PointerOptions | undefined,
    clicks: number,
    record: (target: ResolvedTarget) => void,
  ): Promise<void> {
    const target = await this.#actionTarget('click', opts);
    record(target);
    await this.#clickTarget(target, opts?.button ?? 'left', clicks, opts?.position);
  }

  /** Refuses pointer input unless the exact recipient is observable. */
  #assertPointable(target: ResolvedTarget, position?: PointerOptions['position']): void {
    if (!target.semantic) return;
    if (!this.#ctx.semanticBoundsAreAbsolute()) {
      throw new UnsupportedActionError(
        `${this.description} cannot be targeted by pointer: the producer did not promise absolute bounds`,
        this.#ctx.errorDiagnostics({
          candidates: [target],
          suggestion:
            "drive the widget with press()/keyboard locators, or use an adapter that announces 'absolute-bounds'",
        }),
      );
    }
    const snapshot = this.#ctx.semanticIndex()?.snapshot;
    if (snapshot?.v === 2) {
      const point = this.#center(target, position);
      if (snapshot.hitGrid?.status !== 'known') {
        throw new UnsupportedActionError(
          `${this.description} cannot be clicked safely: exact pointer ownership is ${snapshot.hitGrid?.status ?? 'not reported'}`,
          this.#ctx.errorDiagnostics({
            candidates: [target],
            suggestion: 'use keyboard input or a producer that publishes an exact pointer hit grid',
          }),
        );
      }
      const owner = snapshot.hitGrid.value.regions.find(({ rect }) =>
        point.row >= rect.row && point.row < rect.row + rect.height &&
        point.column >= rect.column && point.column < rect.column + rect.width,
      );
      const targetId = target.ref.split('@')[0] ?? '';
      if (owner?.recipientId !== targetId) {
        throw new UnsupportedActionError(
          `${this.description} cannot receive pointer input at (${point.row}, ${point.column}); actual recipient is ${owner?.recipientId ?? 'none'}`,
          this.#ctx.errorDiagnostics({ candidates: [target] }),
        );
      }
      return;
    }
    throw new UnsupportedActionError(
      `${this.description} cannot be clicked safely: termwright/1 does not identify which node receives input when cells are covered`,
      this.#ctx.errorDiagnostics({
        candidates: [target],
        suggestion:
          'drive the widget with press()/keyboard locators; paint-order knowledge alone cannot prove which node receives the click',
      }),
    );
  }

  async #clickTarget(
    target: ResolvedTarget,
    button: MouseButton,
    clicks: number,
    position?: PointerOptions['position'],
  ): Promise<void> {
    this.#assertFreshTarget(target);
    this.#assertPointable(target, position);
    const modes = this.#ctx.modes();
    const { row, column } = this.#center(target, position);
    const events: MouseEvent[] = [];
    for (let click = 0; click < clicks; click += 1) {
      events.push({ kind: 'press', button, row, column });
      if (modes.mouseTracking !== 'x10') events.push({ kind: 'release', button, row, column });
    }
    await this.#ctx.sendInput(concatBytes(events.map((event) => encodeMouse(event, modes))), 'mouse');
  }

  #assertFreshTarget(target: ResolvedTarget): void {
    const live = target.semantic ? this.#ctx.semanticRevision() : this.#ctx.screenRevision();
    if (target.revision === live) return;
    throw new StaleSnapshotError(
      `${this.description} advanced from revision ${target.revision} to ${live} before pointer input could be sent`,
      this.#ctx.errorDiagnostics({
        candidates: [target],
        suggestion: 'retry the action so it resolves geometry and pointer ownership from one current observation',
      }),
    );
  }

  /**
   * Resolves and runs the pre-flight checks shared by every physical action.
   *
   * @param needsBounds - whether the action must land on a cell. Keyboard-only
   * paths (`press`, `type`, and `activate` on an already-focused node) work on
   * trees that carry no coordinates at all, which is a legal adapter state.
   */
  async #actionTarget(action: string, opts?: WaitOptions, needsBounds = true): Promise<ResolvedTarget> {
    const target = await this.resolve(opts);
    if (target.semantic) {
      const node = this.#node(target);
      if (node.state?.disabled === true) {
        throw new UnsupportedActionError(
          `${action}() refused: ${this.description} is disabled`,
          this.#ctx.errorDiagnostics({ candidates: [target] }),
        );
      }
      if (node.state?.hidden === true) {
        throw new UnsupportedActionError(
          `${action}() refused: ${this.description} is hidden`,
          this.#ctx.errorDiagnostics({ candidates: [target] }),
        );
      }
    }
    if (target.rect === null && needsBounds) {
      throw new UnsupportedActionError(
        `${action}() needs bounds, but ${this.description} was published without them`,
        this.#ctx.errorDiagnostics({
          candidates: [target],
          suggestion:
            'the adapter did not announce the bounds capability; drive this node with press()/type() instead',
        }),
      );
    }
    if (target.rect !== null && !this.#inViewport(target.rect)) {
      throw new UnsupportedActionError(
        `${action}() refused: ${this.description} lies outside the viewport`,
        this.#ctx.errorDiagnostics({ candidates: [target] }),
      );
    }
    return target;
  }

  /** Brings the node into focus when the tree says it is focusable and unfocused. */
  async #ensureFocused(action: string, opts?: WaitOptions): Promise<void> {
    const index = this.#ctx.semanticIndex();
    if (index === null) return; // generic session: keystrokes go to whatever has focus
    const target = await this.resolve(opts);
    if (!target.semantic) return;
    const node = this.#node(target);
    if (node.state?.focused === true) return;
    if (node.state?.disabled === true) {
      throw new UnsupportedActionError(
        `${action}() refused: ${this.description} is disabled`,
        this.#ctx.errorDiagnostics({ candidates: [target] }),
      );
    }
    if (this.#ctx.modes().mouseTracking !== 'none' && target.rect !== null) {
      await this.#clickTarget(target, 'left', 1);
      return;
    }
    throw new UnsupportedActionError(
      `${action}() refused: ${this.description} is not focused and cannot be focused physically`,
      this.#ctx.errorDiagnostics({
        candidates: [target],
        suggestion: 'move focus with harness.press() (Tab, arrows) before typing into this node',
      }),
    );
  }

  #center(target: ResolvedTarget, position?: PointerOptions['position']): { row: number; column: number } {
    const rect = target.rect;
    if (rect === null) {
      throw new UnsupportedActionError(
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

  #viewport(rect: Rect): { readonly rect: Rect; readonly ratio: number; readonly fullyInside: boolean } {
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
    return Object.freeze({ rect: clipped, ratio: area === 0 ? 0 : visible / area, fullyInside: area > 0 && visible === area });
  }

  #knownVisibleState(target: ResolvedTarget): boolean | null {
    if (!target.semantic) return target.rect !== null && this.#inViewport(target.rect);
    const node = this.#ctx.semanticIndex()?.node(target.ref.split('@')[0] ?? '');
    if (node === undefined) return false;
    if (node.geometry !== undefined) {
      if (node.geometry.displayed.status === 'known' && node.geometry.displayed.value === false) return false;
      if (node.geometry.visibleRect.status === 'known') {
        return node.geometry.visibleRect.value.width > 0 && node.geometry.visibleRect.value.height > 0;
      }
      return null;
    }
    if (node.state?.hidden === true) return false;
    // v1 bounds do not say whether they are intended or clipped, and absence
    // does not mean on-screen. Both are unknown rather than a guessed true.
    return null;
  }

  /** Re-reads the node behind a ref; a vanished stable identity is stale. */
  #node(target: ResolvedTarget): SemanticNode {
    const index = this.#ctx.semanticIndex();
    const id = target.ref.split('@')[0] ?? '';
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

  /** Resolves the parent locator, when the query is scoped with `within()`. */
  async #resolveScope(deadline: number): Promise<ResolvedTarget | null> {
    const parent = this.#state.parent;
    if (parent === undefined) return null;
    return parent.resolve({ timeout: Math.max(0, deadline - Date.now()) });
  }

  #evaluate(scope: ResolvedTarget | null): ResolvedTarget[] {
    if (this.#query.kind === 'semantic') return this.#evaluateSemantic(this.#query, scope);
    if (this.#query.kind === 'ref') return this.#evaluateRef(this.#query);
    return this.#evaluateGeneric(this.#query, scope);
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
      throw new UnsupportedActionError(
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
      throw new UnsupportedActionError(
        `locator ${this.description} needs a semantic tree, but this session has none`,
        this.#ctx.errorDiagnostics({
          suggestion:
            'use getByText()/screen() for uninstrumented programs, or run one that ships a termwright adapter',
        }),
      );
    }
    if (scope !== null && !scope.semantic) {
      throw new UnsupportedActionError(
        `within() cannot scope a semantic locator to a grid match`,
        this.#ctx.errorDiagnostics(),
      );
    }
    const scopeId = scope === null ? undefined : (scope.ref.split('@')[0] ?? undefined);
    const revision = index.snapshot.revision;
    const identity = this.#ctx.identityKind();
    return matchSemantic(index, query.steps, scopeId).map((node) =>
      nodeTarget(node, revision, identity),
    );
  }

  #evaluateGeneric(query: GenericQuery, scope: ResolvedTarget | null): ResolvedTarget[] {
    const revision = this.#ctx.screenRevision();
    return matchGrid(this.#ctx.rows(), query, scope?.rect ?? null).map((rect) => rectTarget(rect, revision));
  }

  /** Applies strict-mode selection; returns `null` when nothing is selectable yet. */
  #select(matches: readonly ResolvedTarget[]): ResolvedTarget | null {
    const index = this.#state.index;
    if (index !== undefined) return matches[index] ?? null;
    if (matches.length === 1) return matches[0] ?? null;
    if (matches.length > 1) {
      throw new AmbiguousLocatorError(
        `locator ${this.description} matched ${matches.length} nodes in strict mode`,
        matches.slice(0, MAX_CANDIDATES),
        this.#ctx.errorDiagnostics({
          suggestion: 'narrow the locator with within(), a name option, or select one with first()/nth()',
        }),
      );
    }
    return null;
  }
}
