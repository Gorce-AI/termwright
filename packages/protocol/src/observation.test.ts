import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from './limits.js';
import { validateSnapshot } from './validate.js';
import {
  intersectRects,
  rectArea,
  spatialRelation,
  viewportIntersection,
  type Rect,
} from './index.js';

const ev = (providerId: string) => ({
  source: 'framework',
  method: 'instrumented',
  strength: 'authoritative',
  providerId,
});

describe('qualified geometry', () => {
  it('requires authoritative provenance for absent and revision-scoped reasons for unknown', () => {
    const base = {
      v: 3,
      sessionId: 's',
      revision: 1,
      columns: 10,
      rows: 5,
      rootIds: ['n1'],
      nodes: [
        {
          id: 'n1',
          role: 'button',
          name: 'Approve',
          geometry: {
            displayed: { status: 'known', value: false, evidence: ev('probe') },
            intendedRect: {
              status: 'absent',
              reason: 'not-displayed',
              evidence: ev('probe'),
            },
            visibleRect: {
              status: 'absent',
              reason: 'not-displayed',
              evidence: ev('probe'),
            },
          },
        },
      ],
      coordinateSpace: {
        status: 'known',
        value: 'viewport-cells',
        evidence: ev('probe'),
      },
      hitGrid: {
        status: 'unsupported',
        capability: 'pointer-hit-grid',
        reason: 'framework-unobservable',
      },
    };
    expect(validateSnapshot(base, DEFAULT_LIMITS).ok).toBe(true);
    const missing = structuredClone(base) as any;
    delete missing.nodes[0].geometry.visibleRect.evidence;
    expect(validateSnapshot(missing, DEFAULT_LIMITS)).toMatchObject({
      ok: false,
      detail: expect.stringContaining('evidence'),
    });
    const diagnostic = structuredClone(base) as any;
    diagnostic.nodes[0].geometry.visibleRect.evidence.strength = 'diagnostic';
    expect(validateSnapshot(diagnostic, DEFAULT_LIMITS)).toMatchObject({
      ok: false,
      detail: expect.stringContaining('evidence'),
    });
    const permanentUnknown = structuredClone(base) as any;
    permanentUnknown.nodes[0].geometry.visibleRect = {
      status: 'unknown',
      reason: 'not-reported',
    };
    expect(validateSnapshot(permanentUnknown, DEFAULT_LIMITS)).toMatchObject({
      ok: false,
      detail: expect.stringContaining('reason'),
    });
  });

  it('accepts a fully qualified v3 snapshot and rejects unqualified geometry', () => {
    const geometry = {
      displayed: { status: 'known', value: true, evidence: ev('probe') },
      intendedRect: {
        status: 'known',
        value: { row: -1, column: 2, width: 5, height: 3 },
        evidence: ev('probe'),
      },
      visibleRect: {
        status: 'known',
        value: { row: 0, column: 2, width: 5, height: 2 },
        evidence: ev('viewport-clip'),
      },
    };
    const snapshot = {
      v: 3,
      sessionId: 's',
      revision: 1,
      columns: 10,
      rows: 5,
      rootIds: ['n1'],
      nodes: [
        {
          id: 'n1',
          role: 'button',
          name: 'Approve',
          geometry,
          actions: ['activate'],
          inputRecipes: [
            {
              action: 'activate',
              requiresFocus: true,
              steps: [{ kind: 'press', key: 'Enter' }],
            },
          ],
        },
      ],
      coordinateSpace: {
        status: 'known',
        value: 'viewport-cells',
        evidence: ev('probe'),
      },
      hitGrid: {
        status: 'known',
        value: {
          regions: [
            {
              rect: { row: 0, column: 2, width: 5, height: 1 },
              recipientId: 'n1',
            },
            {
              rect: { row: 1, column: 2, width: 5, height: 1 },
              recipientId: 'n1',
            },
          ],
        },
        evidence: ev('hit-grid'),
      },
    };
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
    expect(
      validateSnapshot(
        {
          ...snapshot,
          nodes: [
            {
              ...snapshot.nodes[0],
              inputRecipes: [
                {
                  action: 'activate',
                  requiresFocus: true,
                  steps: [{ kind: 'insert-action-value' }],
                },
              ],
            },
          ],
        },
        DEFAULT_LIMITS,
      ),
    ).toMatchObject({ ok: false, code: 'schema' });
    expect(
      validateSnapshot(
        {
          ...snapshot,
          nodes: [{ ...snapshot.nodes[0], bounds: geometry.visibleRect.value }],
        },
        DEFAULT_LIMITS,
      ),
    ).toMatchObject({ ok: false, code: 'schema' });
  });

  it('rejects a v2 hit grid that claims an unknown recipient', () => {
    const unsupported = {
      status: 'unsupported',
      capability: 'visible-rect',
      reason: 'framework-unobservable',
    };
    const snapshot = {
      v: 3,
      sessionId: 's',
      revision: 1,
      columns: 10,
      rows: 5,
      rootIds: ['n1'],
      nodes: [
        {
          id: 'n1',
          role: 'button',
          name: 'Approve',
          geometry: {
            displayed: { status: 'known', value: true, evidence: ev('probe') },
            intendedRect: unsupported,
            visibleRect: { ...unsupported },
          },
        },
      ],
      coordinateSpace: {
        status: 'known',
        value: 'viewport-cells',
        evidence: ev('probe'),
      },
      hitGrid: {
        status: 'known',
        value: {
          regions: [
            {
              rect: { row: 0, column: 0, width: 1, height: 1 },
              recipientId: 'ghost',
            },
          ],
        },
        evidence: ev('hit-grid'),
      },
    };
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS)).toMatchObject({
      ok: false,
      code: 'missing-parent',
    });
  });

  it('rejects ambiguous, non-canonical hit regions', () => {
    const unsupported = {
      status: 'unsupported',
      capability: 'visible-rect',
      reason: 'framework-unobservable',
    } as const;
    const base = {
      v: 3,
      sessionId: 's',
      revision: 1,
      columns: 10,
      rows: 5,
      rootIds: ['n1'],
      nodes: [
        {
          id: 'n1',
          role: 'button',
          name: 'Approve',
          geometry: {
            displayed: { status: 'known', value: true, evidence: ev('probe') },
            intendedRect: unsupported,
            visibleRect: { ...unsupported },
          },
        },
      ],
      coordinateSpace: {
        status: 'known',
        value: 'viewport-cells',
        evidence: ev('probe'),
      },
    };
    const hitGrid = {
      status: 'known',
      evidence: ev('hit-grid'),
      value: {
        regions: [
          {
            rect: { row: 0, column: 1, width: 3, height: 1 },
            recipientId: 'n1',
          },
          {
            rect: { row: 0, column: 3, width: 2, height: 1 },
            recipientId: 'n1',
          },
        ],
      },
    };
    expect(validateSnapshot({ ...base, hitGrid }, DEFAULT_LIMITS)).toMatchObject({
      ok: false,
      code: 'bad-rect',
    });
    expect(
      validateSnapshot(
        {
          ...base,
          hitGrid: {
            ...hitGrid,
            value: {
              regions: [
                {
                  rect: { row: 0, column: 1, width: 3, height: 2 },
                  recipientId: 'n1',
                },
              ],
            },
          },
        },
        DEFAULT_LIMITS,
      ),
    ).toMatchObject({ ok: false, code: 'bad-rect' });
  });
  it('uses half-open edges: touching is adjacency, never overlap', () => {
    const a = { row: 1, column: 1, width: 3, height: 2 };
    const right = { row: 1, column: 4, width: 2, height: 2 };
    const below = { row: 3, column: 1, width: 3, height: 2 };
    expect(rectArea(intersectRects(a, right))).toBe(0);
    expect(rectArea(intersectRects(a, below))).toBe(0);
    expect(spatialRelation(a, 'overlaps', right)).toBe(false);
    expect(spatialRelation(a, 'adjacent-horizontal', right)).toBe(true);
    expect(spatialRelation(a, 'adjacent-vertical', below)).toBe(true);
  });

  it('computes exact viewport ratios for partial, full and offscreen boxes', () => {
    expect(viewportIntersection({ row: 1, column: 2, width: 4, height: 2 }, 10, 5)).toEqual({
      rect: { row: 1, column: 2, width: 4, height: 2 },
      ratio: 1,
      fullyInside: true,
    });
    expect(viewportIntersection({ row: 4, column: 8, width: 4, height: 2 }, 10, 5)).toEqual({
      rect: { row: 4, column: 8, width: 2, height: 1 },
      ratio: 0.25,
      fullyInside: false,
    });
    expect(viewportIntersection({ row: 5, column: 10, width: 4, height: 2 }, 10, 5)).toEqual({
      rect: { row: 5, column: 10, width: 0, height: 0 },
      ratio: 0,
      fullyInside: false,
    });
  });

  it('satisfies intersection symmetry and area bounds over a deterministic grid', () => {
    const rects: Rect[] = [];
    for (let row = -1; row <= 2; row += 1) {
      for (let column = -1; column <= 2; column += 1) {
        for (let width = 0; width <= 2; width += 1) {
          for (let height = 0; height <= 2; height += 1) rects.push({ row, column, width, height });
        }
      }
    }
    for (const a of rects) {
      for (const b of rects) {
        const ab = intersectRects(a, b);
        const ba = intersectRects(b, a);
        expect(ab).toEqual(ba);
        expect(rectArea(ab)).toBeLessThanOrEqual(Math.min(rectArea(a), rectArea(b)));
        expect(spatialRelation(a, 'overlaps', b)).toBe(rectArea(ab) > 0);
      }
    }
  });

  it('defines every spatial relation without axis inversion', () => {
    const outer = { row: 1, column: 2, width: 10, height: 8 };
    const inner = { row: 2, column: 3, width: 2, height: 2 };
    expect(spatialRelation(outer, 'contains', inner)).toBe(true);
    expect(spatialRelation(inner, 'inside', outer)).toBe(true);
    expect(
      spatialRelation(inner, 'right-of', {
        row: 2,
        column: 0,
        width: 3,
        height: 2,
      }),
    ).toBe(true);
    expect(
      spatialRelation(inner, 'below', {
        row: 0,
        column: 3,
        width: 2,
        height: 2,
      }),
    ).toBe(true);
  });
});
