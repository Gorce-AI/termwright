/** A committed Ink host tree to snapshot/commit/marker publication. */

import type { ProbeInfo, ProtocolLimits, SemanticSnapshot } from '@termwright/protocol';
import { recognize } from '@termwright/recognizers';
import type { ProbeChannel } from '@termwright/probe-runtime';
import {
  hasStaticContent,
  observeInkTree,
  type InkDomElement,
  type MeasureElement,
} from './observe.js';
import { PACKAGE_VERSION } from './version.js';

/** What this probe truthfully offers at handshake time. */
export function probeInfo(): ProbeInfo {
  return {
    framework: 'ink',
    probeVersion: PACKAGE_VERSION,
    identityKind: 'stable',
    // The optional @termwright/ink SDK writes author intent to the shared weak
    // registry. Ink's own aria metadata travels separately as framework facts.
    capabilities: ['stable-identity', 'annotations'],
  };
}

export interface InkSessionOptions {
  readonly channel: ProbeChannel;
  readonly resolveRoot: () => InkDomElement | null;
  readonly resolveExcluded?: () => InkDomElement | null;
  readonly measureElement: MeasureElement;
  readonly stdout: NodeJS.WriteStream;
  readonly includeGeometry: boolean;
}

export interface InkProbeSession {
  readonly revision: number;
  readonly frames: number;
  notifyRender(): void;
  /** Settle all captures queued at the time of the call. Never rejects. */
  flush(): Promise<void>;
  stop(): void;
}

/**
 * Pair each observed commit with its output bytes.
 *
 * Ink invokes `onRender` after layout and before writing. The tree is frozen
 * synchronously in that callback; deferring observation would let a microtask
 * or a throttled commit mutate the host objects before they were read. Only
 * marker placement is deferred: after Ink returns and writes, stdout is
 * drained and the authenticated marker is appended.
 */
export function createInkSession(options: InkSessionOptions): InkProbeSession {
  let revision = 0;
  let frames = 0;
  let latestFrame = 0;
  let staticSeen = false;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  const fail = (): void => {
    if (stopped) return;
    stopped = true;
    options.channel.close();
  };

  const writeMarker = async (frame: number, marker: string): Promise<void> => {
    await nextMacrotask();
    if (stopped || !options.channel.isOpen) return;
    if (frame !== latestFrame) {
      options.channel.recordCoalescedEvent();
      return;
    }
    await drain(options.stdout);
    // A newer render may have written while this drain was pending. Marker N
    // after frame N+1 bytes is actively misleading, so drop it and let the
    // newer full snapshot establish the next pairing.
    if (stopped || !options.channel.isOpen) return;
    if (frame !== latestFrame) {
      options.channel.recordCoalescedEvent();
      return;
    }
    options.stdout.write(marker);
  };

  return {
    get revision() {
      return revision;
    },
    get frames() {
      return frames;
    },
    notifyRender() {
      if (stopped) return;
      frames += 1;
      const frame = frames;
      // Even an unobservable/failed frame supersedes a queued old marker.
      latestFrame = frame;

      try {
        const root = options.resolveRoot();
        if (root === null) return;
        // Static output scrolls the live region down. Removing <Static> later
        // does not erase bytes already written above it, so loss of absolute
        // coordinates is sticky for this session.
        staticSeen ||= hasStaticContent(root);
        const includeGeometry = options.includeGeometry && !staticSeen;
        const excluded = options.resolveExcluded?.();
        const observation = observeInkTree(root, {
          frame,
          limits: options.channel.session.limits as ProtocolLimits,
          ...(excluded === undefined ? {} : { excluded }),
          measureElement: options.measureElement,
          includeGeometry,
        });

        revision += 1;
        const snapshot: SemanticSnapshot = recognize(observation.frame, {
          sessionId: options.channel.session.sessionId,
          revision,
          columns: options.stdout.columns ?? 80,
          rows: options.stdout.rows ?? 24,
          framework: 'ink',
          paintOrderKnown: false,
          maxStringBytes: options.channel.session.limits.maxStringBytes,
          qualified: options.channel.session.protocol === 'termwright/2',
        });
        const marker = options.channel.publish(snapshot, {
          probeEvents: observation.frame.objects.length + (observation.frame.operations?.length ?? 0),
        });
        if (marker === undefined) return;
        queue = queue.then(() => writeMarker(frame, marker)).catch(fail);
      } catch {
        fail();
      }
    },
    async flush() {
      await queue.catch(() => undefined);
    },
    stop() {
      fail();
    },
  };
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function drain(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.writableEnded || stream.destroyed) {
      resolve();
      return;
    }
    try {
      stream.write('', () => resolve());
    } catch {
      resolve();
    }
  });
}
