import { describe, expect, it } from 'vitest';
import { formatCompactSnapshot, parseRef, refEntries, stateFlags } from './format.js';
import type { SemanticSnapshot } from './model.js';

const evidence = () => ({ source: 'framework' as const, method: 'native' as const, strength: 'authoritative' as const, providerId: 'mcp-test' });
const geometry = (rect: { row: number; column: number; width: number; height: number }) => ({
  displayed: { status: 'known' as const, value: true, evidence: evidence() },
  intendedRect: { status: 'known' as const, value: { ...rect }, evidence: evidence() },
  visibleRect: { status: 'known' as const, value: { ...rect }, evidence: evidence() },
});

/** The snapshot behind the example in CONTRACTS.md §MCP. */
const permissionDialog: SemanticSnapshot = {
  v: 2,
  sessionId: 's1',
  revision: 42,
  columns: 100,
  rows: 30,
  rootIds: ['n7'],
  nodes: [
    {
      id: 'n7',
      role: 'dialog',
      name: 'Permission',
      geometry: geometry({ row: 8, column: 20, width: 40, height: 9 }),
      state: { modal: true },
    },
    {
      id: 'n8',
      parentId: 'n7',
      role: 'button',
      name: 'Approve',
      geometry: geometry({ row: 14, column: 23, width: 11, height: 1 }),
      state: { focused: true },
    },
  ],
  coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence() },
  hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
};

describe('the compact snapshot format', () => {
  it('reproduces the normative example from CONTRACTS.md byte for byte', () => {
    const compact = formatCompactSnapshot({
      terminal: 't1',
      columns: 100,
      rows: 30,
      revision: 42,
      semantic: permissionDialog,
      text: ['Permission required', '  [Approve]   Reject'],
    });

    expect(compact).toBe(
      [
        'Terminal t1 100x30 revision 42',
        'semanticTree: available',
        'dialog "Permission" ref=n7@42 bounds=(8,20,40,9) modal',
        '  button "Approve" ref=n8@42 bounds=(14,23,11,1) focused',
        'visible text:',
        'Permission required',
        '  [Approve]   Reject',
      ].join('\n'),
    );
  });

  it('says so when the program publishes no semantic tree', () => {
    const compact = formatCompactSnapshot({
      terminal: 't2',
      columns: 80,
      rows: 24,
      revision: 3,
      semantic: null,
      text: ['$ '],
    });
    expect(compact.split('\n').slice(0, 2)).toEqual(['Terminal t2 80x24 revision 3', 'semanticTree: unavailable']);
    expect(compact).not.toContain('ref=');
  });

  it('bounds the node list and the row list rather than dumping everything', () => {
    const compact = formatCompactSnapshot({
      terminal: 't1',
      columns: 100,
      rows: 30,
      revision: 42,
      semantic: permissionDialog,
      text: ['a', 'b', 'c'],
      maxNodes: 1,
      maxRows: 1,
    });
    expect(compact).toContain('... 1 more nodes');
    expect(compact).toContain('... 2 more rows');
  });

  it('omits the visible text for the full variant, which writes it to disk instead', () => {
    const compact = formatCompactSnapshot({
      terminal: 't1',
      columns: 100,
      rows: 30,
      revision: 42,
      semantic: permissionDialog,
      text: ['secret'],
      includeText: false,
    });
    expect(compact).not.toContain('visible text:');
    expect(compact).toContain('ref=n8@42');
  });
});

describe('refs', () => {
  it('carries the semantic revision so staleness is detectable', () => {
    expect(refEntries(permissionDialog).map((entry) => entry.ref)).toEqual(['n7@42', 'n8@42']);
    expect(parseRef('n8@42')).toEqual({ nodeId: 'n8', revision: 42 });
  });

  it('rejects anything that is not a ref', () => {
    expect(parseRef('n8')).toBeNull();
    expect(parseRef('@42')).toBeNull();
    expect(parseRef('n8@later')).toBeNull();
  });
});

describe('state flags', () => {
  it('prints booleans bare and everything else as name=value', () => {
    expect(stateFlags({ modal: true, focused: false, checked: 'mixed', level: 2 })).toEqual([
      'modal',
      'checked=mixed',
      'level=2',
    ]);
  });

  it('prints nothing for a node without state', () => {
    expect(stateFlags(undefined)).toEqual([]);
  });
});
