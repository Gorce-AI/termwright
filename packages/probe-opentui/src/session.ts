/**
 * The probe session: what happens between a renderer being created and a
 * snapshot reaching the driver.
 *
 * The order is the whole contract, and it is the same one the Ink adapter
 * proved: publish the tree, then commit the revision, then write the marker —
 * after the frame's bytes have gone out. Under OpenTUI "after the bytes" is
 * only knowable because the sink put them in JS first.
 *
 * Publication is injected rather than built here. The session does not know
 * whether it is talking to a socket or a test double, which is what lets the
 * whole cycle be exercised without a driver, and what will let the transport be
 * extracted once a second TypeScript probe needs it.
 */

import type { ProbeInfo, SemanticSnapshot } from '@termwright/protocol';
import { recognize } from '@termwright/recognizers';
import { observeTree, type ObservableNode } from './observe.js';
import type { MarkerSink } from './sink.js';

/** The renderer surface the session uses. Structural, so tests need no framework. */
export interface ObservableRenderer {
  readonly root: ObservableNode;
  on(event: string, handler: () => void): void;
  readonly width?: number;
  readonly height?: number;
}

/** Where a finished snapshot goes. */
export interface Publisher {
  /** Send the tree for a revision. Returns the marker to write, if any. */
  publish(snapshot: SemanticSnapshot): string | undefined;
}

/** Settings for {@link startSession}. */
export interface SessionOptions {
  readonly renderer: ObservableRenderer;
  readonly publisher: Publisher;
  readonly sink?: MarkerSink;
  readonly sessionId: string;
  /** Terminal size, when the renderer does not report it. */
  readonly columns?: number;
  readonly rows?: number;
}

/** A running session. */
export interface ProbeSession {
  /** Revisions published so far. */
  readonly revision: number;
  /** Frames seen, including any that produced no publication. */
  readonly frames: number;
  /** Observe and publish now, outside the frame loop. */
  capture(): void;
  stop(): void;
}

/** What this probe tells the driver about itself at handshake time. */
export function probeInfo(frameworkVersion?: string): ProbeInfo {
  return {
    framework: 'opentui',
    ...(frameworkVersion === undefined ? {} : { frameworkVersion }),
    probeVersion: '0.1.0',
    // `num` is a readonly monotonic counter that survives re-render and even
    // removal from the tree, so correlating identities across frames is sound.
    identityKind: 'stable',
    capabilities: ['stable-identity', 'annotations'],
  };
}

/**
 * Attach to a renderer and publish a tree per frame.
 *
 * `frame` is the only event OpenTUI offers, and it is emitted **only when
 * something is listening** — subscribing before the loop starts is not an
 * optimisation, it is the difference between receiving frames and receiving
 * none.
 */
export function startSession(options: SessionOptions): ProbeSession {
  const { renderer, publisher, sink, sessionId } = options;
  let revision = 0;
  let frames = 0;
  let stopped = false;

  const capture = (): void => {
    if (stopped) return;
    frames += 1;

    let snapshot: SemanticSnapshot;
    let marker: string | undefined;
    try {
      const observation = observeTree(renderer.root, { frame: frames });
      revision += 1;
      snapshot = recognize(observation.frame, {
        sessionId,
        revision,
        columns: options.columns ?? renderer.width ?? 80,
        rows: options.rows ?? renderer.height ?? 24,
        framework: 'opentui',
        paintOrderKnown: observation.paintOrderKnown,
      });
      marker = publisher.publish(snapshot);
    } catch {
      // Observation must never take the application down. A failed frame is a
      // frame the driver does not hear about, which the protocol already
      // tolerates — revisions are strictly increasing, not contiguous.
      return;
    }

    // Last, and only here: the bytes for this frame have already been forwarded
    // by the sink, so the marker lands after them.
    if (marker !== undefined) sink?.writeMarker(marker);
  };

  renderer.on('frame', capture);

  return {
    get revision() {
      return revision;
    },
    get frames() {
      return frames;
    },
    capture,
    stop() {
      stopped = true;
    },
  };
}
