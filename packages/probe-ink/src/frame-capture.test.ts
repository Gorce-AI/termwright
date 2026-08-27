import { describe, expect, it } from 'vitest';
import { captureInkLayout } from './frame-capture.js';
import type { InkDomElement } from './observe.js';

function yoga(left: number, top: number, width: number, height: number, display = 0) {
  return {
    getDisplay: () => display,
    getComputedLeft: () => left,
    getComputedTop: () => top,
    getComputedWidth: () => width,
    getComputedHeight: () => height,
    getComputedBorder: () => 0,
  };
}

describe('Ink renderer geometry capture', () => {
  it('intersects nested overflow clips at the same traversal coordinates as Ink', () => {
    const child = {
      nodeName: 'ink-box' as const,
      style: {},
      yogaNode: yoga(4, 2, 6, 3),
      childNodes: [],
    };
    const outer = {
      nodeName: 'ink-box' as const,
      style: { overflow: 'hidden' },
      yogaNode: yoga(2, 1, 6, 4),
      childNodes: [child],
    };
    const root = {
      nodeName: 'ink-root' as const,
      style: {},
      yogaNode: yoga(0, 0, 20, 10),
      childNodes: [outer],
    };
    const frame = captureInkLayout(root as unknown as InkDomElement, {
      output: '',
      outputHeight: 10,
      staticOutput: '',
    });
    expect(frame.geometry.get(child as unknown as InkDomElement)).toEqual({
      intended: { row: 3, column: 6, width: 6, height: 3 },
      visible: { row: 3, column: 6, width: 2, height: 2 },
      region: 'live',
    });
  });

  it('omits display-none subtrees and keeps Static in an independent region', () => {
    const hidden = {
      nodeName: 'ink-box' as const,
      style: { display: 'none' },
      yogaNode: yoga(0, 0, 5, 1, 1),
      childNodes: [],
    };
    const staticNode = {
      nodeName: 'ink-box' as const,
      internal_static: true,
      style: {},
      yogaNode: yoga(0, 0, 8, 1),
      childNodes: [],
    };
    const root = {
      nodeName: 'ink-root' as const,
      style: {},
      yogaNode: yoga(0, 0, 20, 4),
      childNodes: [hidden, staticNode],
      staticNode,
    };
    const frame = captureInkLayout(root as unknown as InkDomElement, {
      output: '',
      outputHeight: 4,
      staticOutput: 'history\n',
    });
    expect(frame.geometry.has(hidden as unknown as InkDomElement)).toBe(false);
    expect(frame.geometry.get(staticNode as unknown as InkDomElement)?.region).toBe('static');
    expect(frame.staticRows).toBe(1);
  });

  it('uses Yoga dimensions for wrapped and wide text instead of searching output', () => {
    const text = {
      nodeName: 'ink-text' as const,
      style: {},
      yogaNode: yoga(1, 2, 4, 2),
      childNodes: [{ nodeName: '#text' as const, nodeValue: '界界界' }],
    };
    const root = {
      nodeName: 'ink-root' as const,
      style: {},
      yogaNode: yoga(0, 0, 10, 5),
      childNodes: [text],
    };
    const frame = captureInkLayout(root as unknown as InkDomElement, {
      output: ' 界界\n 界',
      outputHeight: 5,
      staticOutput: '',
    });
    expect(frame.geometry.get(text as unknown as InkDomElement)?.intended).toEqual({
      row: 2,
      column: 1,
      width: 4,
      height: 2,
    });
  });
});
