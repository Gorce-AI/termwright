/**
 * Frame↔tree pairing (design §4.3).
 *
 * A semantic revision becomes observable only when the driver holds *both*
 * halves of it: the tree that arrived on the semantic socket and the
 * render-commit marker that arrived in stdout after the last byte of that
 * render. Until then the revision is in flight — which is exactly what
 * `waitForQuiet` needs to know.
 *
 * Everything here is bounded: at most {@link PairingOptions.maxPending} halves
 * are held, a watchdog reports a half that remains unmatched after
 * {@link PairingOptions.pairingTimeoutMs}, and publishing revision N drops
 * every incomplete revision below N with a diagnostic. The watchdog never
 * changes pairing state: operation/session deadlines own failure, and a late
 * authoritative half must still be able to complete its revision.
 */
import type { SemanticSnapshot } from '@termwright/protocol';
import type { DiagnosticCode } from './api.js';

/** A published, fully paired revision. */
export interface PairedRevision {
  readonly snapshot: SemanticSnapshot;
  /** Screen revision the render marker committed, or `null` when unpaired mode is active. */
  readonly screenRevision: number | null;
}

/** Construction options for {@link RevisionPairing}. */
export interface PairingOptions {
  readonly maxPending: number;
  /** Diagnostic watchdog interval; it never expires or removes a half. */
  readonly pairingTimeoutMs: number;
  /**
   * Resolves once the emulator has parsed everything received up to the moment
   * of the call. A half's diagnostic watchdog starts then, never before.
   *
   * The two halves reach the driver by unequal roads: a tree arrives on a
   * socket and needs no parsing, while its marker is bytes in the output
   * stream, queued behind every byte written before it. Under a flood that
   * queue was measured adding 0.7 s against a 1 s window on a machine where
   * the transport added nothing — so a timeout without this barrier reports
   * "the other half never came" when the truth is "we had not read it yet".
   *
   * Defaults to "already caught up", which starts the watchdog immediately.
   */
  caughtUp?(): Promise<void>;
  /** Publishes a fully paired revision. */
  onPublish(paired: PairedRevision): void;
  /** Reports dropped, superseded or long-pending halves. */
  onDiagnostic(code: DiagnosticCode, detail: string, revision: number): void;
}

interface PendingSnapshot {
  readonly snapshot: SemanticSnapshot;
  readonly watchdog: DeferredWatchdog;
}

interface PendingMarker {
  readonly screenRevision: number;
  readonly watchdog: DeferredWatchdog;
}

/**
 * A watchdog that does not start until a barrier resolves. Cancelling before
 * the barrier settles is honoured, so a half that pairs while the emulator is
 * still catching up never arms a timer at all.
 */
class DeferredWatchdog {
  #timer: NodeJS.Timeout | null = null;
  #cancelled = false;
  #elapsed = false;

  constructor(barrier: Promise<void>, delayMs: number, onElapsed: () => void) {
    void barrier.then(
      () => this.#arm(delayMs, onElapsed),
      // A barrier failure must not suppress diagnostics: fall back to arming
      // immediately, which is the behaviour without a barrier at all.
      () => this.#arm(delayMs, onElapsed),
    );
  }

  cancel(): void {
    this.#cancelled = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
  }

  /** True once the diagnostic window elapsed without this watchdog being cancelled. */
  get elapsed(): boolean {
    return this.#elapsed;
  }

  #arm(delayMs: number, onElapsed: () => void): void {
    if (this.#cancelled) return;
    this.#timer = setTimeout(() => {
      if (this.#cancelled) return;
      this.#elapsed = true;
      onElapsed();
    }, delayMs);
    this.#timer.unref?.();
  }
}

/** Holds the two halves of each in-flight revision until they meet. */
export class RevisionPairing {
  readonly #options: PairingOptions;
  readonly #snapshots = new Map<number, PendingSnapshot>();
  readonly #markers = new Map<number, PendingMarker>();
  #markerEnabled = false;
  #published: PairedRevision | null = null;
  #disposed = false;
  /** Revisions whose frame a probe has opened and not yet closed. */
  readonly #openFrames = new Set<number>();
  readonly #frameWaiters = new Set<() => void>();

