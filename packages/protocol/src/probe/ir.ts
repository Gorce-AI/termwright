/**
 * Probe IR — what an instrumented process **observed**, not what it means.
 *
 * A probe reports facts; a recognizer turns them into the semantic tree. The
 * split exists because the six frameworks disagree about what is even knowable,
 * and collapsing that disagreement early is how a tree ends up asserting things
 * no framework ever said.
 *
 * Three rules shape every type here, each forced by the Phase 0 audits:
 *
 * 1. **Never fabricate identity.** Immediate-mode frameworks have none, and a
 *    synthesised ordinal presented as a handle is worse than no handle: a test
 *    written against it fails later and looks flaky rather than wrong. Identity
 *    is therefore a typed capability with `frame-local` as a first-class value.
 * 2. **Intent is not ownership.** The rectangle a widget was drawn *into* is not
 *    the cells it ended up owning; later writes win and no framework records
 *    who painted what. The two are separate fields, and only one framework
 *    computes the second.
 * 3. **Absent and unobservable are different facts.** A state a framework does
 *    not expose is not a state that is off. The IR says which is which, rather
 *    than letting `undefined` mean both.
 *
 * Naming note: the words `region` and `area` are avoided throughout. Each
 * carries at least three conflicting meanings across the audited frameworks,
 * and an IR that reuses them inherits every one of those ambiguities.
 */

/**
 * How an object's identity behaves across frames.
 *
 * `frame-local` is a legitimate answer, not a degraded one: in immediate mode
 * the widget is consumed by the render and nothing upstream survives to be
 * named again. A consumer must not correlate `frame-local` values between
 * frames.
 */
export type ProbeIdentityKind = 'stable' | 'frame-local';

/** An object's identity, tagged with what it is worth. */
export interface ProbeIdentity {
  readonly kind: ProbeIdentityKind;
  /** Unique within its frame; unique across the session only when `stable`. */
  readonly value: string;
}

/**
 * A rectangle in terminal cells.
 *
 * Deliberately not called a region or an area: `row`/`column` are absolute
 * cell coordinates, and negative origins are legal because a widget may be
 * partly scrolled off.
 */
