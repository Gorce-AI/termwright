/** Certified Ink render capture to revision-paired semantic snapshots. */

import type { ProbeFrame, ProtocolLimits, SemanticSnapshot } from '@termwright/protocol';
import { writeWindowsConsoleMarker } from '@termwright/pty';
import { recognize } from '@termwright/recognizers';
import type { ProbeChannel } from '@termwright/probe-runtime';
import { observeInkTree, type InkDomElement } from './observe.js';
import type { InkFrameCapture } from './frame-capture.js';
import type { InkTerminalTracker, TerminalPosition } from './terminal-tracker.js';
export { probeInfo } from './probe-info.js';

export interface InkSessionOptions {
  readonly channel: ProbeChannel;
  readonly resolveRoot: () => InkDomElement | null;
  readonly resolveExcluded?: () => InkDomElement | null;
  readonly resolveCapture: (root: InkDomElement) => InkFrameCapture | undefined;
  /** Resolves after Ink has enqueued and flushed every stdout write for the captured render. */
  readonly waitForRenderFlush: () => Promise<void>;
  readonly stdout: NodeJS.WriteStream;
  /** Writes the authenticated marker through the same ordered transport as the frame. */
  readonly writeMarker: (marker: string) => Promise<void>;
  readonly tracker: InkTerminalTracker;
  readonly onGuaranteeViolation?: (error: Error) => void;
}

export interface InkProbeSession {
  readonly revision: number;
  readonly frames: number;
  /** Freeze a renderer commit; refresh-only calls wait when the host tree is ahead of its capture. */
  notifyRender(options?: {
    readonly allowUnsettled?: boolean;
    /** Resolve with the first publication at or causally after this frame. */
    readonly awaitPublication?: boolean;
  }): Promise<number | null>;
  flush(): Promise<void>;
  stop(): void;
}

interface FrozenFrame {
  readonly number: number;
  readonly capture: InkFrameCapture;
  readonly observation: ReturnType<typeof observeInkTree>;
}

export function createInkSession(options: InkSessionOptions): InkProbeSession {
  let revision = 0;
  let frames = 0;
  let latestFrame = 0;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  const publicationWaiters: Array<{
    readonly targetFrame: number;
    readonly resolve: (revision: number) => void;
    readonly reject: (error: Error) => void;
  }> = [];

  const fail = (error: unknown): void => {
    if (stopped) return;
    stopped = true;
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const waiter of publicationWaiters.splice(0)) waiter.reject(failure);
    options.onGuaranteeViolation?.(failure);
    options.channel.close();
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    const failure = new Error('Ink probe stopped');
    for (const waiter of publicationWaiters.splice(0)) waiter.reject(failure);
    // A normal application exit or explicit cleanup is not a semantic
    // guarantee violation. Keep the typed failure callback exclusively for
    // capture/publication/marker faults, while graceful teardown simply
    // closes the producer after rejecting its owned causal waiters.
    options.channel.close();
  };

  const resolvePublications = (frame: number, publishedRevision: number): void => {
    for (let index = publicationWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = publicationWaiters[index];
      if (waiter === undefined || waiter.targetFrame > frame) continue;
      publicationWaiters.splice(index, 1);
      waiter.resolve(publishedRevision);
    }
  };

  const publish = async (frozen: FrozenFrame): Promise<number | null> => {
    await nextMacrotask();
    // A marker authenticates the terminal bytes for this render, so it must
    // follow Ink's own stdout flush boundary, not just the probe's shadow drain.
    await options.waitForRenderFlush();
    await options.tracker.drain();
    if (stopped) return null;
    if (!options.channel.isOpen) {
      fail(new Error('Ink semantic channel closed before publication'));
      return null;
    }
    if (frozen.number !== latestFrame) {
      options.channel.recordCoalescedEvent();
      return null;
    }
    const context = frozen.capture.context;
    if (context === undefined) throw new Error('certified Ink frame context is unavailable');
    if (frozen.capture.screenReader) {
      throw new Error('Ink screen-reader output has no authoritative per-node cell geometry');
    }
    const position = options.tracker.position();
    if ((context.alternateScreen ? 'alternate' : 'normal') !== position.buffer) {
      throw new Error('Ink render mode and committed VT buffer disagree');
    }
    const columns = options.stdout.columns ?? 80;
    const rows = options.stdout.rows ?? 24;
    const qualified = qualifyFrame(frozen, position, columns, rows);
    revision += 1;
    const snapshot: SemanticSnapshot = recognize(qualified, {
      sessionId: options.channel.session.sessionId,
      revision,
      columns,
      rows,
      framework: 'ink',
      paintOrderKnown: false,
      maxStringBytes: options.channel.session.limits.maxStringBytes,
    });
    const marker = options.channel.publish(snapshot, {
      probeEvents: qualified.objects.length + (qualified.operations?.length ?? 0),
    });
    if (marker === undefined) throw new Error('Ink semantic publication was refused');
    // There must be no async gap between the final frame check and enqueueing
    // its marker: a newer Ink render could otherwise write in between them.
    // The selected transport establishes FRAME -> MARKER; awaiting it makes
    // `flush()` an actual publication boundary for teardown.
    await options.writeMarker(marker);
    resolvePublications(frozen.number, revision);
    return revision;
  };

  return {
    get revision() {
      return revision;
    },
    get frames() {
      return frames;
    },
    notifyRender(notifyOptions = {}) {
      if (stopped) return Promise.resolve(null);
      try {
        const root = options.resolveRoot();
        if (root === null) throw new Error('Ink committed frame has no retained root');
        const capture = options.resolveCapture(root);
        if (capture === undefined || capture.root !== root) {
          throw new Error('Ink committed frame has no matching certified renderer capture');
        }
        const excluded = options.resolveExcluded?.();
        const observation = observeInkTree(root, {
          frame: frames,
          limits: options.channel.session.limits as ProtocolLimits,
          ...(excluded === undefined ? {} : { excluded }),
          ...(capture.staticRoots.length === 0 ? {} : { retainedRoots: capture.staticRoots }),
          ...(capture.staticChildren.size === 0
            ? {}
            : { retainedChildren: capture.staticChildren }),
          geometry: capture.geometry,
        });
        // Layout effects can register annotations after React mutates the host
        // tree but before Ink's throttled renderer has produced the matching
        // capture. That is a transient refresh state, not a committed frame
        // whose guaranteed geometry may be downgraded. The subsequent real
        // onRender call freezes it. Renderer-originated calls remain strict.
        if (hasDisplayedNodeWithoutGeometry(observation.frame)) {
          if (notifyOptions.allowUnsettled === true) return Promise.resolve(null);
          throw new Error(
            'certified Ink renderer capture is missing geometry for a displayed host node',
          );
        }
        frames += 1;
        latestFrame = frames;
        const frozen = { number: frames, capture, observation };
        const boundary =
          notifyOptions.awaitPublication === true
            ? new Promise<number>((resolve, reject) => {
                publicationWaiters.push({ targetFrame: frozen.number, resolve, reject });
              })
            : null;
        const publication = queue
          .then(() => publish(frozen))
          .catch((error) => {
            fail(error);
            return null;
          });
        queue = publication.then(() => undefined);
        return boundary ?? publication;
      } catch (error) {
        fail(error);
        return Promise.resolve(null);
      }
    },
    async flush() {
      await queue.catch(() => undefined);
    },
    stop,
  };
}

