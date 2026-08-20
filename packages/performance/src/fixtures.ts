import type { ProbeFrame, ProbeObject } from '@termwright/protocol';

export type RenderingMode = 'retained' | 'immediate';

export interface PerformanceScenario {
  readonly id: string;
  readonly framework: 'opentui' | 'ink';
  readonly renderingMode: RenderingMode;
  readonly description: string;
  readonly makeFrame: (frame: number, nodeCount: number) => ProbeFrame;
}

function rect(index: number): { row: number; column: number; width: number; height: number } {
  return {
    row: Math.floor(index / 10) * 3,
    column: (index % 10) * 11,
    width: 10,
    height: 2,
  };
}

function retainedOpenTuiFrame(frame: number, nodeCount: number): ProbeFrame {
  const objects: ProbeObject[] = [
    {
      identity: { kind: 'stable', value: 'root' },
      frameworkType: 'RootRenderable',
      geometry: { intendedRect: { row: 0, column: 0, width: 120, height: 40 } },
      paintOrder: 0,
    },
  ];

  for (let index = 1; index < nodeCount; index += 1) {
    const generic = index % 11 === 0;
    const selected = index === (frame % Math.max(1, nodeCount - 1)) + 1;
    objects.push({
      identity: { kind: 'stable', value: `widget-${index}` },
      frameworkType: generic
        ? 'ApplicationChartRenderable'
        : index % 7 === 0
          ? 'InputRenderable'
          : index % 5 === 0
            ? 'SelectRenderable'
            : 'TextRenderable',
      parent: 'root',
      geometry: { intendedRect: rect(index - 1) },
      state: {
        ...(selected ? { selected: true, focused: true } : {}),
        ...(index % 7 === 0 ? { value: `query-${frame % 10}` } : {}),
      },
      text: generic ? `chart ${index}` : `row ${index}`,
      paintOrder: index,
    });
  }

  return { frame, objects };
}

export const PERFORMANCE_SCENARIOS: readonly PerformanceScenario[] = Object.freeze([
  {
    id: 'opentui-retained-tree',
    framework: 'opentui',
    renderingMode: 'retained',
    description: 'stable retained objects with focus/value churn and explicit paint order',
    makeFrame: retainedOpenTuiFrame,
  },
]);
