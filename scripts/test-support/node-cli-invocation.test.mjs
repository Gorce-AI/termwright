import { describe, expect, it } from 'vitest';
import { npmInvocation, vitestInvocation } from './node-cli-invocation.mjs';

describe('shell-free Node CLI invocation', () => {
  it('runs npm through the current Node distribution on Windows', () => {
    expect(npmInvocation({ platform: 'win32', execPath: 'C:\\node\\node.exe' })).toEqual({
      file: 'C:\\node\\node.exe',
      args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js'],
    });
  });

  it('uses the ordinary executable on POSIX', () => {
    expect(npmInvocation({ platform: 'linux', execPath: '/node/bin/node' })).toEqual({
      file: 'npm',
      args: [],
    });
  });

  it('runs Vitest through Node on every platform', () => {
    expect(vitestInvocation('/work/project', '/node/bin/node', 'linux')).toEqual({
      file: '/node/bin/node',
      args: ['/work/project/node_modules/vitest/vitest.mjs'],
    });
    expect(vitestInvocation('D:\\work\\project', 'C:\\node\\node.exe', 'win32')).toEqual({
      file: 'C:\\node\\node.exe',
      args: ['D:\\work\\project\\node_modules\\vitest\\vitest.mjs'],
    });
  });
});
