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
import type { Rect, SemanticNode, SemanticState } from '@termwright/protocol';
import type {
  ActivateReceipt,
  ErrorDiagnostics,
  Locator,
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
import { encodeKeys, encodeText } from './keys.js';
import { concatBytes, encodeMouse, type MouseButton, type MouseEvent } from './mouse.js';
import { matchGrid, matchSemantic, textInRect, type SemanticIndex } from './matching.js';
import type { CapturedRow } from './screen.js';
import type { GenericQuery, LocatorQuery, RefQuery, SemanticQuery } from './selectors.js';

/** Everything a locator needs from its session. */
export interface LocatorContext {
  readonly timeouts: Required<TimeoutClasses>;
  /** Resolves once semantic negotiation has settled one way or the other. */
  settled(): Promise<void>;
  semanticIndex(): SemanticIndex | null;
  /** True once an adapter completed the handshake, even before its first tree. */
  semanticAttached(): boolean;
  /** The error that closed the semantic channel, if one did. */
  semanticViolation(): TermwrightError | null;
  semanticRevision(): number;
  screenRevision(): number;
  rows(): readonly CapturedRow[];
  modes(): TerminalModes;
  /** Resolves when a screen or semantic revision is published, or the deadline passes. */
  waitForChange(deadline: number): Promise<void>;
  sendInput(data: Uint8Array, kind: 'key' | 'mouse' | 'paste' | 'raw'): Promise<void>;
  errorDiagnostics(extra?: Partial<ErrorDiagnostics>): ErrorDiagnostics;
  assertOpen(): void;
}

/** Maximum candidates rendered into an ambiguity diagnostic. */
const MAX_CANDIDATES = 10;

/** Wheel events sent per unit of `deltaY`, capped so a typo cannot spin forever. */
const MAX_WHEEL_STEPS = 100;

interface LocatorState {
  readonly parent?: LocatorImpl;
  /** Index selection from `first()`/`nth()`; `undefined` keeps strict mode. */
  readonly index?: number;
}

function nodeTarget(node: SemanticNode, revision: number): ResolvedTarget {
  return Object.freeze({
    ref: `${node.id}@${revision}`,
    revision,
    semantic: true,
    rect: node.bounds ?? null,
    role: node.role,
    name: node.name,
  });
}

function rectTarget(rect: Rect, revision: number): ResolvedTarget {
  return Object.freeze({
    ref: `grid:${rect.row},${rect.column},${rect.width},${rect.height}@${revision}`,
    revision,
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
    if (!(parent instanceof LocatorImpl)) {
      throw new UnsupportedActionError('within() requires a locator created by this harness', {
        semanticTree: this.#ctx.semanticAttached(),
      });
    }
    return new LocatorImpl(this.#ctx, this.#query, { ...this.#state, parent });
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
    await this.#ctx.settled();
    const scope = await this.#resolveScope(Date.now() + this.#ctx.timeouts.action);
    return this.#evaluate(scope).length;
  }

  async resolve(opts?: WaitOptions): Promise<ResolvedTarget> {
    this.#ctx.assertOpen();
    await this.#ctx.settled();
    const deadline = Date.now() + (opts?.timeout ?? this.#ctx.timeouts.action);
    for (;;) {
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
    await this.#ctx.settled();
    const wanted = opts?.state ?? 'visible';
    const deadline = Date.now() + (opts?.timeout ?? this.#ctx.timeouts.action);
    for (;;) {
      const matches = await this.#tryEvaluate(deadline);
      const satisfied =
        wanted === 'hidden'
          ? matches.length === 0 || !matches.some((match) => this.#isVisibleTarget(match))
          : wanted === 'attached'
            ? matches.length > 0
            : matches.some((match) => this.#isVisibleTarget(match));
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

  async isVisible(): Promise<boolean> {
    this.#ctx.assertOpen();
    await this.#ctx.settled();
    const matches = await this.#tryEvaluate(Date.now() + this.#ctx.timeouts.action);
    return matches.some((match) => this.#isVisibleTarget(match));
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

  async textContent(): Promise<string> {
    const target = await this.resolve();
    if (target.semantic) {
      const node = this.#node(target);
      return node.value !== undefined && node.value.length > 0 ? node.value : node.name;
    }
    return target.rect === null ? '' : textInRect(this.#ctx.rows(), target.rect);
  }

  async boundingBox(): Promise<Rect | null> {
    const target = await this.resolve();
    return target.rect;
  }

  async semanticState(): Promise<SemanticState | null> {
    const target = await this.resolve();
    if (!target.semantic) return null;
    return this.#node(target).state ?? null;
  }

  // -------------------------------------------------------------------------
  // Actions

  async click(opts?: PointerOptions): Promise<void> {
    await this.#pointer(opts, 1);
  }

  async doubleClick(opts?: PointerOptions): Promise<void> {
    await this.#pointer(opts, 2);
  }

  async dragTo(target: Locator, opts?: WaitOptions): Promise<void> {
    if (!(target instanceof LocatorImpl)) {
      throw new UnsupportedActionError('dragTo() requires a locator created by this harness', this.#ctx.errorDiagnostics());
    }
    const from = this.#center(await this.#actionTarget('dragTo', opts));
    const to = this.#center(await target.#actionTarget('dragTo', opts));
    await this.drag({ from, to });
  }

  async drag(opts: { from: { row: number; column: number }; to: { row: number; column: number } }): Promise<void> {
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
    const target = await this.#actionTarget('wheel');
    const { row, column } = this.#center(target);
    const modes = this.#ctx.modes();
    const steps = Math.min(Math.abs(Math.trunc(opts.deltaY)), MAX_WHEEL_STEPS);
    if (steps === 0) return;
    const event: MouseEvent = { kind: 'wheel', row, column, wheelDelta: opts.deltaY };
    const bytes = Array.from({ length: steps }, () => encodeMouse(event, modes));
    await this.#ctx.sendInput(concatBytes(bytes), 'mouse');
  }

  async press(keys: string, opts?: WaitOptions): Promise<void> {
    await this.#ensureFocused('press', opts);
    await this.#ctx.sendInput(encodeKeys(keys, this.#ctx.modes()), 'key');
  }

  async type(text: string, opts?: WaitOptions): Promise<void> {
    await this.#ensureFocused('type', opts);
    await this.#ctx.sendInput(encodeText(text), 'key');
  }

  async focusNode(opts?: WaitOptions): Promise<void> {
    const target = await this.#actionTarget('focusNode', opts);
    if (target.semantic && this.#node(target).state?.focused === true) return;
    await this.#clickTarget(target, 'left', 1);
  }

  async activate(opts?: WaitOptions): Promise<ActivateReceipt> {
    const target = await this.#actionTarget('activate', opts, false);
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

  async #pointer(opts: PointerOptions | undefined, clicks: number): Promise<void> {
    const target = await this.#actionTarget('click', opts);
    await this.#clickTarget(target, opts?.button ?? 'left', clicks, opts?.position);
  }

  async #clickTarget(
    target: ResolvedTarget,
    button: MouseButton,
    clicks: number,
    position?: PointerOptions['position'],
  ): Promise<void> {
    const modes = this.#ctx.modes();
    const { row, column } = this.#center(target, position);
    const events: MouseEvent[] = [];
    for (let click = 0; click < clicks; click += 1) {
      events.push({ kind: 'press', button, row, column });
      if (modes.mouseTracking !== 'x10') events.push({ kind: 'release', button, row, column });
    }
    await this.#ctx.sendInput(concatBytes(events.map((event) => encodeMouse(event, modes))), 'mouse');
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
    const rows = this.#ctx.rows();
    const columns = rows[0]?.cells.length ?? 0;
    return rect.row >= 0 && rect.column >= 0 && rect.row < rows.length && rect.column < Math.max(columns, 1);
  }

  #isVisibleTarget(target: ResolvedTarget): boolean {
    if (!target.semantic) return target.rect !== null && this.#inViewport(target.rect);
    const node = this.#ctx.semanticIndex()?.node(target.ref.split('@')[0] ?? '');
    if (node === undefined) return false;
    if (node.state?.hidden === true) return false;
    return node.bounds === undefined || this.#inViewport(node.bounds);
  }

  /** Re-reads the node behind a ref; a vanished node is a stale-snapshot error. */
  #node(target: ResolvedTarget): SemanticNode {
    const index = this.#ctx.semanticIndex();
    const id = target.ref.split('@')[0] ?? '';
    const node = index?.node(id);
    if (node === undefined) {
      throw new StaleSnapshotError(
        `ref ${target.ref} no longer exists at semantic revision ${this.#ctx.semanticRevision()}`,
        this.#ctx.errorDiagnostics({
          suggestion: 're-resolve the locator; refs are bound to the revision they were taken at',
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

  /**
   * Resolves a ref by identity. A ref is bound to the revision it was minted
   * at, so a moved-on screen is a stale-snapshot error rather than a silent
   * re-query that might land on a different node.
   */
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
      if (this.#ctx.semanticAttached()) return [];
      throw new UnsupportedActionError(
        `${query.description} needs a semantic tree, but this session has none`,
        this.#ctx.errorDiagnostics({
          suggestion: 'target by text or by grid coordinates in a generic session',
        }),
      );
    }
    const live = index.snapshot.revision;
    if (live !== ref.revision) {
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
    return [nodeTarget(node, live)];
  }

  #evaluateSemantic(query: SemanticQuery, scope: ResolvedTarget | null): ResolvedTarget[] {
    const index = this.#ctx.semanticIndex();
    if (index === null) {
      // A channel that died before publishing anything is reported as what it
      // was — a protocol violation — instead of a generic missing tree.
      const violation = this.#ctx.semanticViolation();
      if (violation !== null) throw violation;
      // An attached adapter whose first tree is still in flight is a wait, not
      // an error: the caller's deadline decides.
      if (this.#ctx.semanticAttached()) return [];
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
    return matchSemantic(index, query.steps, scopeId).map((node) => nodeTarget(node, revision));
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
