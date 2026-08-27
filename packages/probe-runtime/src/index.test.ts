import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFrameDecoder,
  encodeFrame,
  generateToken,
  parseAdapterMessage,
  verifyMarkerPayload,
  DEFAULT_LIMITS,
  PROTOCOL_ID,
  type AdapterToDriverMessage,
  type SemanticSnapshot,
} from '@termwright/protocol';
import { createEvidenceProviderRegistry } from '@termwright/evidence-provider';
import { connectProbe } from './index.js';

async function endpoint(): Promise<{
  path: string;
  metricsPath: string;
  dispose(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-probe-runtime-'));
  return {
    path:
      process.platform === 'win32'
        ? `\\\\.\\pipe\\termwright-runtime-${randomBytes(8).toString('hex')}`
        : join(directory, 'probe.sock'),
    metricsPath: join(directory, 'metrics.jsonl'),
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}

function snapshot(): SemanticSnapshot {
  return {
    v: 2,
    sessionId: 's1',
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['root'],
    nodes: [
      {
        id: 'root',
        role: 'application',
        name: '',
        geometry: {
          displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
          intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
          visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
        },
      },
    ],
    coordinateSpace: { status: 'unknown', reason: 'awaiting-revision-pair' },
    hitGrid: {
      status: 'unsupported',
      capability: 'pointer-hit-grid',
      reason: 'framework-unobservable',
    },
  };
}

describe('shared probe transport', () => {
  it('handshakes with ProbeInfo, publishes and authenticates a marker', async () => {
    const target = await endpoint();
    const token = generateToken();
    const messages: AdapterToDriverMessage[] = [];
    let peer: Socket | undefined;
    const server = createServer((socket) => {
      peer = socket;
      const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);
      socket.on('data', (chunk: Buffer) => {
        for (const value of decoder.push(chunk)) {
          const parsed = parseAdapterMessage(value, DEFAULT_LIMITS);
          if (!parsed.ok) throw new Error(parsed.detail);
          messages.push(parsed.message);
          if (parsed.message.type === 'hello') {
            socket.write(
              encodeFrame(
                {
                  type: 'hello-ack',
                  protocol: PROTOCOL_ID,
                  sessionId: 's1',
                  limits: DEFAULT_LIMITS,
                  subscribe: 'snapshots',
                  marker: { enabled: true },
                },
                DEFAULT_LIMITS.maxFrameBytes,
              ),
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(target.path, resolve);
    });

    const evidenceProviderRegistry = createEvidenceProviderRegistry();
    evidenceProviderRegistry.registerPointer({
      id: 'app.router',
      version: '1',
      method: 'native',
      family: 'pointer',
      capabilities: ['pointer-regions', 'hit-test'],
      observe: () => ({
        pointerRegions: [
          {
            recipient: { semanticId: 'root' },
            regionBounds: { row: 1, column: 2, width: 4, height: 1 },
            spans: [{ row: 1, from: 2, to: 6 }],
          },
        ],
        hitTest: (column, row) =>
          row === 1 && column >= 2 && column < 6 ? { semanticId: 'root' } : null,
      }),
    });

    const channel = await connectProbe({
      endpoint: target.path,
      token,
      probe: {
        framework: 'ink',
        probeVersion: '0.1.0',
        identityKind: 'stable',
        capabilities: ['stable-identity'],
      },
      capabilities: ['tree', 'render-revisions'],
      adapterName: '@termwright/probe-ink',
      adapterVersion: '0.1.0',
      evidenceProviderRegistry,
      performanceMetrics: true,
      performanceMetricsFile: target.metricsPath,
    });
    expect(channel).not.toBeNull();

    const marker = channel?.publish(snapshot(), { probeEvents: 7 });
    channel?.recordCoalescedEvent();
    const deadline = Date.now() + 1_000;
    while (messages.length < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(messages[0]).toMatchObject({
      type: 'hello',
      probe: { framework: 'ink', identityKind: 'stable' },
      providers: [{ id: 'app.router', version: '1', method: 'native' }],
    });
    expect(messages.slice(1).map((message) => message.type)).toEqual([
      'snapshot',
      'revision-commit',
    ]);
    expect(messages[1]).toMatchObject({
      type: 'snapshot',
      snapshot: {
        providerEvidence: [
          {
            providerId: 'app.router',
            sessionId: 's1',
            revision: 1,
            status: 'available',
          },
        ],
      },
    });
    const payload = (marker as string).slice((marker as string).indexOf(';') + 1, -1);
    expect(verifyMarkerPayload(payload, token, 's1')).toMatchObject({ revision: 1 });
    expect(channel?.performanceMetrics()).toMatchObject({
      enabled: true,
      fullSnapshots: 1,
      semanticNodes: 1,
      unknownFrameworkNodes: 0,
      droppedEvents: 0,
      markerRequests: 1,
      averageSemanticNodesPerFrame: 1,
      coalescedEvents: 1,
      probeEventsPerFrame: 7,
      renderCorrelationRate: null,
      parentNormalizationMicrosecondsPerFrame: null,
    });
    expect(channel?.performanceMetrics().averageBytesPerFrame).toBeGreaterThan(0);
    expect(
      channel?.performanceMetrics().averageSerializationMicrosecondsPerFrame,
    ).toBeGreaterThanOrEqual(0);
    const records = (await readFile(target.metricsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.at(-1)).toMatchObject({
      kind: 'termwright-probe-performance',
      adapter: '@termwright/probe-ink',
      framework: 'ink',
      sessionId: 's1',
      metrics: { fullSnapshots: 1, coalescedEvents: 1, probeEventsPerFrame: 7 },
    });

    channel?.close();
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await target.dispose();
  });

  it('fails closed when the endpoint refuses the connection', async () => {
    const target = await endpoint();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(target.path, resolve);
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await expect(
      connectProbe({
        endpoint: target.path,
        token: 'secret',
        probe: {
          framework: 'ink',
          probeVersion: '0.1.0',
          identityKind: 'stable',
          capabilities: [],
        },
        capabilities: ['tree'],
        adapterName: 'test',
        adapterVersion: '0.1.0',
        handshakeTimeoutMs: 100,
      }),
    ).resolves.toBeNull();
    await target.dispose();
  });

  it('keeps collection dormant unless debug metrics are enabled', async () => {
    // Constructor-level coverage avoids changing process-wide debug variables
    // and proves the disabled path never exposes an inferred average.
    const fake = {
      on() {
        return this;
      },
      removeAllListeners() {
        return this;
      },
      destroy() {},
      write() {
        return true;
      },
    } as unknown as Socket;
    const channel = new (await import('./index.js')).ProbeChannel(
      fake,
      { protocol: PROTOCOL_ID, sessionId: 's1', limits: DEFAULT_LIMITS, markerEnabled: false },
      'token',
      createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes),
    );
    expect(channel.performanceMetrics()).toMatchObject({
      enabled: false,
      averageBytesPerFrame: null,
      averageSerializationMicrosecondsPerFrame: null,
    });
    channel.close();
  });

  it('drops an oversized local publication without killing the negotiated channel', async () => {
    const writes: Uint8Array[] = [];
    const fake = {
      on() {
        return this;
      },
      removeAllListeners() {
        return this;
      },
      destroy() {},
      write(frame: Uint8Array) {
        writes.push(frame);
        return true;
      },
    } as unknown as Socket;
    const limits = { ...DEFAULT_LIMITS, maxFrameBytes: 1_024 };
    const channel = new (await import('./index.js')).ProbeChannel(
      fake,
      { protocol: PROTOCOL_ID, sessionId: 's1', limits, markerEnabled: false },
      'token',
      createFrameDecoder(limits.maxFrameBytes),
    );
    const oversized: SemanticSnapshot = {
      ...snapshot(),
      nodes: [
        {
          id: 'root',
          role: 'application',
          name: 'x'.repeat(2_048),
          geometry: {
            displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
            intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
            visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
          },
        },
      ],
    };

    expect(channel.publish(oversized)).toBeUndefined();
    expect(channel.isOpen).toBe(true);
    expect(channel.revision).toBe(0);
    expect(writes).toHaveLength(0);

    expect(channel.publish({ ...snapshot(), revision: 2 })).toBeUndefined();
    expect(channel.isOpen).toBe(true);
    expect(channel.revision).toBe(2);
    expect(writes).toHaveLength(2);
    channel.close();
  });
});
