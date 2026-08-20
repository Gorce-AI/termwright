import { describe, expect, it } from 'vitest';
import {
  FRAMEWORK_OBSERVATION_CAPABILITIES,
  FRAMEWORK_OPERATION_CAPABILITIES,
  frameworkObservationCapabilities,
} from './index.js';

describe('framework observation capability registry', () => {
  it('has one complete, reasoned row per supported execution family', () => {
    expect(FRAMEWORK_OBSERVATION_CAPABILITIES.map((row) => row.framework)).toEqual([
      'generic', 'textual', 'opentui', 'ink', 'tview', 'ratatui', 'charm',
    ]);
    for (const row of FRAMEWORK_OBSERVATION_CAPABILITIES) {
      expect(row.reason.length).toBeGreaterThan(20);
      expect(['supported', 'conditional', 'unsupported']).toContain(row.displayed);
      expect(['supported', 'conditional', 'unsupported']).toContain(row.intendedRect);
      expect(['supported', 'conditional', 'unsupported']).toContain(row.visibleRect);
      expect(['supported', 'conditional', 'unsupported']).toContain(row.hitTest);
    }
  });

  it('publishes exact point ownership only for frameworks whose routing API proves it', () => {
    expect(FRAMEWORK_OBSERVATION_CAPABILITIES.filter((row) => row.hitTest === 'supported').map((row) => row.framework))
      .toEqual(['textual', 'opentui']);
  });

  it('does not invent entries for unknown frameworks', () => {
    expect(frameworkObservationCapabilities('future-ui')).toBeUndefined();
  });

  it('derives one reasoned operation row per framework and operation', () => {
    const operations = new Set(FRAMEWORK_OPERATION_CAPABILITIES.map((row) => row.operation));
    expect(operations.size).toBe(13);
    expect(FRAMEWORK_OPERATION_CAPABILITIES).toHaveLength(
      FRAMEWORK_OBSERVATION_CAPABILITIES.length * operations.size,
    );
    expect(new Set(FRAMEWORK_OPERATION_CAPABILITIES.map((row) => `${row.framework}:${row.operation}`)).size)
      .toBe(FRAMEWORK_OPERATION_CAPABILITIES.length);
    expect(FRAMEWORK_OPERATION_CAPABILITIES.every((row) => row.reason.length > 20)).toBe(true);
    // Even exact ownership cannot make a PTY mouse sequence work unless the
    // application enabled terminal mouse reporting.
    expect(FRAMEWORK_OPERATION_CAPABILITIES.filter((row) => row.operation === 'pointer-actions' && row.availability === 'supported'))
      .toEqual([]);
  });
});
