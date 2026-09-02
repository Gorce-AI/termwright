/**
 * The probe session: what happens between a renderer being created and a
 * snapshot reaching the driver.
 *
 * The order is the whole contract: publish the tree, then commit the revision,
 * then cross the renderer's native-output barrier and write the marker.
 *
 * Publication is injected rather than built here. The session does not know
 * whether it is talking to a socket or a test double, which is what lets the
 * whole cycle be exercised without a driver, and what will let the transport be
 * extracted once a second TypeScript probe needs it.
 */

import {
  DEFAULT_LIMITS,
  evidence,
  type ProbeInfo,
  type ProtocolLimits,
  type SemanticSnapshot,
} from '@termwright/protocol';
import { recognize } from '@termwright/recognizers';
import { observeTree, type ObservableNode } from './observe.js';
import type { MarkerSink } from './sink.js';
import { PACKAGE_VERSION } from './version.js';
import type { CommittedFrameGeometry, FrameGeometryProvider } from './geometry.js';

/** The renderer surface the session uses. Structural, so tests need no framework. */
export interface ObservableRenderer {
  readonly root: ObservableNode;
  on(event: string, handler: (event?: { readonly frameId?: number }) => void): void;
  off(event: string, handler: (event?: { readonly frameId?: number }) => void): void;
  readonly width?: number;
  readonly height?: number;
  readonly terminalWidth?: number;
  readonly terminalHeight?: number;
  readonly frameId?: number;
  hitTest?(x: number, y: number): number;
}

/** Where a finished snapshot goes. */
export interface Publisher {
  /** Send the tree for a revision. Returns the marker to write, if any. */
  publish(
    snapshot: SemanticSnapshot,
    metrics?: { readonly probeEvents: number },
  ): string | undefined;
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
  /** Called once when a negotiated authoritative observation cannot be supplied. */
  readonly onGuaranteeViolation?: (error: Error) => void;
  /** The sole production geometry authority: the same-pass runtime observer. */
  readonly authoritativeProvider: FrameGeometryProvider;
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
    // the certified probe guarantees it. If an exact-version invariant breaks,
    // the session emits adapter-guarantee-violation instead of making the
    // capability structural or passing off document order as paint order.
    // The optional @termwright/opentui SDK publishes developer intent through
    // a Symbol.for + WeakMap channel consumed by every observation.
    capabilities: [
      'stable-identity',
      'intended-rect',
      'visible-rect',
      'paint-order',
      'annotations',
    ],
    instrumentation: {
      highestTier: 'T3',
      semanticClass: 'A',
      degradedCapabilities: [],
    },
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
    typeof options.limits === 'function' ? options.limits() : (options.limits ?? DEFAULT_LIMITS);
  let revision = 0;
  let frames = 0;
  let stopped = false;
  let listenerAttached = false;
  let releaseSinkFailure = (): void => undefined;

  const halt = (): void => {
    if (listenerAttached) {
      try {
        renderer.off('frame', frameListener);
      } catch {
        /* do not turn teardown into an app failure */
      }
      listenerAttached = false;
    }
    releaseSinkFailure();
    releaseSinkFailure = () => undefined;
    stopped = true;
  };

  const failGuarantee = (error: unknown): void => {
    if (stopped) return;
    halt();
    options.onGuaranteeViolation?.(error instanceof Error ? error : new Error(String(error)));
  };

