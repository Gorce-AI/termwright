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
  /** Publishes a fully paired revision. */
  onPublish(paired: PairedRevision): void;
  /** Reports dropped, superseded or expired halves. */
  onDiagnostic(message: string): void;
}

interface PendingSnapshot {
  readonly snapshot: SemanticSnapshot;
  readonly timer: NodeJS.Timeout;
}

interface PendingMarker {
  readonly screenRevision: number;
  readonly timer: NodeJS.Timeout;
}

/** Holds the two halves of each in-flight revision until they meet. */
export class RevisionPairing {
  readonly #options: PairingOptions;
  readonly #snapshots = new Map<number, PendingSnapshot>();
  readonly #markers = new Map<number, PendingMarker>();
  #markerEnabled = false;
  #published: PairedRevision | null = null;
  #disposed = false;

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

  /** Accepts a validated tree. */
  offerSnapshot(snapshot: SemanticSnapshot): void {
    if (this.#disposed) return;
    if (snapshot.revision <= this.revision) {
      this.#options.onDiagnostic(
        `dropping semantic revision ${snapshot.revision}: revision ${this.revision} is already published`,
      );
      return;
    }
    if (!this.#markerEnabled) {
      this.#publish({ snapshot, screenRevision: null });
      return;
    }
    const marker = this.#markers.get(snapshot.revision);
    if (marker !== undefined) {
      clearTimeout(marker.timer);
      this.#markers.delete(snapshot.revision);
      this.#publish({ snapshot, screenRevision: marker.screenRevision });
      return;
    }
    this.#retain(this.#snapshots, snapshot.revision, 'tree', {
      snapshot,
      timer: this.#expire(snapshot.revision, 'tree'),
    });
  }

  /** Accepts a verified render-commit marker observed at `screenRevision`. */
  offerMarker(revision: number, screenRevision: number): void {
    if (this.#disposed) return;
    if (revision <= this.revision) {
      this.#options.onDiagnostic(
        `dropping render marker ${revision}: revision ${this.revision} is already published`,
      );
      return;
    }
    const pending = this.#snapshots.get(revision);
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      this.#snapshots.delete(revision);
      this.#publish({ snapshot: pending.snapshot, screenRevision });
      return;
    }
    this.#retain(this.#markers, revision, 'marker', {
      screenRevision,
      timer: this.#expire(revision, 'marker'),
    });
  }

  /** Clears every timer; the last published revision stays observable. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#snapshots.values()) clearTimeout(pending.timer);
    for (const marker of this.#markers.values()) clearTimeout(marker.timer);
    this.#snapshots.clear();
    this.#markers.clear();
  }

  #publish(paired: PairedRevision): void {
    this.#published = paired;
    this.#dropBelow(paired.snapshot.revision);
    this.#options.onPublish(paired);
  }

  #dropBelow(revision: number): void {
    for (const [pendingRevision, pending] of this.#snapshots) {
      if (pendingRevision >= revision) continue;
      clearTimeout(pending.timer);
      this.#snapshots.delete(pendingRevision);
      this.#options.onDiagnostic(
        `semantic revision ${pendingRevision} superseded by ${revision} before its render marker arrived`,
      );
    }
    for (const [pendingRevision, marker] of this.#markers) {
      if (pendingRevision >= revision) continue;
      clearTimeout(marker.timer);
      this.#markers.delete(pendingRevision);
      this.#options.onDiagnostic(
        `render marker ${pendingRevision} superseded by ${revision} before its tree arrived`,
      );
    }
  }

  #retain<T>(store: Map<number, T>, revision: number, half: string, entry: T): void {
    store.set(revision, entry);
    while (store.size > this.#options.maxPending) {
      const oldest = store.keys().next();
      if (oldest.done === true) break;
      const evicted = store.get(oldest.value);
      if (evicted !== undefined) clearTimeout((evicted as { timer: NodeJS.Timeout }).timer);
      store.delete(oldest.value);
      this.#options.onDiagnostic(
        `dropped pending ${half} for revision ${oldest.value}: more than ${this.#options.maxPending} revisions in flight`,
      );
    }
  }

  #expire(revision: number, half: 'tree' | 'marker'): NodeJS.Timeout {
    const timer = setTimeout(() => {
      const store = half === 'tree' ? this.#snapshots : this.#markers;
      if (!store.delete(revision)) return;
      this.#options.onDiagnostic(
        `revision ${revision} dropped: its ${half === 'tree' ? 'render marker' : 'tree'} did not arrive within ${this.#options.pairingTimeoutMs} ms`,
      );
    }, this.#options.pairingTimeoutMs);
    timer.unref?.();
    return timer;
  }
}
