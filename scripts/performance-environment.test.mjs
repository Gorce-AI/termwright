import { describe, expect, it } from 'vitest';
import {
  qualifyPerformanceEnvironment,
  validatePerformanceEnvironment,
} from './performance-environment.mjs';

const runnerClass = 'darwin-arm64-node24-go1.25-bun1.2.15';
const observed = {
  runnerImage: 'macos-15',
  platform: 'darwin',
  arch: 'arm64',
  nodeVersion: '24.7.0',
  goVersion: '1.25.1',
  bunVersion: '1.2.15',
};

describe('performance environment qualification', () => {
  it('records resolved toolchains under the declared comparable class', () => {
    const descriptor = qualifyPerformanceEnvironment(runnerClass, observed);
    expect(descriptor).toMatchObject({
      class: runnerClass,
      runner: { image: 'macos-15', platform: 'darwin', arch: 'arm64' },
      toolchains: {
        node: { qualified: '24', resolved: '24.7.0' },
        go: { qualified: '1.25', resolved: '1.25.1' },
        bun: { qualified: '1.2.15', resolved: '1.2.15' },
      },
    });
    expect(() => validatePerformanceEnvironment(descriptor, {
      platform: 'darwin', arch: 'arm64', nodeVersion: '24.7.0',
    })).not.toThrow();
  });

  it('rejects the Go 1.24 seed and every other mismatched toolchain class', () => {
    expect(() => qualifyPerformanceEnvironment(runnerClass, {
      ...observed,
      goVersion: '1.24.4',
    })).toThrow(/requires goLine=1\.25, observed 1\.24/u);
    expect(() => qualifyPerformanceEnvironment(runnerClass, {
      ...observed,
      bunVersion: '1.2.14',
    })).toThrow(/requires bunVersion=1\.2\.15/u);
  });

  it('rejects non-canonical qualified fields even when resolved versions are valid', () => {
    const descriptor = qualifyPerformanceEnvironment(runnerClass, observed);
    descriptor.toolchains.go.qualified = '1.24';
    expect(() => validatePerformanceEnvironment(descriptor, {
      platform: 'darwin', arch: 'arm64', nodeVersion: '24.7.0',
    })).toThrow(/go qualification is not canonical/u);
  });
});