  constructor(options: PairingOptions) {
    this.#options = options;
  }

  /**
   * Enables marker pairing. Until an adapter announces the `render-revisions`
   * capability, trees are published on arrival (honest degradation: the
   * revision is real, the pairing guarantee is not).
   */
  setMarkerEnabled(enabled: boolean): void {
    this.#markerEnabled = enabled;
  }

  /** The most recently published revision, or `null`. */
  get published(): PairedRevision | null {
    return this.#published;
  }

  /** Highest published semantic revision, or 0. */
  get revision(): number {
    return this.#published?.snapshot.revision ?? 0;
  }

  /** True while a revision has one half but not the other. */
  get hasPendingRender(): boolean {
    return this.#snapshots.size > 0 || this.#markers.size > 0;
  }

  /**
   * True while an unmatched half is still inside its diagnostic window.
   *
   * An elapsed half remains in {@link hasPendingRender} and can still pair
   * authoritatively if its counterpart arrives late. It is no longer active
   * work that can keep unrelated actions or `waitForQuiet` blocked forever.
   */
  get hasBlockingRender(): boolean {
    for (const pending of this.#snapshots.values()) {
      if (!pending.watchdog.elapsed) return true;
    }
    for (const marker of this.#markers.values()) {
      if (!marker.watchdog.elapsed) return true;
    }
    return false;
  }

  /** True while a probe has a frame open. */
  get hasOpenFrame(): boolean {
    return this.#openFrames.size > 0;
  }

