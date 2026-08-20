import { describe, expect, it } from 'vitest';
import { resolveNodeBounds } from './bounds.js';
import type { ProbeGeometry } from './ir.js';

const intended = { row: 5, column: 10, width: 20, height: 6 };

describe('resolveNodeBounds — which rectangle wins', () => {
  it('prefers a framework-computed visible rectangle', () => {
    const geometry: ProbeGeometry = {
      intendedRect: intended,
      visibleRect: { row: 5, column: 10, width: 20, height: 2 },
    };
    const resolved = resolveNodeBounds(geometry);
    expect(resolved?.source).toBe('visible');
    expect(resolved?.rect).toEqual({ row: 5, column: 10, width: 20, height: 2 });
  });

  it('intersects with a known clip when the framework did not', () => {
    const resolved = resolveNodeBounds(
      { intendedRect: intended },
      { clip: { row: 0, column: 0, width: 15, height: 8 } },
    );
    expect(resolved?.source).toBe('clipped');
    // intended starts at column 10 and is 20 wide; the clip ends at 15.
    expect(resolved?.rect).toEqual({ row: 5, column: 10, width: 5, height: 3 });
  });

  it('falls back to the intended rectangle only when nothing knows about clipping', () => {
    const resolved = resolveNodeBounds({ intendedRect: intended });
    expect(resolved?.source).toBe('intended');
    expect(resolved?.rect).toEqual(intended);
  });

  it('returns nothing when the object reported no geometry', () => {
    // A bounds-free node is a legal state, not a degraded one; inventing a
    // rectangle here would be worse than having none.
    expect(resolveNodeBounds(undefined)).toBeUndefined();
    expect(resolveNodeBounds({})).toBeUndefined();
  });
});

describe('resolveNodeBounds — clipped away', () => {
  it('flags a node the clip removed entirely', () => {
    const resolved = resolveNodeBounds(
      { intendedRect: { row: 100, column: 0, width: 4, height: 2 } },
      { clip: { row: 0, column: 0, width: 80, height: 24 } },
    );
    expect(resolved?.clippedAway).toBe(true);
    expect(resolved?.rect.height).toBe(0);
  });

  it('flags an empty visible rectangle the framework computed itself', () => {
    const resolved = resolveNodeBounds({
      intendedRect: intended,
      visibleRect: { row: 5, column: 10, width: 0, height: 0 },
    });
    expect(resolved?.clippedAway).toBe(true);
  });

  it('does not flag a node that merely has no clip', () => {
    expect(resolveNodeBounds({ intendedRect: intended })?.clippedAway).toBe(false);
  });

  it('does not call an intrinsically empty rectangle offscreen', () => {
    const resolved = resolveNodeBounds(
      { intendedRect: { row: 5, column: 10, width: 0, height: 1 } },
      { clip: { row: 0, column: 0, width: 80, height: 24 } },
    );
    expect(resolved?.clippedAway).toBe(false);
    expect(resolved?.rect).toEqual({ row: 5, column: 10, width: 0, height: 1 });
  });

  it('keeps a partially clipped node visible', () => {
    const resolved = resolveNodeBounds(
      { intendedRect: intended },
      { clip: { row: 6, column: 0, width: 80, height: 24 } },
    );
    expect(resolved?.clippedAway).toBe(false);
    expect(resolved?.rect.row).toBe(6);
  });
});

describe('resolveNodeBounds — occlusion knowledge', () => {
  it('is unknown unless the probe reports paint order', () => {
    expect(resolveNodeBounds({ intendedRect: intended })?.occlusion).toBe('unknown');
    expect(resolveNodeBounds({ intendedRect: intended }, {})?.occlusion).toBe('unknown');
    expect(
      resolveNodeBounds({ intendedRect: intended }, { paintOrderKnown: false })?.occlusion,
    ).toBe('unknown');
  });

  it('is known only when paint order was reported', () => {
    expect(
      resolveNodeBounds({ intendedRect: intended }, { paintOrderKnown: true })?.occlusion,
    ).toBe('known');
  });

  it('does not depend on which rectangle won', () => {
    // Knowing where a node is and knowing whether something covers it are
    // independent facts; a clip intersection says nothing about paint order.
    const geometry: ProbeGeometry = { intendedRect: intended, visibleRect: intended };
    expect(resolveNodeBounds(geometry, { paintOrderKnown: false })?.occlusion).toBe('unknown');
    expect(resolveNodeBounds(geometry, { paintOrderKnown: true })?.occlusion).toBe('known');
  });
});