  const captureCommitted = (requestedFrameId?: number): void => {
    if (stopped) return;
    frames += 1;

    let snapshot: SemanticSnapshot;
    let marker: string | undefined;
    try {
      const provider = options.authoritativeProvider;
      const frameId = requestedFrameId ?? renderer.frameId;
      if (frameId === undefined) {
        throw new Error('certified OpenTUI frame geometry provider is unavailable');
      }
      const geometry = provider.getCommitted(frameId);
      if (geometry === undefined) {
        throw new Error(`OpenTUI frame ${frameId} has no committed geometry observation`);
      }
      const limits = limitsOf();
      const observation = observeTree(renderer.root, { frame: frames, limits });
      if (!observation.paintOrderKnown) {
        throw new Error(
          'certified OpenTUI adapter lost authoritative render order for a committed frame',
        );
      }
      const qualifiedFrame = qualifyFrame(observation.frame, geometry);
      revision += 1;
      snapshot = recognize(qualifiedFrame, {
        sessionId: sessionIdOf(),
        revision,
        columns: options.columns ?? geometry.columns,
        rows: options.rows ?? geometry.rows,
        framework: 'opentui',
        paintOrderKnown: observation.paintOrderKnown,
        maxStringBytes: limits.maxStringBytes,
      });
      snapshot = qualifySnapshot(snapshot, qualifiedFrame, renderer, geometry);
      marker = publisher.publish(snapshot, {
        probeEvents: observation.frame.objects.length + (observation.frame.operations?.length ?? 0),
      });
    } catch (error) {
      // Observation must never take the application down. It does, however,
      // terminate this adapter: continuing after losing an authoritative frame
      // would turn a negotiated guarantee into best effort.
      halt();
      options.onGuaranteeViolation?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    // Last, and only here: the native feed has delivered this frame into the
    // sink's ordered queue, so the marker cannot overtake it.
    if (marker !== undefined) {
      try {
        if (sink === undefined) throw new Error('OpenTUI commit marker has no same-writer sink');
        sink.writeMarker(marker);
      } catch (error) {
        failGuarantee(error);
      }
    }
  };

  const frameListener = (event?: { readonly frameId?: number }): void =>
    captureCommitted(event?.frameId);
  renderer.on('frame', frameListener);
  listenerAttached = true;
  if (sink !== undefined) {
    const release = sink.onFailure(failGuarantee);
    if (stopped) release();
    else releaseSinkFailure = release;
  }
  return {
    get revision() {
      return revision;
    },
    get frames() {
      return frames;
    },
    capture: () => captureCommitted(),
    stop() {
      halt();
    },
  };
}

export function qualifyFrame(
  frame: import('@termwright/protocol').ProbeFrame,
  geometry: CommittedFrameGeometry,
): import('@termwright/protocol').ProbeFrame {
  return {
    ...frame,
    objects: frame.objects.map((object) => {
      const intendedRect = geometry.intended.get(object.identity.value);
      const visibleRect = geometry.visible.get(object.identity.value);
      const displayed = object.state?.displayed;
      if (displayed !== false && (intendedRect === undefined || visibleRect === undefined)) {
        throw new Error(
          `OpenTUI frame ${geometry.frameId} omitted geometry for displayed object ${object.identity.value}`,
        );
      }
      const unobservable = object.unobservable?.filter(
        (field) => field !== 'intendedRect' && field !== 'visibleRect',
      );
      return {
        ...object,
        ...(displayed === false
          ? {}
          : { geometry: { intendedRect: intendedRect!, visibleRect: visibleRect! } }),
        ...(unobservable === undefined ? {} : { unobservable }),
      };
    }),
  };
}

function qualifySnapshot(
  base: SemanticSnapshot,
  frame: import('@termwright/protocol').ProbeFrame,
  renderer: ObservableRenderer,
  committed: CommittedFrameGeometry,
): SemanticSnapshot {
  const byIdentity = new Map(frame.objects.map((object) => [object.identity.value, object]));
  const nodes = base.nodes.map((node) => {
    const identity = node.id.startsWith('n') ? node.id.slice(1) : '';
    const object = byIdentity.get(identity);
    const displayed = object?.state?.displayed;
    const intended = object?.geometry?.intendedRect;
    const visible = object?.geometry?.visibleRect;
    const geometryEvidence = () => ({
      ...evidence('framework', 'instrumented', 'authoritative', 'opentui'),
      strength: 'authoritative' as const,
    });
    if (object === undefined || typeof displayed !== 'boolean') {
      throw new Error(
        `certified OpenTUI runtime observation omitted display evidence for ${node.id}`,
      );
    }
    return {
      ...node,
      geometry: {
        displayed: { status: 'known' as const, value: displayed, evidence: geometryEvidence() },
        intendedRect:
          intended !== undefined
            ? { status: 'known' as const, value: intended, evidence: geometryEvidence() }
            : {
                status: 'absent' as const,
                reason: 'not-laid-out' as const,
                evidence: geometryEvidence(),
              },
        visibleRect:
          displayed === false
            ? {
                status: 'absent' as const,
                reason: 'not-displayed' as const,
                evidence: geometryEvidence(),
              }
            : visible !== undefined
              ? { status: 'known' as const, value: visible, evidence: geometryEvidence() }
              : {
                  status: 'absent' as const,
                  reason: 'not-laid-out' as const,
                  evidence: geometryEvidence(),
                },
      },
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  if (typeof renderer.hitTest !== 'function') {
    throw new Error('certified OpenTUI renderer does not expose native hitTest');
  }
  const regions: {
    rect: { row: number; column: number; width: number; height: number };
    recipientId: string;
  }[] = [];
  for (let row = 0; row < base.rows; row += 1) {
    let owner: string | null = null;
    let start = 0;
    for (let column = 0; column <= base.columns; column += 1) {
      const surfaceColumn = column - committed.surfaceOrigin.column;
      const surfaceRow = row - committed.surfaceOrigin.row;
      const onSurface =
        surfaceColumn >= 0 &&
        surfaceColumn < committed.surfaceColumns &&
        surfaceRow >= 0 &&
        surfaceRow < committed.surfaceRows;
      const hit =
        column < base.columns && onSurface ? renderer.hitTest(surfaceColumn, surfaceRow) : 0;
      const next = hit === 0 ? null : `n${hit}`;
      if (next !== null && !ids.has(next)) {
        throw new Error(`native OpenTUI hit grid returned unknown renderable ${hit}`);
      }
      if (next === owner) continue;
      if (owner !== null)
        regions.push({
          rect: { row, column: start, width: column - start, height: 1 },
          recipientId: owner,
        });
      owner = next;
      start = column;
    }
  }
  const hitGrid: SemanticSnapshot['hitGrid'] = {
    status: 'known',
    value: { regions },
    evidence: evidence('framework', 'native', 'authoritative', 'opentui'),
  };
  return {
    ...base,
    v: 3,
    nodes,
    coordinateSpace: {
      status: 'known',
      value: 'viewport-cells',
      evidence: evidence('framework', 'instrumented', 'authoritative', 'opentui'),
    },
    hitGrid,
  };
}