  /**
   * A probe reports that it has started rendering `revision`.
   *
   * This is the fact the quiet-stream rule was approximating: "output is still
   * arriving" was only ever a guess at "the application is still drawing".
   * While a frame is open the missing-half watchdog must not fire, because the
   * evidence for it is still being produced.
   *
   * Opening a frame abandons any lower one still open. A probe that dies
   * mid-render, or abandons a frame it decided not to finish, must not be able
   * to suppress the watchdog forever — and the next frame beginning is proof
   * the previous frame is no longer active.
   */
  frameOpened(revision: number): void {
    if (this.#disposed) return;
    for (const open of this.#openFrames) {
      if (open < revision) this.#openFrames.delete(open);
    }
    this.#openFrames.add(revision);
  }

  /** A probe reports that `revision` finished rendering. */
  frameClosed(revision: number): void {
    if (!this.#openFrames.delete(revision)) return;
    if (this.#openFrames.size === 0) this.#releaseFrameWaiters();
  }

  /** Accepts a validated tree. */
  offerSnapshot(snapshot: SemanticSnapshot): void {
    if (this.#disposed) return;
    if (snapshot.revision <= this.revision) {
      this.#options.onDiagnostic(
        'revision-dropped',
        `dropping semantic revision ${snapshot.revision}: revision ${this.revision} is already published`,
        snapshot.revision,
      );
      return;
    }
    if (!this.#markerEnabled) {
      this.#publish({ snapshot, screenRevision: null });
      return;
    }
    const marker = this.#markers.get(snapshot.revision);
    if (marker !== undefined) {
      marker.watchdog.cancel();
      this.#markers.delete(snapshot.revision);
      this.#publish({ snapshot, screenRevision: marker.screenRevision });
      return;
    }
    this.#retain(this.#snapshots, snapshot.revision, 'tree', {
      snapshot,
      watchdog: this.#watch(snapshot.revision, 'tree'),
    });
  }

  /** Accepts a verified render-commit marker observed at `screenRevision`. */
  offerMarker(revision: number, screenRevision: number): void {
    if (this.#disposed) return;
    if (!this.#markerEnabled) {
      this.#options.onDiagnostic(
        'adapter-capability',
        `ignoring render marker ${revision}: the adapter did not negotiate render-revisions`,
        revision,
      );
      return;
    }
    if (revision <= this.revision) {
      this.#options.onDiagnostic(
        'revision-dropped',
        `dropping render marker ${revision}: revision ${this.revision} is already published`,
        revision,
      );
      return;
    }
    const pending = this.#snapshots.get(revision);
    if (pending !== undefined) {
      pending.watchdog.cancel();
      this.#snapshots.delete(revision);
      this.#publish({ snapshot: pending.snapshot, screenRevision });
      return;
    }
    this.#retain(this.#markers, revision, 'marker', {
      screenRevision,
      watchdog: this.#watch(revision, 'marker'),
    });
  }

  /** Clears every timer; the last published revision stays observable. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#snapshots.values()) pending.watchdog.cancel();
    for (const marker of this.#markers.values()) marker.watchdog.cancel();
    this.#snapshots.clear();
    this.#markers.clear();
    this.#openFrames.clear();
    // Anything waiting on a frame is waiting on a session that is gone.
    this.#releaseFrameWaiters();
  }

  #publish(paired: PairedRevision): void {
    this.#published = paired;
    this.#dropBelow(paired.snapshot.revision);
    this.#options.onPublish(paired);
  }

  #dropBelow(revision: number): void {
    for (const [pendingRevision, pending] of this.#snapshots) {
      if (pendingRevision >= revision) continue;
      pending.watchdog.cancel();
      this.#snapshots.delete(pendingRevision);
      this.#options.onDiagnostic(
        'revision-superseded',
        `semantic revision ${pendingRevision} superseded by ${revision} before its render marker arrived`,
        pendingRevision,
      );
    }
    for (const [pendingRevision, marker] of this.#markers) {
      if (pendingRevision >= revision) continue;
      marker.watchdog.cancel();
      this.#markers.delete(pendingRevision);
      this.#options.onDiagnostic(
        'revision-superseded',
        `render marker ${pendingRevision} superseded by ${revision} before its tree arrived`,
        pendingRevision,
      );
    }
  }

  #retain<T extends { watchdog: DeferredWatchdog }>(
    store: Map<number, T>,
    revision: number,
    half: string,
    entry: T,
  ): void {
    // Repeated delivery replaces the evidence for this half. Its old watchdog
    // must not later report the replacement as stale.
    store.get(revision)?.watchdog.cancel();
    store.set(revision, entry);
    while (store.size > this.#options.maxPending) {
      const oldest = store.keys().next();
      if (oldest.done === true) break;
      const evicted = store.get(oldest.value);
      evicted?.watchdog.cancel();
      store.delete(oldest.value);
      this.#options.onDiagnostic(
        'revision-dropped',
        `dropped pending ${half} for revision ${oldest.value}: more than ${this.#options.maxPending} revisions in flight`,
        oldest.value,
      );
    }
  }

  #releaseFrameWaiters(): void {
    for (const waiter of [...this.#frameWaiters]) waiter();
    this.#frameWaiters.clear();
  }

  /** Resolves once no probe has a frame open. */
  async #framesIdle(): Promise<void> {
    while (this.#openFrames.size > 0 && !this.#disposed) {
      await new Promise<void>((resolve) => this.#frameWaiters.add(resolve));
    }
  }

  #watch(revision: number, half: 'tree' | 'marker'): DeferredWatchdog {
    // The watchdog starts once the evidence cannot still be arriving: the
    // emulator has caught up with the bytes it received, and no frame is open.
    // Elapsing reports a causally missing counterpart but deliberately retains
    // the authoritative half. Caller-owned operation/session deadlines decide
    // when waiting must fail; this timer never mutates the pairing contract.
    const barrier = Promise.resolve(this.#options.caughtUp?.()).then(() => this.#framesIdle());
    return new DeferredWatchdog(barrier, this.#options.pairingTimeoutMs, () => {
      const store = half === 'tree' ? this.#snapshots : this.#markers;
      if (!store.has(revision)) return;
      this.#options.onDiagnostic(
        'revision-pairing-watchdog',
        `revision ${revision} still pending: its ${half === 'tree' ? 'render marker' : 'tree'} did not arrive within the ${this.#options.pairingTimeoutMs} ms diagnostic window; the authoritative half was retained`,
        revision,
      );
    });
  }
}
