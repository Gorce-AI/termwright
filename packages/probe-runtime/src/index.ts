/**
 * Shared process-to-driver transport for zero-config JavaScript probes.
 *
 * Framework probes deliberately keep observation and marker placement in
 * their own packages. This module owns only the framework-neutral handshake,
 * full-snapshot publication and fail-closed socket lifecycle.
 */

import { createConnection, type Socket } from 'node:net';
import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  freezeEvidenceProviders,
  type EvidenceProviderRegistry,
  type FrozenEvidenceProviderRegistry,
} from '@termwright/evidence-provider';
import {
  createFrameDecoder,
  diffSemanticSnapshots,
  encodeFrame,
  encodeMarker,
  parseDriverMessage,
  DEFAULT_LIMITS,
  PROTOCOL_ID,
  type ProtocolId,
  type AdapterCapability,
  type AdapterToDriverMessage,
  type FrameDecoder,
  type ProbeInfo,
  type ProtocolLimits,
  type SemanticSnapshot,
} from '@termwright/protocol';

/** What the driver decided for this session. */
export interface ChannelSession {
  readonly protocol: ProtocolId;
  readonly sessionId: string;
  readonly limits: ProtocolLimits;
  readonly markerEnabled: boolean;
}

/** Connection parameters. */
export interface ConnectOptions {
  readonly endpoint: string;
  readonly token: string;
  readonly probe: ProbeInfo;
  readonly capabilities: readonly AdapterCapability[];
  readonly adapterName: string;
  readonly adapterVersion: string;
  /** Isolated application provider registry. Defaults to the process facade. */
  readonly evidenceProviderRegistry?: EvidenceProviderRegistry;
  /** Milliseconds for connect plus handshake. Default 1000. */
  readonly handshakeTimeoutMs?: number;
  /**
   * Collect per-publication counters and timings.
   *
   * Defaults on when `TERMWRIGHT_DEBUG` enables driver diagnostics or an
   * adapter debug file is configured. Explicit false keeps even the timer off.
   */
  readonly performanceMetrics?: boolean;
  /**
   * Append machine-readable performance snapshots here. Defaults to
   * `TERMWRIGHT_DEBUG_FILE`; write failures never affect the application.
   */
  readonly performanceMetricsFile?: string;
}

/** Debug-only facts the shared transport can observe without guessing. */
export interface ProbePerformanceMetrics {
  readonly enabled: boolean;
  readonly fullSnapshots: number;
  readonly deltas: number;
  readonly semanticBytes: number;
  readonly semanticNodes: number;
  readonly unknownFrameworkNodes: number;
  readonly droppedEvents: number;
  readonly markerRequests: number;
  readonly serializationMicroseconds: number;
  readonly averageBytesPerFrame: number | null;
  readonly averageSemanticNodesPerFrame: number | null;
  readonly averageUnknownFrameworkNodesPerFrame: number | null;
  readonly averageSerializationMicrosecondsPerFrame: number | null;
  /** Present when the framework session supplies its pre-normalized fact count. */
  readonly probeEventsPerFrame: number | null;
  /** Superseded publications reported by a framework-owned marker queue. */
  readonly coalescedEvents: number;
  /** Only the framework-specific sink knows whether a returned marker drained. */
  readonly renderCorrelationRate: null;
  /** Normalization currently happens before the shared transport is called. */
  readonly parentNormalizationMicrosecondsPerFrame: null;
}

interface MutableProbePerformanceMetrics {
  fullSnapshots: number;
  deltas: number;
  semanticBytes: number;
  semanticNodes: number;
  unknownFrameworkNodes: number;
  droppedEvents: number;
  markerRequests: number;
  serializationMicroseconds: number;
  probeEvents: number;
  framesWithProbeEvents: number;
  coalescedEvents: number;
}

export interface ProbePublicationMetrics {
  /** Probe IR objects plus render/layout operations observed for this frame. */
  readonly probeEvents?: number;
}

