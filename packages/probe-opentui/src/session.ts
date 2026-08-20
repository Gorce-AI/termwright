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

import {
  DEFAULT_LIMITS,
  type ProbeInfo,
  type ProtocolLimits,
  type SemanticSnapshot,
} from '@termwright/protocol';
import { recognize } from '@termwright/recognizers';
import { observeTree, type ObservableNode } from './observe.js';
import type { MarkerSink } from './sink.js';
import { PACKAGE_VERSION } from './version.js';

/** The renderer surface the session uses. Structural, so tests need no framework. */
export interface ObservableRenderer {
  readonly root: ObservableNode;
  on(event: string, handler: () => void): void;
  readonly width?: number;
  readonly height?: number;
  hitTest?(x: number, y: number): number;
}

/** Where a finished snapshot goes. */
export interface Publisher {
  readonly protocol?: 'termwright/1' | 'termwright/2';
  /** Send the tree for a revision. Returns the marker to write, if any. */
  publish(snapshot: SemanticSnapshot, metrics?: { readonly probeEvents: number }): string | undefined;
}

/** Settings for {@link startSession}. */
export interface SessionOptions {
  readonly renderer: ObservableRenderer;
  readonly publisher: Publisher;
  readonly sink?: MarkerSink;
  /**
   * The driver's session id, or a function returning it.
   *
   * A function matters: the renderer can exist before the handshake finishes,
   * and a session that captured the id at construction would stamp every later
   * snapshot with a placeholder.
   */
  readonly sessionId: string | (() => string);
  /** Terminal size, when the renderer does not report it. */
  readonly columns?: number;
  readonly rows?: number;
  /** Negotiated limits, resolved lazily when the handshake finishes late. */
  readonly limits?: ProtocolLimits | (() => ProtocolLimits);
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
    probeVersion: PACKAGE_VERSION,
    // `num` is a readonly monotonic counter that survives re-render and even
    // removal from the tree, so correlating identities across frames is sound.
    identityKind: 'stable',
    // `paint-order` earns occlusion reasoning, which is what lets a driver
    // gate a click on "is my target the thing at this cell". OpenTUI exposes a
    // z-order child list and builds its hit grid from the same coordinates, so
    // the probe can generally report it — and omits it per object on any tree
    // where the list turned out to be unreadable, rather than passing off
    // document order as paint order.
    // The optional @termwright/opentui SDK publishes developer intent through
    // a Symbol.for + WeakMap channel consumed by every observation.
    capabilities: ['stable-identity', 'paint-order', 'annotations'],
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
  const { renderer, publisher, sink } = options;
  const sessionIdOf = (): string =>
    typeof options.sessionId === 'function' ? options.sessionId() : options.sessionId;
  const limitsOf = (): ProtocolLimits =>
    typeof options.limits === 'function'
      ? options.limits()
      : options.limits ?? DEFAULT_LIMITS;
  let revision = 0;
  let frames = 0;
  let stopped = false;

  const capture = (): void => {
    if (stopped) return;
    frames += 1;

    let snapshot: SemanticSnapshot;
    let marker: string | undefined;
    try {
      const limits = limitsOf();
      const observation = observeTree(renderer.root, { frame: frames, limits });
      revision += 1;
      snapshot = recognize(observation.frame, {
        sessionId: sessionIdOf(),
        revision,
        columns: options.columns ?? renderer.width ?? 80,
        rows: options.rows ?? renderer.height ?? 24,
        framework: 'opentui',
        paintOrderKnown: observation.paintOrderKnown,
        maxStringBytes: limits.maxStringBytes,
      });
      if (publisher.protocol === 'termwright/2') {
        snapshot = qualifySnapshot(snapshot, observation.frame, renderer);
      }
      marker = publisher.publish(snapshot, {
        probeEvents: observation.frame.objects.length + (observation.frame.operations?.length ?? 0),
      });
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

function qualifySnapshot(
  legacy: SemanticSnapshot,
  frame: import('@termwright/protocol').ProbeFrame,
  renderer: ObservableRenderer,
): SemanticSnapshot {
  const byIdentity = new Map(frame.objects.map((object) => [object.identity.value, object]));
  const nodes = legacy.nodes.map((node) => {
    const identity = node.id.startsWith('n') ? node.id.slice(1) : '';
    const object = byIdentity.get(identity);
    const displayed = object?.state?.displayed;
    const intended = object?.geometry?.intendedRect;
    const { bounds: _bounds, occlusion: _occlusion, ...semantic } = node;
    return {
      ...semantic,
      geometry: {
        displayed: typeof displayed === 'boolean'
          ? { status: 'known' as const, value: displayed, evidence: 'probe' as const }
          : { status: 'unknown' as const, reason: 'not-reported' as const },
        intendedRect: intended !== undefined
          ? { status: 'known' as const, value: intended, evidence: 'probe' as const }
          : { status: 'absent' as const, reason: 'not-laid-out' as const },
        visibleRect: { status: 'unsupported' as const, capability: 'visible-rect', reason: 'framework-unobservable' as const },
      },
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  let hitGrid: SemanticSnapshot['hitGrid'] = {
    status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable',
  };
  if (typeof renderer.hitTest === 'function') {
    const regions: { rect: { row: number; column: number; width: number; height: number }; recipientId: string }[] = [];
    let complete = true;
    try {
      for (let row = 0; row < legacy.rows && complete; row += 1) {
        let owner: string | null = null;
        let start = 0;
        for (let column = 0; column <= legacy.columns; column += 1) {
          const hit = column < legacy.columns ? renderer.hitTest(column, row) : 0;
          const next = hit === 0 ? null : `n${hit}`;
          if (next !== null && !ids.has(next)) { complete = false; break; }
          if (next === owner) continue;
          if (owner !== null) regions.push({ rect: { row, column: start, width: column - start, height: 1 }, recipientId: owner });
          owner = next;
          start = column;
        }
      }
      hitGrid = complete
        ? { status: 'known', value: { regions }, evidence: 'hit-grid' }
        : { status: 'unknown', reason: 'temporary' };
    } catch {
      hitGrid = { status: 'unknown', reason: 'temporary' };
    }
  }
  return {
    ...legacy,
    v: 2,
    nodes,
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: 'probe' },
    hitGrid,
  };
}
