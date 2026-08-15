/**
 * The publication cycle — the part of the adapter that pairs a semantic tree
 * with the exact bytes of the frame it describes.
 *
 * OpenTUI makes this simpler than Ink does. Its render loop writes the frame
 * out and *then* emits `CliRenderEvents.FRAME` (verified against 0.5.3 and
 * recorded in NOTES.md), so by the time this publisher runs, the bytes it is
 * about to mark are already on the wire:
 *
 * 1. `notifyFrame()` bumps the revision and collects the tree synchronously,
 *    while `screenX`/`screenY` still hold the positions that frame was drawn
 *    at.
 * 2. It pushes the snapshot, waits for the output stream to drain, and only
 *    then writes the DCS marker.
 *
 * A frame superseded before step 2 completes is dropped, as the design allows:
 * publishing it would pair revision N's tree with revision N+1's pixels.
 */

import { encodeMarker, type SemanticSnapshot } from '@termwright/protocol';
import type { SemanticChannel } from './channel.js';
import { SnapshotCollector } from './collect.js';
import type { SemanticRegistry } from './registry.js';
import type { RenderableLike } from './types.js';

/** The viewport the frame was drawn into. */
export interface Viewport {
  readonly columns: number;
  readonly rows: number;
}

/** Everything the publisher needs to turn a committed frame into wire traffic. */
export interface PublisherOptions {
  readonly channel: SemanticChannel;
  readonly registry: SemanticRegistry;
  /** Resolves the renderer's root renderable. */
  readonly resolveRoot: () => RenderableLike | null;
  /** Reads the current terminal size from the renderer. */
  readonly viewport: () => Viewport;
  /** The stream the renderer draws into — the marker goes here. */
  readonly stdout: NodeJS.WriteStream;
  readonly token: string;
  /** Whether the adapter claimed `absolute-bounds` during the handshake. */
  readonly claimsAbsoluteBounds: boolean;
}

/** Drives snapshot publication and marker emission for one renderer. */
export class SemanticPublisher {
  readonly #options: PublisherOptions;
  readonly #collector: SnapshotCollector;
  #revision = 0;
  #queue: Promise<void> = Promise.resolve();
  #latest: SemanticSnapshot | undefined;
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
   * Register a committed frame. Call this from the renderer's `frame` event.
   *
   * The tree is collected synchronously, before the handler returns, because
   * the next frame may start mutating positions as soon as it does.
   */
  notifyFrame(): void {
    if (this.#disposed || !this.#options.channel.isOpen) return;
    this.#revision += 1;
    const revision = this.#revision;

    const root = this.#options.resolveRoot();
    if (root === null) return;

    const { channel, claimsAbsoluteBounds } = this.#options;
    const viewport = this.#options.viewport();
    const snapshot = this.#collector.collect(root, {
      sessionId: channel.session.sessionId,
      revision,
      columns: viewport.columns,
      rows: viewport.rows,
      includeBounds: claimsAbsoluteBounds,
    });
    this.#queue = this.#queue.then(() => this.#publish(revision, snapshot));
    this.#queue.catch(() => this.#fail());
  }

  /** Stop publishing and close the channel. Idempotent. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#latest = undefined;
    this.#options.channel.close();
  }

  async #publish(revision: number, snapshot: SemanticSnapshot): Promise<void> {
    if (this.#disposed || !this.#options.channel.isOpen) return;
    if (revision !== this.#revision) return; // superseded by a newer frame

    const { channel, stdout, token } = this.#options;
    // Retained only once the revision is actually going out, so a `get-tree`
    // can never be answered with a tree the driver was never told about.
    this.#latest = snapshot;
    if (channel.session.subscribe === 'snapshots') channel.sendSnapshot(snapshot);
    channel.sendRevisionCommit(revision);

    if (!channel.session.markerEnabled) return;
    await drain(stdout);
    if (this.#disposed || !channel.isOpen) return;
    if (revision !== this.#revision) return;
    stdout.write(encodeMarker(token, channel.session.sessionId, revision));
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
 * Wait until everything already queued on the stream has been handed to the OS.
 *
 * A zero-length write with a completion callback flushes what is queued and
 * nothing more — which is exactly the guarantee the marker needs, and nothing
 * stronger. It must never trigger a render of its own.
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
