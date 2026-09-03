import { describe, expect, it } from 'vitest';
import { renderDocument, renderResourceProfiles } from './generate-resource-profile-docs.mjs';

const profiles = {
  local: {
    name: 'local',
    scheduler: { pool: 'forks', maxWorkers: 4, fileParallelism: true },
    capacities: {
      ptySession: 4,
      externalProcess: 4,
      semanticEndpoint: 4,
      nativeHostPressure: 4,
      traceWriter: 4,
    },
    perTerminal: { semanticEndpoint: 1, nativeHostPressure: 1 },
  },
};

describe('resource profile documentation generator', () => {
  it('lists policies without presenting adaptive limits as fixed numbers', () => {
    expect(renderResourceProfiles(profiles)).toContain(
      '| `local` | Normal development | Host-derived |',
    );
  });

  it('replaces exactly one marked block', () => {
    const document =
      'before\n<!-- BEGIN GENERATED RESOURCE PROFILES -->\nstale\n<!-- END GENERATED RESOURCE PROFILES -->\nafter\n';
    expect(renderDocument(document, 'current', 'configuration.md')).toBe(
      'before\n<!-- BEGIN GENERATED RESOURCE PROFILES -->\ncurrent\n<!-- END GENERATED RESOURCE PROFILES -->\nafter\n',
    );
  });

  it('rejects a profile without resource capacities', () => {
    expect(() =>
      renderResourceProfiles({
        ...profiles,
        ci: {
          name: 'ci',
          scheduler: { pool: 'forks', maxWorkers: 2, fileParallelism: true },
          capacities: {},
          perTerminal: { semanticEndpoint: 1 },
        },
      }),
    ).toThrow(/must declare capacities/u);
  });
});
