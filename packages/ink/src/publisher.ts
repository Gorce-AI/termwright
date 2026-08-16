/**
 * The publication cycle — the part of the adapter that pairs a semantic tree
 * with the exact bytes of the frame it describes.
 *
 * Ordering is the whole point, and it is empirically pinned to Ink 7 internals
 * (see NOTES.md, "Marker PoC"):
 *
 * 1. Ink calls `options.onRender` **before** it writes the frame to stdout.
 *    Emitting the marker there would place it in front of its own frame.
 * 2. The publisher therefore only bumps the revision synchronously and defers
 *    the rest past the current macrotask, by which point Ink has queued the
 *    whole frame — including the closing synchronized-output sequence.
 * 3. It then collects the tree (Yoga layout is still the one that produced
 *    that frame), pushes the snapshot, waits for stdout to drain, and only
 *    then writes the marker.
 *
 * A render that is superseded before step 3 is dropped, as the design allows:
 * publishing it would pair revision N's tree with revision N+1's pixels.
 */

import type { DOMElement } from 'ink';
import { encodeMarker, type SemanticSnapshot } from '@termwright/protocol';
import { computeTreeDelta, deltaIsWorthSending } from './delta.js';
import type { SemanticChannel } from './channel.js';
import { hasStaticContent, SnapshotCollector } from './collect.js';
import type { SemanticRegistry } from './registry.js';

/** Everything the publisher needs to turn a committed render into wire traffic. */
export interface PublisherOptions {
  readonly channel: SemanticChannel;
  readonly registry: SemanticRegistry;
  /** Resolves Ink's root element; `null` until the first commit attaches the probe. */
  readonly resolveRoot: () => DOMElement | null;
  /** The stream Ink renders into — the marker goes here, never through the canvas. */
  readonly stdout: NodeJS.WriteStream;
  readonly token: string;
  /** Whether the adapter claimed `absolute-bounds` during the handshake. */
  readonly claimsAbsoluteBounds: boolean;
}

/** Drives snapshot publication and marker emission for one Ink instance. */
export class SemanticPublisher {
  readonly #options: PublisherOptions;
  readonly #collector: SnapshotCollector;
  #revision = 0;
  #queue: Promise<void> = Promise.resolve();
  #latest: SemanticSnapshot | undefined;
  /** The tree the driver is known to hold; the base every delta composes onto. */
  #lastSent: SemanticSnapshot | undefined;
  #disposed = false;

  constructor(options: PublisherOptions) {
    this.#options = options;
    this.#collector = new SnapshotCollector(options.registry, options.channel.session.limits);
    options.channel.onGetTree((revision) => {
      if (this.#latest === undefined) return undefined;
      if (revision !== undefined && revision !== this.#latest.revision) return undefined;
      return this.#latest;
    });
  }

  /** The last revision handed to the publisher, published or not. */
  get revision(): number {
    return this.#revision;
  }

  /**
   * Register a committed render. Call this from Ink's `onRender`; it does only
   * a counter bump synchronously, so it cannot slow the render loop down.
   */
  notifyRender(): void {
    if (this.#disposed) return;
    this.#revision += 1;
    const revision = this.#revision;
    this.#queue = this.#queue.then(async () => {
      await nextMacrotask();
      await this.#publish(revision);
    });
    this.#queue.catch(() => this.#fail());
  }

  /** Stop publishing and close the channel. Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#latest = undefined;
    this.#lastSent = undefined;
    this.#options.channel.close();
  }

  async #publish(revision: number): Promise<void> {
    if (this.#disposed || !this.#options.channel.isOpen) return;
    if (revision !== this.#revision) return; // superseded by a newer frame

    const root = this.#options.resolveRoot();
    if (root === null) return;

    const { channel, stdout, token, claimsAbsoluteBounds } = this.#options;
    const snapshot = this.#collector.collect(root, {
      sessionId: channel.session.sessionId,
      revision,
      columns: stdout.columns ?? 80,
      rows: stdout.rows ?? 24,
      includeBounds: !(claimsAbsoluteBounds && hasStaticContent(root)),
    });
    this.#latest = snapshot;

    this.#publishTree(snapshot);
    channel.sendRevisionCommit(revision);

    if (!channel.session.markerEnabled) return;
    await drain(stdout);
    if (this.#disposed || !channel.isOpen) return;
    stdout.write(encodeMarker(token, channel.session.sessionId, revision));
  }

  /**
   * Send the tree in whichever form the driver asked for.
   *
   * In `diffs` mode a delta needs a base the driver actually holds, so the
   * first publication — and any publication whose delta would not pay for
   * itself — goes out as a full snapshot. That is allowed: `subscribe: 'diffs'`
   * selects a preference, not a prohibition.
   */
  #publishTree(snapshot: SemanticSnapshot): void {
    const { channel } = this.#options;
    if (channel.session.subscribe === 'revisions') return;

    if (channel.session.subscribe === 'diffs' && this.#lastSent !== undefined) {
      const delta = computeTreeDelta(this.#lastSent, snapshot);
      if (deltaIsWorthSending(delta, snapshot)) {
        channel.sendTreeDelta(delta);
        this.#lastSent = snapshot;
        return;
      }
    }

    channel.sendSnapshot(snapshot);
    this.#lastSent = snapshot;
  }

  /**
   * Any fault in the publication path disables semantics for the rest of the
   * process. The application must never notice.
   */
  #fail(): void {
    this.#queue = Promise.resolve();
    this.dispose();
  }
}

/**
 * Yield past the current macrotask, so Ink's synchronous `onRender` body — the
 * one that writes the frame — has finished.
 */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Wait until everything already queued on the stream has been handed to the OS.
 *
 * Ink's own `waitUntilRenderFlush()` is deliberately not used here: it settles
 * pending throttled renders first, which can push a *newer* frame out ahead of
 * the marker and silently mispair revision N's tree with revision N+1's pixels.
 * A zero-length write with a completion callback flushes what is queued and
 * nothing more.
 */
function drain(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.writableEnded || stream.destroyed) {
      resolve();
      return;
    }
    stream.write('', () => {
      resolve();
    });
  });
}