/** One JSONL record written by an injected probe in debug-file mode. */
export interface ProbePerformanceRecord {
  readonly kind: 'termwright-probe-performance';
  readonly adapter: string;
  readonly framework: string;
  readonly sessionId: string;
  readonly metrics: ProbePerformanceMetrics;
}

interface SendResult {
  readonly bytes: number;
  readonly serializationMicroseconds: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 1_000;

/**
 * A connected channel.
 *
 * `publish` returns the marker rather than writing it. Only a framework probe
 * knows when its frame bytes have drained, and emitting earlier silently pairs
 * the tree with the wrong screen.
 */
export class ProbeChannel {
  readonly #socket: Socket;
  readonly session: ChannelSession;
  readonly #token: string;
  readonly #evidenceProviders: FrozenEvidenceProviderRegistry;
  #open = true;
  #revision = 0;
  #lastSnapshot: SemanticSnapshot | null = null;
  #forceFullSnapshot = true;
  readonly #performance: MutableProbePerformanceMetrics | null;
  readonly #performanceSink: (() => void) | null;

  /** @internal Built by {@link connectProbe} once the handshake succeeded. */
  constructor(
    socket: Socket,
    session: ChannelSession,
    token: string,
    decoder: FrameDecoder,
    pending: readonly unknown[] = [],
    evidenceProviders: FrozenEvidenceProviderRegistry = freezeEvidenceProviders(),
    performanceMetrics = false,
    performanceSink?: (metrics: ProbePerformanceMetrics) => void,
  ) {
    this.#socket = socket;
    this.session = session;
    this.#token = token;
    this.#evidenceProviders = evidenceProviders;
    this.#performance = performanceMetrics
      ? {
          fullSnapshots: 0,
          deltas: 0,
          semanticBytes: 0,
          semanticNodes: 0,
          unknownFrameworkNodes: 0,
          droppedEvents: 0,
          markerRequests: 0,
          serializationMicroseconds: 0,
          probeEvents: 0,
          framesWithProbeEvents: 0,
          coalescedEvents: 0,
        }
      : null;
    this.#performanceSink =
      performanceSink === undefined ? null : () => performanceSink(this.performanceMetrics());

    socket.on('data', (chunk: Buffer) => {
      if (!this.#open) return;
      try {
        for (const value of decoder.push(chunk)) this.#dispatch(value);
      } catch {
        this.close();
      }
    });
    socket.on('error', () => this.close());
    socket.on('close', () => this.close());

    // The ACK and the driver's first request may share one pipe/TCP chunk. The
    // handshake decoder already removed every complete frame from its buffer,
    // so values after the ACK must be handed over explicitly or they vanish.
    for (const value of pending) this.#dispatch(value);
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** Revisions published so far. */
  get revision(): number {
    return this.#revision;
  }

  /** True after connect/resync until a full semantic keyframe is accepted for sending. */
  get requiresFullSnapshot(): boolean {
    return this.#forceFullSnapshot;
  }

  /**
   * A stable, immutable debug snapshot. Disabled collection reports no
   * fabricated zeros for averages that were never observed.
   */
  performanceMetrics(): ProbePerformanceMetrics {
    const metrics = this.#performance;
    if (metrics === null) {
      return Object.freeze({
        enabled: false,
        fullSnapshots: 0,
        deltas: 0,
        semanticBytes: 0,
        semanticNodes: 0,
        unknownFrameworkNodes: 0,
        droppedEvents: 0,
        markerRequests: 0,
        serializationMicroseconds: 0,
        averageBytesPerFrame: null,
        averageSemanticNodesPerFrame: null,
        averageUnknownFrameworkNodesPerFrame: null,
        averageSerializationMicrosecondsPerFrame: null,
        probeEventsPerFrame: null,
        coalescedEvents: 0,
        renderCorrelationRate: null,
        parentNormalizationMicrosecondsPerFrame: null,
      });
    }
    const frames = metrics.fullSnapshots + metrics.deltas;
    return Object.freeze({
      enabled: true,
      fullSnapshots: metrics.fullSnapshots,
      deltas: metrics.deltas,
      semanticBytes: metrics.semanticBytes,
      semanticNodes: metrics.semanticNodes,
      unknownFrameworkNodes: metrics.unknownFrameworkNodes,
      droppedEvents: metrics.droppedEvents,
      markerRequests: metrics.markerRequests,
      serializationMicroseconds: metrics.serializationMicroseconds,
      averageBytesPerFrame: average(metrics.semanticBytes, frames),
      averageSemanticNodesPerFrame: average(metrics.semanticNodes, frames),
      averageUnknownFrameworkNodesPerFrame: average(metrics.unknownFrameworkNodes, frames),
      averageSerializationMicrosecondsPerFrame: average(metrics.serializationMicroseconds, frames),
      probeEventsPerFrame: average(metrics.probeEvents, metrics.framesWithProbeEvents),
      coalescedEvents: metrics.coalescedEvents,
      renderCorrelationRate: null,
      parentNormalizationMicrosecondsPerFrame: null,
    });
  }

  /**
   * Send a full tree and commit its revision.
   *
   * Full snapshots satisfy the producer side of dropped-frame recovery by
   * construction. Diff subscription can be added later without weakening this
   * initial correctness floor.
   */
  publish(
    snapshot: SemanticSnapshot,
    publication: ProbePublicationMetrics = {},
  ): string | undefined {
    if (!this.#open) {
      if (this.#performance !== null) this.#performance.droppedEvents += 1;
      return undefined;
    }
    const providerEvidence = this.#evidenceProviders.collect({
      sessionId: snapshot.sessionId,
      revision: snapshot.revision,
      columns: snapshot.columns,
      rows: snapshot.rows,
      resolveRecipient: (recipient) => {
        const matches =
          'semanticId' in recipient
            ? snapshot.nodes.filter((node) => node.id === recipient.semanticId)
            : 'testId' in recipient
              ? snapshot.nodes.filter((node) => node.testId === recipient.testId)
              : snapshot.nodes.filter(
                  (node) => node.role === recipient.role && node.name === recipient.name,
                );
        if (matches.length !== 1) {
          throw new Error(
            `application evidence recipient resolved to ${matches.length} semantic nodes`,
          );
        }
        return matches[0]!.id;
      },
    });
    const qualifiedSnapshot: SemanticSnapshot =
      providerEvidence.length === 0 ? snapshot : Object.freeze({ ...snapshot, providerEvidence });
    const previousSnapshot = this.#lastSnapshot;
    const sendFull = this.#forceFullSnapshot || previousSnapshot === null;
    const message: AdapterToDriverMessage = sendFull
      ? { type: 'semantic-full', snapshot: qualifiedSnapshot }
      : {
          type: 'semantic-delta',
          delta: diffSemanticSnapshots(previousSnapshot!, qualifiedSnapshot),
        };
    const sent = this.#send(message, this.#performance !== null);
    if (sent === undefined) {
      if (this.#performance !== null) this.#performance.droppedEvents += 1;
      this.#emitPerformance();
      return undefined;
    }
    this.#lastSnapshot = qualifiedSnapshot;
    this.#forceFullSnapshot = false;
    this.#revision = snapshot.revision;
    if (this.#performance !== null) {
      if (sendFull) this.#performance.fullSnapshots += 1;
      else this.#performance.deltas += 1;
      this.#performance.semanticBytes += sent.bytes;
      this.#performance.semanticNodes += snapshot.nodes.length;
      this.#performance.unknownFrameworkNodes += snapshot.nodes.filter(
        (node) => node.role === 'generic',
      ).length;
      this.#performance.serializationMicroseconds += sent.serializationMicroseconds;
      if (
        publication.probeEvents !== undefined &&
        Number.isSafeInteger(publication.probeEvents) &&
        publication.probeEvents >= 0
      ) {
        this.#performance.probeEvents += publication.probeEvents;
        this.#performance.framesWithProbeEvents += 1;
      }
    }
    if (this.#send({ type: 'revision-commit', revision: snapshot.revision }) === undefined) {
      if (this.#performance !== null) this.#performance.droppedEvents += 1;
      this.#emitPerformance();
      return undefined;
    }

    if (!this.session.markerEnabled) {
      this.#emitPerformance();
      return undefined;
    }
    try {
      const marker = encodeMarker(this.#token, this.session.sessionId, snapshot.revision);
      if (this.#performance !== null) this.#performance.markerRequests += 1;
      this.#emitPerformance();
      return marker;
    } catch {
      this.#emitPerformance();
      return undefined;
    }
  }

  /** Report a framework publication superseded before its marker could drain. */
  recordCoalescedEvent(): void {
    if (this.#performance !== null) {
      this.#performance.coalescedEvents += 1;
      this.#emitPerformance();
    }
  }

  /** Report a typed fatal producer-contract violation and close the channel. */
  fail(
    code: 'duplicate-semantic-key' | 'adapter-guarantee-violation' | 'internal',
    message: string,
  ): void {
    if (!this.#open) return;
    this.#send({ type: 'error', code, message: message.slice(0, 1_024) });
    this.close();
  }

  /** Disable the channel and release the socket. Idempotent. */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#evidenceProviders.close();
    this.#socket.removeAllListeners('data');
    this.#socket.destroy();
  }

  #dispatch(value: unknown): void {
    const parsed = parseDriverMessage(value, this.session.limits);
    if (!parsed.ok) {
      this.close();
      return;
    }
    const message = parsed.message;
    if (message.type === 'error') {
      this.close();
      return;
    }
    if (message.type === 'semantic-resync-request') {
      if (message.sessionId !== this.session.sessionId) {
        this.close();
        return;
      }
      this.#forceFullSnapshot = true;
    }
  }

  #send(message: AdapterToDriverMessage, measureSerialization = false): SendResult | undefined {
    if (!this.#open) return undefined;
    let frame: Uint8Array;
    let serializationMicroseconds: number;
    try {
      const started = measureSerialization ? performance.now() : 0;
      frame = encodeFrame(message, this.session.limits.maxFrameBytes);
      serializationMicroseconds = measureSerialization ? (performance.now() - started) * 1_000 : 0;
    } catch {
      // This is locally produced data and encodeFrame writes nothing before it
      // rejects. Drop only this publication: a later, smaller framework frame
      // can still be valid and must not lose the already negotiated channel.
      return undefined;
    }
    try {
      this.#socket.write(frame);
      return { bytes: frame.byteLength, serializationMicroseconds };
    } catch {
      this.close();
      return undefined;
    }
  }

  #emitPerformance(): void {
    try {
      this.#performanceSink?.();
    } catch {
      // Debug output is strictly fail-open: a bad path cannot break rendering.
    }
  }
}

function average(total: number, count: number): number | null {
  return count === 0 ? null : total / count;
}

function debugMetricsEnabled(env: NodeJS.ProcessEnv): boolean {
  if ((env['TERMWRIGHT_DEBUG_FILE'] ?? '').trim().length > 0) return true;
  const value = (env['TERMWRIGHT_DEBUG'] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'api' || value === 'all' || value === 'on';
}

function performanceFile(env: NodeJS.ProcessEnv): string | undefined {
  const path = (env['TERMWRIGHT_DEBUG_FILE'] ?? '').trim();
  return path.length === 0 ? undefined : path;
}

function filePerformanceSink(
  path: string | undefined,
  context: { readonly adapter: string; readonly framework: string; readonly sessionId: string },
): ((metrics: ProbePerformanceMetrics) => void) | undefined {
  if (path === undefined) return undefined;
  return (metrics) => {
    const record: ProbePerformanceRecord = {
      kind: 'termwright-probe-performance',
      adapter: context.adapter,
      framework: context.framework,
      sessionId: context.sessionId,
      metrics,
    };
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
  };
}

/**
 * Connect and complete the handshake.
 *
 * Any failure resolves to `null`. A refused socket, malformed acknowledgement
 * or disappearing driver must be indistinguishable from disabled semantics to
 * the application.
 */
export async function connectProbe(options: ConnectOptions): Promise<ProbeChannel | null> {
  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  // Freeze synchronously, before a socket can connect and before hello is
  // constructed. Any later application registration is a lifecycle error.
  const evidenceProviders = freezeEvidenceProviders(options.evidenceProviderRegistry);

  return new Promise<ProbeChannel | null>((resolve) => {
    let settled = false;
    let socket: Socket;
    const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);
    const timer = setTimeout(() => abandon(), timeoutMs);
    timer.unref();

    const detach = (): void => {
      clearTimeout(timer);
      for (const event of ['connect', 'data', 'error', 'close']) socket.removeAllListeners(event);
    };
    const abandon = (): void => {
      if (settled) return;
      settled = true;
      detach();
      socket.destroy();
      evidenceProviders.close();
      resolve(null);
    };
    const accept = (session: ChannelSession, pending: readonly unknown[]): void => {
      if (settled) return;
      settled = true;
      detach();
      const metricsPath = options.performanceMetricsFile ?? performanceFile(process.env);
      resolve(
        new ProbeChannel(
          socket,
          session,
          options.token,
          decoder,
          pending,
          evidenceProviders,
          options.performanceMetrics ??
            (metricsPath !== undefined || debugMetricsEnabled(process.env)),
          filePerformanceSink(metricsPath, {
            adapter: options.adapterName,
            framework: options.probe.framework,
            sessionId: session.sessionId,
          }),
        ),
      );
    };

    try {
      socket = createConnection(options.endpoint);
      socket.unref();
    } catch {
      clearTimeout(timer);
      evidenceProviders.close();
      resolve(null);
      return;
    }

    socket.on('error', abandon);
    socket.on('close', abandon);
    socket.on('connect', () => {
      try {
        socket.write(
          encodeFrame(
            {
              type: 'hello',
              protocol: PROTOCOL_ID,
              token: options.token,
              adapter: { name: options.adapterName, version: options.adapterVersion },
              capabilities: [...new Set([...options.capabilities, 'incremental-tree'])],
              probe: options.probe,
              ...(evidenceProviders.registrations.length === 0
                ? {}
                : { providers: evidenceProviders.registrations }),
            },
            DEFAULT_LIMITS.maxFrameBytes,
          ),
        );
      } catch {
        abandon();
      }
    });

    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      let messages: readonly unknown[];
      try {
        messages = decoder.push(chunk);
      } catch {
        abandon();
        return;
      }
      if (messages.length === 0) return;

      const parsed = parseDriverMessage(messages[0], DEFAULT_LIMITS);
      if (!parsed.ok || parsed.message.type !== 'hello-ack') {
        abandon();
        return;
      }
      const ack = parsed.message;
      if (ack.protocol !== PROTOCOL_ID) {
        abandon();
        return;
      }
      accept(
        {
          protocol: ack.protocol,
          sessionId: ack.sessionId,
          limits: narrowLimits(ack.limits),
          markerEnabled: ack.marker.enabled,
        },
        messages.slice(1),
      );
    });
  });
}

/** Adopt the driver's limits, never above our own: it may tighten, not widen. */
function narrowLimits(offered: ProtocolLimits): ProtocolLimits {
  const entries = Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => {
    const value = (offered as unknown as Record<string, unknown>)[key];
    const usable = typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    return [key, usable ? Math.min(value, fallback as number) : fallback];
  });
  return Object.freeze(Object.fromEntries(entries)) as ProtocolLimits;
}
