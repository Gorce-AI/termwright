/** Certified Ink render capture to revision-paired semantic snapshots. */

import type { ProbeFrame, ProbeInfo, ProtocolLimits, SemanticSnapshot } from '@termwright/protocol';
import { recognize } from '@termwright/recognizers';
import type { ProbeChannel } from '@termwright/probe-runtime';
import { observeInkTree, type InkDomElement } from './observe.js';
import type { InkFrameCapture } from './frame-capture.js';
import type { InkTerminalTracker, TerminalPosition } from './terminal-tracker.js';
import { instrumentationSentinel, INK_VERSION } from './instrumentation.js';
import { PACKAGE_VERSION } from './version.js';

export function probeInfo(frameworkVersion = instrumentationSentinel()?.frameworkVersion ?? INK_VERSION): ProbeInfo {
  return {
    framework: 'ink',
    frameworkVersion,
    probeVersion: PACKAGE_VERSION,
    identityKind: 'stable',
    capabilities: ['stable-identity', 'intended-rect', 'visible-rect', 'annotations'],
  };
}

export interface InkSessionOptions {
  readonly channel: ProbeChannel;
  readonly resolveRoot: () => InkDomElement | null;
  readonly resolveExcluded?: () => InkDomElement | null;
  readonly resolveCapture: (root: InkDomElement) => InkFrameCapture | undefined;
  readonly stdout: NodeJS.WriteStream;
  readonly tracker: InkTerminalTracker;
  readonly onGuaranteeViolation?: (error: Error) => void;
}

export interface InkProbeSession {
  readonly revision: number;
  readonly frames: number;
  notifyRender(): void;
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

  const fail = (error: unknown): void => {
    if (stopped) return;
    stopped = true;
    options.onGuaranteeViolation?.(error instanceof Error ? error : new Error(String(error)));
    options.channel.close();
  };

  const publish = async (frozen: FrozenFrame): Promise<void> => {
    await nextMacrotask();
    await options.tracker.drain();
    if (stopped || !options.channel.isOpen) return;
    if (frozen.number !== latestFrame) {
      options.channel.recordCoalescedEvent();
      return;
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
    if (marker === undefined) return;
    await drain(options.stdout);
    if (stopped || frozen.number !== latestFrame) return;
    options.stdout.write(marker);
  };

  return {
    get revision() { return revision; },
    get frames() { return frames; },
    notifyRender() {
      if (stopped) return;
      frames += 1;
      latestFrame = frames;
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
          ...(capture.staticChildren.size === 0 ? {} : { retainedChildren: capture.staticChildren }),
          geometry: capture.geometry,
        });
        const frozen = { number: frames, capture, observation };
        queue = queue.then(() => publish(frozen)).catch(fail);
      } catch (error) {
        fail(error);
      }
    },
    async flush() { await queue.catch(() => undefined); },
    stop() { fail(new Error('Ink probe stopped')); },
  };
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
        geometry?.intendedRect === undefined
        || geometry.visibleRect === undefined
        || region === undefined
      ) return object;
      const origin = region === 'live' ? liveOrigin : staticOrigin;
      const intendedRect = shift(geometry.intendedRect, origin);
      const visibleRect = context.interactive || region === 'static' || context.debug
        ? viewportIntersection(shift(geometry.visibleRect, origin), columns, rows)
        : { row: Math.min(Math.max(origin, 0), rows), column: 0, width: 0, height: 0 };
      return { ...object, geometry: { intendedRect, visibleRect } };
    }),
  };
}

function shift(rect: import('@termwright/protocol').ProbeRect, rows: number): import('@termwright/protocol').ProbeRect {
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

function drain(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.writableEnded || stream.destroyed) return resolve();
    try { stream.write('', () => resolve()); } catch { resolve(); }
  });
}