export interface ProbeRect {
  readonly row: number;
  readonly column: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where an object was drawn.
 *
 * `intendedRect` is where it *asked* to draw. It is a statement of intent, not
 * a claim on cells: frameworks do not clip it, do not validate it against the
 * viewport, and a later write silently wins. For overlapping UIs — popups,
 * modals, shadows — it is not where the object ended up.
 *
 * `visibleRect` is the intersection with the clip imposed by ancestors, which
 * is the closest any framework gets to "what the user can see". Only one of
 * the six computes it; everywhere else it is absent, and inferring it from
 * `intendedRect` would be inventing a fact.
 */
export interface ProbeGeometry {
  readonly intendedRect?: ProbeRect;
  readonly visibleRect?: ProbeRect;
}

/** Scroll position, in cells, of a scrollable object's viewport. */
export interface ProbeScroll {
  readonly row: number;
  readonly column: number;
}

/** Total scrollable extent, in cells. Absent where a framework cannot report it. */
export interface ProbeExtent {
  readonly rows: number;
  readonly columns: number;
}

/**
 * State a probe read directly from the framework.
 *
 * Every field is optional, and absence means "not reported by this probe".
 * A field the framework is *known* not to expose belongs in
 * {@link ProbeObject.unobservable} instead, so a consumer can tell "off" from
 * "unknowable".
 *
 * The three selection facts have separate names on purpose. An accessibility
 * `selected` flag, a highlighted collection index and a selected text range
 * are not interchangeable, even though frameworks often call all three
 * "selection".
 */
export interface ProbeObservedState {
  readonly focused?: boolean;
  readonly disabled?: boolean;
  readonly checked?: boolean | 'mixed';
  readonly expanded?: boolean;
  readonly readonly?: boolean;
  readonly selected?: boolean;
  readonly busy?: boolean;
  readonly multiline?: boolean;
  /**
   * Whether the framework's own display flag is on. Distinct from being
   * scrolled out of view, which shows up as an empty `visibleRect`.
   */
  readonly displayed?: boolean;
  /** Contents of a value-bearing widget. `''` means empty, not absent. */
  readonly value?: string;
  /** Highlighted item in a collection, by index. Not a text selection. */
  readonly selectedIndex?: number;
  /** Selected text range within this object. Not an item selection. */
  readonly textSelection?: { readonly start: number; readonly end: number };
  readonly scroll?: ProbeScroll;
  readonly scrollExtent?: ProbeExtent;
}

/** Field names a probe can declare unobservable. */
export const PROBE_UNOBSERVABLE_FIELDS = [
  'focused',
  'disabled',
  'checked',
  'expanded',
  'readonly',
  'selected',
  'busy',
  'multiline',
  'displayed',
  'value',
  'selectedIndex',
  'textSelection',
  'scroll',
  'scrollExtent',
  'intendedRect',
  'visibleRect',
  'paintOrder',
  'text',
  'parent',
] as const;

export type ProbeUnobservableField = (typeof PROBE_UNOBSERVABLE_FIELDS)[number];

/**
 * Author-supplied annotations carried verbatim.
 *
 * The probe does not interpret these — a recognizer does, at the top of the
 * merge precedence. `role` is deliberately a free string here: it is whatever
 * the author wrote, and validating it against the closed role set is the
 * recognizer's job, which can then report a bad annotation instead of silently
 * dropping it.
 */
export interface ProbeAccessibilityHints {
  /** Framework-native accessibility role, in the framework's vocabulary. */
  readonly role?: string;
  readonly name?: string;
  readonly description?: string;
}

export interface ProbeAnnotations {
  readonly role?: string;
  readonly name?: string;
  readonly testId?: string;
  readonly description?: string;
  /** Application-domain JSON state, kept outside the portable state flags. */
  readonly extended?: import('../tree.js').SemanticExtendedState;
  /** Descriptive action intent; never callbacks or a second input channel. */
  readonly actions?: readonly import('../roles.js').SemanticAction[];
  /** Probe identity values of author-declared labelling relationships. */
  readonly labelledBy?: readonly string[];
  /** Probe identity values of author-declared description relationships. */
  readonly describedBy?: readonly string[];
}

/**
 * One object a probe observed in a frame.
 *
 * `frameworkType` is required. It is the framework's own name for the thing —
 * a class name, a constructor name, a widget type — and it is what keeps an
 * unrecognised widget alive as a `generic` node instead of being dropped. Its
 * quality varies enormously (Textual gives a full class ancestry; Ink gives one
 * of four host-element names), so a recognizer must treat it as a hint, not a
 * classification.
 */
export interface ProbeObject {
  readonly identity: ProbeIdentity;
  readonly frameworkType: string;
  /** Parent's identity value; absent for a root. */
  readonly parent?: string;
  readonly geometry?: ProbeGeometry;
  readonly state?: ProbeObservedState;
  /** Text the object itself carries, not its descendants'. */
  readonly text?: string;
  /** Accessibility metadata retained by the framework itself, not author SDK data. */
  readonly accessibility?: ProbeAccessibilityHints;
  readonly annotations?: ProbeAnnotations;
  /**
   * Where this object sits in paint order: higher was painted later, and
   * therefore on top.
   *
   * Available in three of the six frameworks (a compositor hit-test, a z-order
   * child list, a paint-order key) and absent in the rest. It is the only fact
   * that makes "is my target actually the thing at this cell" answerable
   * without inventing cell ownership, which no framework records.
   */
  readonly paintOrder?: number;
  /**
   * Facts this framework cannot report for this object. Distinct from a field
   * simply being absent, which means the probe did not report it this time.
   */
  readonly unobservable?: readonly ProbeUnobservableField[];
}

/**
 * A render or layout call the probe intercepted.
 *
 * Only some frameworks expose a call stream, and in immediate mode it is the
 * *only* structure that exists — there is no tree to walk, just an ordered list
 * of "this type was drawn into this rectangle". `ordinal` is the position in
 * that stream and is meaningful only within its frame.
 */
export interface ProbeOperation {
  readonly kind: 'render' | 'layout';
  readonly ordinal: number;
  /** Identity of the object this call concerned, when the probe can attribute it. */
  readonly target?: ProbeIdentity;
  readonly frameworkType?: string;
  readonly intendedRect?: ProbeRect;
}

/**
 * One observed frame.
 *
 * `objects` may be empty and `operations` may carry everything: that is what an
 * immediate-mode frame looks like, and a flat op list is a legal degenerate
 * tree rather than an error.
 */
export interface ProbeFrame {
  /** Monotonic within the session. Every framework has exactly one of these. */
  readonly frame: number;
  readonly objects: readonly ProbeObject[];
  readonly operations?: readonly ProbeOperation[];
}

/** Optional abilities a probe declares at handshake time. */
export const PROBE_CAPABILITIES = [
  /** Identities survive across frames and may be correlated. */
  'stable-identity',
  /** `visibleRect` is computed, not guessed. */
  'visible-rect',
  /** A render/layout call stream is reported. */
  'operations',
  /** Author annotations are readable. */
  'annotations',
  /** A frame-start signal is emitted. Absent for most frameworks — see below. */
  'frame-begin',
  /** `paintOrder` is reported, so occlusion can be reasoned about. */
  'paint-order',
] as const;

export type ProbeCapability = (typeof PROBE_CAPABILITIES)[number];

/**
 * What a probe says about itself when it attaches.
 *
 * @remarks
 * `frame-begin` is optional for a reason that is easy to get wrong. No audited
 * framework offers a hook guaranteed to fire before every frame: one lets a
 * pre-draw hook veto the frame entirely (so the post-draw hook never runs), one
 * exposes only a post-frame hook, and one decouples submission from the flush
 * with a ticker. A consumer must therefore never read "no frame-begin" as "no
 * frame in progress" — doing so turns four of the six frameworks into a hang
 * rather than an error.
 */
export interface ProbeInfo {
  /** Framework name, e.g. `ink`, `textual`, `ratatui`. */
  readonly framework: string;
  readonly frameworkVersion?: string;
  /** Version of the probe itself, so a mismatch is diagnosable. */
  readonly probeVersion: string;
  /** The best identity this probe can offer for any object. */
  readonly identityKind: ProbeIdentityKind;
  readonly capabilities: readonly ProbeCapability[];
}

/**
 * Where a semantic fact came from.
 *
 * Ranked: an annotation is what the author said, a recognizer is what our rules
 * concluded, `framework` is what the framework itself reported, `correlation`
 * is what matching across sources implied, and `heuristic` is a guess that
 * happened to be useful. The merge precedence follows this order, except that
 * physical facts — bounds, focus, visibility, cells — are never casually
 * overridden by an annotation: an author may name a thing, but may not declare
 * where it is on screen.
 */
export const PROVENANCE_SOURCES = [
  'annotation',
  'recognizer',
  'framework',
  'correlation',
  'heuristic',
] as const;

export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];