function hasDisplayedNodeWithoutGeometry(frame: ProbeFrame): boolean {
  return frame.objects.some(
    (object) => object.state?.displayed !== false && object.geometry?.intendedRect === undefined,
  );
}

function qualifyFrame(
  frozen: FrozenFrame,
  position: TerminalPosition,
  columns: number,
  rows: number,
): ProbeFrame {
  const { capture, observation } = frozen;
  const context = capture.context as NonNullable<InkFrameCapture['context']>;
  const fullscreen = context.stdoutIsTTY && capture.liveRows >= context.rows;
  const liveOrigin = context.alternateScreen
    ? 0
    : !context.interactive
      ? position.row
      : context.debug || fullscreen
        ? position.row - Math.max(0, capture.liveRows - 1)
        : position.row - capture.liveRows;
  const staticOrigin = liveOrigin - capture.staticRows;

  return {
    ...observation.frame,
    objects: observation.frame.objects.map((object) => {
      const region = observation.geometryRegions.get(object.identity.value);
      const geometry = object.geometry;
      if (
        geometry?.intendedRect === undefined ||
        geometry.visibleRect === undefined ||
        region === undefined
      )
        return object;
      const origin = region === 'live' ? liveOrigin : staticOrigin;
      const intendedRect = shift(geometry.intendedRect, origin);
      const visibleRect =
        context.interactive || region === 'static' || context.debug
          ? viewportIntersection(shift(geometry.visibleRect, origin), columns, rows)
          : { row: Math.min(Math.max(origin, 0), rows), column: 0, width: 0, height: 0 };
      return { ...object, geometry: { intendedRect, visibleRect } };
    }),
  };
}

function shift(
  rect: import('@termwright/protocol').ProbeRect,
  rows: number,
): import('@termwright/protocol').ProbeRect {
  return { ...rect, row: rect.row + rows };
}

function viewportIntersection(
  rect: import('@termwright/protocol').ProbeRect,
  columns: number,
  rows: number,
): import('@termwright/protocol').ProbeRect {
  const column = Math.max(0, rect.column);
  const row = Math.max(0, rect.row);
  const right = Math.max(column, Math.min(columns, rect.column + rect.width));
  const bottom = Math.max(row, Math.min(rows, rect.row + rect.height));
  return { row, column, width: right - column, height: bottom - row };
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function createInkMarkerWriter(
  stream: NodeJS.WriteStream,
  options: {
    readonly certifiedHarness: boolean;
    readonly platform?: NodeJS.Platform;
    readonly writeWindowsMarker?: (fd: number, marker: string) => void;
  },
): (marker: string) => Promise<void> {
  const platform = options.platform ?? process.platform;
  if (!options.certifiedHarness && platform === 'win32' && stream.isTTY === true) {
    const fd = (stream as NodeJS.WriteStream & { readonly fd?: unknown }).fd;
    if (typeof fd !== 'number' || !Number.isInteger(fd) || fd < 0) {
      return () =>
        Promise.reject(new Error('Ink stdout has no certifiable Windows console handle'));
    }
    const writeNative = options.writeWindowsMarker ?? writeWindowsConsoleMarker;
    return (marker) => {
      try {
        writeNative(fd, marker);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
  }
  return (marker) =>
    new Promise((resolve, reject) => {
      if (stream.writableEnded || stream.destroyed) {
        reject(new Error('Ink stdout closed before the semantic render marker could be written'));
        return;
      }
      try {
        stream.write(marker, (error?: Error | null) => {
          if (error instanceof Error) reject(error);
          else resolve();
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
}
