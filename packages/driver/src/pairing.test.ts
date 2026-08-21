import { describe, expect, it, vi } from 'vitest';
import type { SemanticSnapshot } from '@termwright/protocol';
import { RevisionPairing, type PairedRevision } from './pairing.js';

function snapshot(revision: number): SemanticSnapshot {
  return {
    v: 2,
    sessionId: 's',
    revision,
    columns: 80,
    rows: 24,
    rootIds: ['n1'],
    nodes: [{ id: 'n1', role: 'application', name: 'app', geometry: { displayed: { status: 'unknown', reason: 'awaiting-revision-pair' }, intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' }, visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' } } }],
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: { source: 'driver', method: 'native', strength: 'authoritative', providerId: 'test' } },
    hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
  };
}

function createPairing(markerEnabled = true, caughtUp?: () => Promise<void>) {
  const published: PairedRevision[] = [];
  const diagnostics: string[] = [];
  const pairing = new RevisionPairing({
    maxPending: 3,
    pairingTimeoutMs: 50,
    ...(caughtUp !== undefined ? { caughtUp } : {}),
    onPublish: (paired) => published.push(paired),
    onDiagnostic: (code, detail, revision) => diagnostics.push(`${code} r${revision}: ${detail}`),
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
      await vi.advanceTimersByTimeAsync(60);
      expect(diagnostics.join('\n')).toContain('render marker did not arrive');
      expect(pairing.hasPendingRender).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not run the expiry clock while the emulator is still catching up', async () => {
    // The flood case: the tree came over a socket, its marker is bytes still
    // queued for the parser. Expiring here would report a missing half that is
    // in fact already in hand, unread.
    vi.useFakeTimers();
    try {
      let caughtUp = (): void => {};
      const barrier = new Promise<void>((resolve) => {
        caughtUp = resolve;
      });
      const { pairing, diagnostics, published } = createPairing(true, () => barrier);

      pairing.offerSnapshot(snapshot(1));
      await vi.advanceTimersByTimeAsync(500); // ten times the window
      expect(diagnostics).toEqual([]);
      expect(pairing.hasPendingRender).toBe(true);

      // The marker was in those unparsed bytes all along.
      pairing.offerMarker(1, 9);
      expect(published).toHaveLength(1);

      caughtUp();
      await vi.advanceTimersByTimeAsync(500);
      // Nothing expires afterwards either: the half was cancelled before its
      // timer was ever armed.
      expect(diagnostics).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires once caught up, so a genuinely missing half is still reported', async () => {
    vi.useFakeTimers();
    try {
      let caughtUp = (): void => {};
      const barrier = new Promise<void>((resolve) => {
        caughtUp = resolve;
      });
      const { pairing, diagnostics } = createPairing(true, () => barrier);

      pairing.offerSnapshot(snapshot(1));
      await vi.advanceTimersByTimeAsync(500);
      expect(diagnostics).toEqual([]);

      caughtUp();
      await vi.advanceTimersByTimeAsync(60);
      expect(diagnostics.join('\n')).toContain('render marker did not arrive');
      expect(pairing.hasPendingRender).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expire a half while a probe has the frame open', async () => {
    // The fact the quiet-stream rule was approximating. "Output is arriving"
    // was only ever a guess at "the application is still drawing"; a probe
    // that says so directly makes the rule honest instead of probabilistic.
    vi.useFakeTimers();
    try {
      const { pairing, diagnostics, published } = createPairing();
      pairing.frameOpened(1);
      pairing.offerSnapshot(snapshot(1));

      await vi.advanceTimersByTimeAsync(500);
      expect(diagnostics).toEqual([]);
      expect(pairing.hasOpenFrame).toBe(true);

      pairing.frameClosed(1);
      pairing.offerMarker(1, 4);
      expect(published).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(diagnostics).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires once the frame closes without its other half', async () => {
    vi.useFakeTimers();
    try {
      const { pairing, diagnostics } = createPairing();
      pairing.frameOpened(1);
      pairing.offerSnapshot(snapshot(1));
      await vi.advanceTimersByTimeAsync(500);
      expect(diagnostics).toEqual([]);

      pairing.frameClosed(1);
      await vi.advanceTimersByTimeAsync(60);
      expect(diagnostics.join('\n')).toContain('render marker did not arrive');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an abandoned frame hold expiry open forever', async () => {
    // A probe can die mid-render, or give up on a frame it started. The next
    // frame beginning is proof the previous one is not coming — without that,
    // one lost frame-end wedges the session's expiry permanently.
    vi.useFakeTimers();
    try {
      const { pairing, diagnostics } = createPairing();
      pairing.frameOpened(1);
      pairing.offerSnapshot(snapshot(1));
      await vi.advanceTimersByTimeAsync(500);
      expect(diagnostics).toEqual([]);

      // Frame 1 is never closed; frame 2 starts and finishes.
      pairing.frameOpened(2);
      expect(pairing.hasOpenFrame).toBe(true);
      pairing.frameClosed(2);
      expect(pairing.hasOpenFrame).toBe(false);

      await vi.advanceTimersByTimeAsync(60);
      expect(diagnostics.join('\n')).toContain('render marker did not arrive');
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes a frame end without a beginning, for probes that only have a post-frame hook', async () => {
    // Frame boundaries are a capability, not a guarantee: Textual is
    // post-frame only, tview's pre-draw hook can veto, OpenTUI's sits inside
    // the loop. An end with no matching beginning must be a no-op, and the
    // absence of beginnings must read as "frames unannounced" — the quiet
    // barrier still applies — rather than "there is no frame".
    vi.useFakeTimers();
    try {
      const { pairing, diagnostics, published } = createPairing();
      pairing.offerSnapshot(snapshot(1));
      pairing.frameClosed(1);
      expect(pairing.hasOpenFrame).toBe(false);

      pairing.offerMarker(1, 3);
      expect(published).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(diagnostics).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes on arrival when the adapter has no marker capability', () => {
    const { pairing, published, diagnostics } = createPairing(false);
    pairing.offerMarker(1, 9);
    expect(pairing.hasPendingRender).toBe(false);
    expect(diagnostics.join('\n')).toContain('did not negotiate render-revisions');

    pairing.offerSnapshot(snapshot(1));
    expect(published).toHaveLength(1);
    expect(published[0]?.screenRevision).toBeNull();
  });
});
