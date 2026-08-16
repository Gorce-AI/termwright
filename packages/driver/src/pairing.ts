/**
 * Frame↔tree pairing (design §4.3).
 *
 * A semantic revision becomes observable only when the driver holds *both*
 * halves of it: the tree that arrived on the semantic socket and the
 * render-commit marker that arrived in stdout after the last byte of that
 * render. Until then the revision is in flight — which is exactly what
 * `waitForStable` needs to know.
 *
 * Everything here is bounded: at most {@link PairingOptions.maxPending} halves
 * are held, each half expires after {@link PairingOptions.pairingTimeoutMs},
 * and publishing revision N drops every incomplete revision below N with a
 * diagnostic rather than silently forgetting it.
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
  readonly pairingTimeoutMs: number;
  /**
   * Resolves once the emulator has parsed everything received up to the moment
   * of the call. A half's expiry clock starts then, never before.
   *
   * The two halves reach the driver by unequal roads: a tree arrives on a
   * socket and needs no parsing, while its marker is bytes in the output
   * stream, queued behind every byte written before it. Under a flood that
   * queue was measured adding 0.7 s against a 1 s window on a machine where
   * the transport added nothing — so a timeout without this barrier reports
   * "the other half never came" when the truth is "we had not read it yet".
   *
   * Defaults to "already caught up", which restores the plain timeout.
   */
  caughtUp?(): Promise<void>;
  /** Publishes a fully paired revision. */
  onPublish(paired: PairedRevision): void;
  /** Reports dropped, superseded or expired halves. */
  onDiagnostic(code: DiagnosticCode, detail: string, revision: number): void;
}

interface PendingSnapshot {
  readonly snapshot: SemanticSnapshot;
  readonly expiry: DeferredExpiry;
}

interface PendingMarker {
  readonly screenRevision: number;
  readonly expiry: DeferredExpiry;
}

/**
 * A timeout that does not start until a barrier resolves. Cancelling before
 * the barrier settles is honoured, so a half that pairs while the emulator is
 * still catching up never arms a timer at all.
 */
class DeferredExpiry {
  #timer: NodeJS.Timeout | null = null;
  #cancelled = false;

  constructor(barrier: Promise<void>, delayMs: number, onExpire: () => void) {
    void barrier.then(
      () => this.#arm(delayMs, onExpire),
      // A barrier that rejects must not strand the half forever: fall back to
      // arming immediately, which is the behaviour without a barrier at all.
      () => this.#arm(delayMs, onExpire),
    );
  }

  cancel(): void {
    this.#cancelled = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
  }

  #arm(delayMs: number, onExpire: () => void): void {
    if (this.#cancelled) return;
    this.#timer = setTimeout(onExpire, delayMs);
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

  /** True while a probe has a frame open. */
  get hasOpenFrame(): boolean {
    return this.#openFrames.size > 0;
  }

  /**
   * A probe reports that it has started rendering `revision`.
   *
   * This is the fact the quiet-stream rule was approximating: "output is still
   * arriving" was only ever a guess at "the application is still drawing".
   * While a frame is open no half may expire, because the evidence for it is
   * still being produced.
   *
   * Opening a frame abandons any lower one still open. A probe that dies
   * mid-render, or abandons a frame it decided not to finish, must not be able
   * to hold expiry open forever — and the next frame beginning is proof the
   * previous one is not coming.
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
      marker.expiry.cancel();
      this.#markers.delete(snapshot.revision);
      this.#publish({ snapshot, screenRevision: marker.screenRevision });
      return;
    }
    this.#retain(this.#snapshots, snapshot.revision, 'tree', {
      snapshot,
      expiry: this.#expire(snapshot.revision, 'tree'),
    });
  }

  /** Accepts a verified render-commit marker observed at `screenRevision`. */
  offerMarker(revision: number, screenRevision: number): void {
    if (this.#disposed) return;
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
      pending.expiry.cancel();
      this.#snapshots.delete(revision);
      this.#publish({ snapshot: pending.snapshot, screenRevision });
      return;
    }
    this.#retain(this.#markers, revision, 'marker', {
      screenRevision,
      expiry: this.#expire(revision, 'marker'),
    });
  }

  /** Clears every timer; the last published revision stays observable. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#snapshots.values()) pending.expiry.cancel();
    for (const marker of this.#markers.values()) marker.expiry.cancel();
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
      pending.expiry.cancel();
      this.#snapshots.delete(pendingRevision);
      this.#options.onDiagnostic(
        'revision-superseded',
        `semantic revision ${pendingRevision} superseded by ${revision} before its render marker arrived`,
        pendingRevision,
      );
    }
    for (const [pendingRevision, marker] of this.#markers) {
      if (pendingRevision >= revision) continue;
      marker.expiry.cancel();
      this.#markers.delete(pendingRevision);
      this.#options.onDiagnostic(
        'revision-superseded',
        `render marker ${pendingRevision} superseded by ${revision} before its tree arrived`,
        pendingRevision,
      );
    }
  }

  #retain<T>(store: Map<number, T>, revision: number, half: string, entry: T): void {
    store.set(revision, entry);
    while (store.size > this.#options.maxPending) {
      const oldest = store.keys().next();
      if (oldest.done === true) break;
      const evicted = store.get(oldest.value);
      if (evicted !== undefined) (evicted as { expiry: DeferredExpiry }).expiry.cancel();
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

  #expire(revision: number, half: 'tree' | 'marker'): DeferredExpiry {
    // The clock starts once the evidence cannot still be arriving: the
    // emulator has caught up with the bytes it received, and no frame is open.
    // A timeout then means the other half never came, rather than that the
    // driver was still reading, or the application still drawing.
    const barrier = Promise.resolve(this.#options.caughtUp?.()).then(() => this.#framesIdle());
    return new DeferredExpiry(barrier, this.#options.pairingTimeoutMs, () => {
      const store = half === 'tree' ? this.#snapshots : this.#markers;
      if (!store.delete(revision)) return;
      this.#options.onDiagnostic(
        'revision-expired',
        `revision ${revision} dropped: its ${half === 'tree' ? 'render marker' : 'tree'} did not arrive within ${this.#options.pairingTimeoutMs} ms`,
        revision,
      );
    });
  }
}
