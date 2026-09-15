import { describe, expect, it } from 'vitest';
import type { ScreenFrame } from '@termwright/screenshot';
import { renderPng } from '@termwright/screenshot';
import type { SemanticSnapshot } from './model.js';
import { renderScreenshot } from './screenshots.js';

const evidence = {
  source: 'framework',
  method: 'native',
  strength: 'authoritative',
  providerId: 'test',
} as const;
const rect = (row: number, column: number, width: number, height = 1) => ({
  row,
  column,
  width,
  height,
});
const geometry = (bounds: ReturnType<typeof rect>) => ({
  displayed: { status: 'known', value: true, evidence } as const,
  intendedRect: { status: 'known', value: bounds, evidence } as const,
  visibleRect: { status: 'known', value: bounds, evidence } as const,
});

function textFrame(text: string): ScreenFrame {
  const chars = [...text.padEnd(30, ' ')];
  return {
    columns: 30,
    rows: 1,
    cell(_row, column) {
      return {
        char: chars[column] ?? ' ',
        width: 1,
        fg: { kind: 'default' },
        bg: { kind: 'default' },
        attributes: {
          bold: false,
          dim: false,
          italic: false,
          underline: false,
          inverse: false,
          strikethrough: false,
        },
      };
    },
  };
}

function overlappingModal(owner: string): SemanticSnapshot {
  return {
    v: 3,
    sessionId: 's',
    revision: 1,
    columns: 30,
    rows: 1,
    rootIds: ['prompt', 'modal'],
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence },
    nodes: [
      {
        id: 'prompt',
        role: 'textbox',
        name: 'Prompt',
        geometry: geometry(rect(0, 0, 30)),
        value: { status: 'known', value: 'private value', sensitivity: 'sensitive', evidence },
      },
      {
        id: 'modal',
        role: 'dialog',
        name: 'Account actions',
        geometry: geometry(rect(0, 0, 30)),
        state: { modal: true },
      },
      {
        id: 'message',
        parentId: 'modal',
        role: 'text',
        name: 'Full sign-in link copied.',
        geometry: geometry(rect(0, 0, 30)),
        value: {
          status: 'known',
          value: 'Full sign-in link copied.',
          sensitivity: 'public',
          evidence,
        },
      },
    ],
    hitGrid: {
      status: 'known',
      value: { regions: [{ recipientId: owner, rect: rect(0, 0, 25) }] },
      evidence,
    },
  };
}

describe('layer-aware screenshot redaction', () => {
  it('preserves matching modal text over a sensitive background with authoritative ownership', () => {
    const frame = textFrame('Full sign-in link copied.');
    const image = renderScreenshot(frame, { semantic: overlappingModal('message') });
    expect(image.redactions).toEqual([
      { rect: rect(0, 25, 5), nodeId: 'prompt', reason: 'sensitive-value' },
    ]);
    expect(Buffer.from(image.data, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(Buffer.from(image.data, 'base64')).toEqual(
      Buffer.from(
        renderPng(frame, {
          maskRects: [rect(0, 25, 5)],
        }).png,
      ),
    );
  });

  it('masks the full sensitive region when paint ownership is uncertain', () => {
    const frame = textFrame('Full sign-in link copied.');
    for (const semantic of [
      overlappingModal('prompt'),
      {
        ...overlappingModal('message'),
        columns: 31,
      },
    ]) {
      const image = renderScreenshot(frame, { semantic });
      expect(image.redactions).toEqual([
        { rect: rect(0, 0, 30), nodeId: 'prompt', reason: 'sensitive-value' },
      ]);
      expect(Buffer.from(image.data, 'base64')).toEqual(
        Buffer.from(
          renderPng(frame, {
            maskRects: [rect(0, 0, 30)],
          }).png,
        ),
      );
    }
  });

  it('coalesces adjacent rows of the same sensitive field in redaction metadata', () => {
    const oneRow = textFrame('private value');
    const frame: ScreenFrame = { ...oneRow, rows: 2, cell: oneRow.cell };
    const semantic: SemanticSnapshot = {
      ...overlappingModal('prompt'),
      rows: 2,
      nodes: [
        {
          id: 'prompt',
          role: 'textbox',
          name: 'Prompt',
          geometry: geometry(rect(0, 0, 30, 2)),
          value: { status: 'known', value: 'private value', sensitivity: 'sensitive', evidence },
        },
      ],
      rootIds: ['prompt'],
    };
    expect(renderScreenshot(frame, { semantic }).redactions).toEqual([
      { rect: rect(0, 0, 30, 2), nodeId: 'prompt', reason: 'sensitive-value' },
    ]);
  });
});
