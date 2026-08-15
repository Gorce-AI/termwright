import { describe, expect, it, vi } from 'vitest';
import type { SemanticSnapshot } from '@termwright/protocol';
import { RevisionPairing, type PairedRevision } from './pairing.js';

function snapshot(revision: number): SemanticSnapshot {
  return {
    v: 1,
    sessionId: 's',
    revision,
    columns: 80,
    rows: 24,
    rootIds: ['n1'],
    nodes: [{ id: 'n1', role: 'application', name: 'app' }],
  };
}

function createPairing(markerEnabled = true) {
  const published: PairedRevision[] = [];
  const diagnostics: string[] = [];
  const pairing = new RevisionPairing({
    maxPending: 3,
    pairingTimeoutMs: 50,
    onPublish: (paired) => published.push(paired),
    onDiagnostic: (message) => diagnostics.push(message),
  });
  pairing.setMarkerEnabled(markerEnabled);
  return { pairing, published, diagnostics };
}

describe('RevisionPairing', () => {
  it('publishes only when both halves are present, in either arrival order', () => {
    const { pairing, published } = createPairing();

    pairing.offerSnapshot(snapshot(1));
    expect(published).toHaveLength(0);
    expect(pairing.hasPendingRender).toBe(true);
    pairing.offerMarker(1, 7);
    expect(published).toHaveLength(1);
    expect(published[0]?.screenRevision).toBe(7);
    expect(pairing.hasPendingRender).toBe(false);

    pairing.offerMarker(2, 9);
    expect(published).toHaveLength(1);
    pairing.offerSnapshot(snapshot(2));
    expect(published).toHaveLength(2);
    expect(pairing.revision).toBe(2);
  });

  it('pairs by revision number, not by successor', () => {
    // Adapters may skip revisions: frames produced before the handshake, or
    // superseded mid-flight, are dropped at the source.
    const { pairing, published } = createPairing();
    pairing.offerSnapshot(snapshot(1));
    pairing.offerMarker(1, 1);
    pairing.offerSnapshot(snapshot(7));
    pairing.offerMarker(7, 4);

    expect(published.map((entry) => entry.snapshot.revision)).toEqual([1, 7]);
    expect(pairing.revision).toBe(7);
  });

  it('drops superseded incomplete revisions with a diagnostic', () => {
    const { pairing, published, diagnostics } = createPairing();
    pairing.offerSnapshot(snapshot(1));
    pairing.offerSnapshot(snapshot(2));
    pairing.offerMarker(2, 4);

    expect(published).toHaveLength(1);
    expect(published[0]?.snapshot.revision).toBe(2);
    expect(diagnostics.join('\n')).toContain('superseded by 2');
    expect(pairing.hasPendingRender).toBe(false);
  });

  it('ignores revisions that are not newer than the published one', () => {
    const { pairing, published, diagnostics } = createPairing();
    pairing.offerSnapshot(snapshot(5));
    pairing.offerMarker(5, 1);
    pairing.offerSnapshot(snapshot(5));
    pairing.offerMarker(4, 2);

    expect(published).toHaveLength(1);
    expect(diagnostics.join('\n')).toContain('already published');
  });

  it('bounds the number of in-flight halves', () => {
    const { pairing, diagnostics } = createPairing();
    for (let revision = 1; revision <= 5; revision += 1) pairing.offerSnapshot(snapshot(revision));
    expect(diagnostics.join('\n')).toContain('more than 3 revisions in flight');
    // The oldest halves were evicted, so their markers can no longer pair.
    pairing.offerMarker(1, 1);
    expect(pairing.revision).toBe(0);
  });

  it('expires a half that never finds its partner', async () => {
    vi.useFakeTimers();
    try {
      const { pairing, diagnostics } = createPairing();
      pairing.offerSnapshot(snapshot(1));
      vi.advanceTimersByTime(60);
      expect(diagnostics.join('\n')).toContain('render marker did not arrive');
      expect(pairing.hasPendingRender).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes on arrival when the adapter has no marker capability', () => {
    const { pairing, published } = createPairing(false);
    pairing.offerSnapshot(snapshot(1));
    expect(published).toHaveLength(1);
    expect(published[0]?.screenRevision).toBeNull();
  });
});
