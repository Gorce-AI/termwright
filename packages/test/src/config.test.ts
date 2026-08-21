import { afterEach, describe, expect, it } from 'vitest';
import type { UserConfig } from 'vitest/config';
import {
  XTERM_PALETTE,
  configureTermwright,
  defineTermwrightConfig,
  getTermwrightConfig,
  resetTermwrightConfig,
  resolveTermwrightConfig,
  termwrightProjects,
  termwrightRetry,
} from './config.js';

afterEach(() => {
  resetTermwrightConfig();
});

describe('termwrightRetry', () => {
  it('uses native Vitest additional-attempt counts for CI, local and env override', () => {
    expect(termwrightRetry({ env: {} })).toBe(0);
    expect(termwrightRetry({ ci: 3, env: { CI: 'true' } })).toBe(3);
    expect(termwrightRetry({ ci: 3, env: { CI: 'true', TERMWRIGHT_RETRIES: '1' } })).toBe(1);
    expect(termwrightRetry({ local: 2, env: { CI: 'false' } })).toBe(2);
  });

  it('rejects negative, fractional and unbounded retry counts', () => {
    for (const value of ['-1', '1.5', '101', 'nope']) {
      expect(() => termwrightRetry({ env: { TERMWRIGHT_RETRIES: value } })).toThrow(/integer from 0 to 100/u);
    }
  });
});

describe('defineTermwrightConfig', () => {
  it('returns the configuration unchanged', () => {
    const config = { columns: 120, rows: 40 };
    expect(defineTermwrightConfig(config)).toBe(config);
  });

  it('rejects impossible values, in profiles too', () => {
    expect(() => defineTermwrightConfig({ columns: 0 })).toThrow(/columns must be a positive number/u);
    expect(() => defineTermwrightConfig({ timeouts: { expect: -1 } })).toThrow(/timeouts.expect/u);
    expect(() => defineTermwrightConfig({ command: [] })).toThrow(/must not be empty/u);
    expect(() => defineTermwrightConfig({ requiredCapabilities: ['made-up' as never] })).toThrow(/unknown capability/u);
    expect(() => defineTermwrightConfig({ requiredCapabilities: ['semantic-tree', 'semantic-tree'] })).toThrow(/duplicate capability/u);
    expect(() => defineTermwrightConfig({ trace: 'sometimes' as never })).toThrow(/config.trace must be one of/u);
    expect(() => defineTermwrightConfig({ profiles: { ci: { rows: -5 } } })).toThrow(/profiles.ci.rows/u);
    expect(() =>
      defineTermwrightConfig({ palette: { name: 'short', colors: ['#000000'] } }),
    ).toThrow(/exactly 16 entries/u);
  });
});

describe('resolveTermwrightConfig', () => {
  it('fills in the documented defaults', () => {
    const config = resolveTermwrightConfig({}, {});
    expect(config.columns).toBe(100);
    expect(config.rows).toBe(30);
    expect(config.trace).toBe('retain-on-failure');
    expect(config.snapshotDir).toBe('__snapshots__');
    expect(config.timeouts.expect).toBe(5_000);
    expect(config.requiredCapabilities).toEqual([]);
    expect(config.profile).toBeUndefined();
  });

  it('applies the profile named by TERMWRIGHT_PROFILE', () => {
    const config = resolveTermwrightConfig(
      { rows: 30, profiles: { ci: { rows: 50, trace: 'on', palette: XTERM_PALETTE } } },
      { TERMWRIGHT_PROFILE: 'ci' },
    );
    expect(config.rows).toBe(50);
    expect(config.trace).toBe('on');
    expect(config.profile).toBe('ci');
    expect(config.snapshotDir).toBe('__snapshots__/ci');
    expect(config.env['TERM']).toBe('xterm-256color');
  });

  it('freezes project capability requirements for every fixture launch', () => {
    const config = resolveTermwrightConfig({ requiredCapabilities: ['semantic-tree', 'paired-revisions'] }, {});
    expect(config.requiredCapabilities).toEqual(['semantic-tree', 'paired-revisions']);
    expect(Object.isFrozen(config.requiredCapabilities)).toBe(true);
  });

  it('lets explicit env win over the palette env', () => {
    const config = resolveTermwrightConfig({ palette: XTERM_PALETTE, env: { TERM: 'dumb' } }, {});
    expect(config.env['TERM']).toBe('dumb');
    expect(config.env['COLORTERM']).toBe('truecolor');
  });

  it('refuses to run against a profile that does not exist', () => {
    expect(() => resolveTermwrightConfig({ profiles: { ci: {} } }, { TERMWRIGHT_PROFILE: 'nope' })).toThrow(
      /does not match any configured profile \(ci\)/u,
    );
  });

  it('merges timeout classes instead of replacing them', () => {
    const config = resolveTermwrightConfig({ timeouts: { expect: 100 } }, {});
    expect(config.timeouts).toEqual({ action: 5_000, text: 5_000, idle: 2_000, ready: 10_000, exit: 10_000, expect: 100 });
  });
});

describe('termwrightProjects', () => {
  it('maps named profiles to inherited Vitest projects', () => {
    const config = defineTermwrightConfig({ profiles: { compact: { columns: 80 }, wide: { columns: 140 } } });
    expect(termwrightProjects(config)).toEqual([
      { extends: true, test: { name: 'compact', env: { TERMWRIGHT_PROFILE: 'compact' } } },
      { extends: true, test: { name: 'wide', env: { TERMWRIGHT_PROFILE: 'wide' } } },
    ]);
    const vitest: UserConfig = { test: { projects: [...termwrightProjects(config)] } };
    expect(vitest.test?.projects).toHaveLength(2);
  });

  it('rejects missing and duplicate profile names', () => {
    const config = defineTermwrightConfig({ profiles: { compact: {} } });
    expect(() => termwrightProjects(config, ['missing'])).toThrow('cannot find profile');
    expect(() => termwrightProjects(config, ['compact', 'compact'])).toThrow('duplicate profile');
  });
});

describe('configureTermwright', () => {
  it('installs the configuration every fixture and matcher reads', () => {
    expect(getTermwrightConfig().columns).toBe(100);
    configureTermwright({ columns: 132, command: ['node', 'app.js'] });
    expect(getTermwrightConfig().columns).toBe(132);
    expect(getTermwrightConfig().command).toEqual(['node', 'app.js']);
    resetTermwrightConfig();
    expect(getTermwrightConfig().columns).toBe(100);
  });
});
