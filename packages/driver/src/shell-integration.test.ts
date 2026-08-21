import {describe, expect, it} from 'vitest';
import {
  posixShellBootstrap,
  powershellBootstrap,
  wrapPosixShellCommand,
  wrapPowerShellCommand,
} from './shell-integration.js';

describe('managed shell integration', () => {
  it('boots both shells into an exact OSC 133 prompt', () => {
    for (const bootstrap of [posixShellBootstrap(), powershellBootstrap()]) {
      expect(bootstrap).toContain(']133;A');
      expect(bootstrap).toContain(']133;B');
    }
  });

  it('single-quotes a POSIX command inside eval', () => {
    expect(wrapPosixShellCommand("printf '%s' \"it's safe\"")).toContain("it'\\''s safe");
  });

  it('single-quotes a PowerShell command inside a scriptblock', () => {
    const wrapped = wrapPowerShellCommand("Write-Output 'it''s safe'");
    expect(wrapped).toContain("Write-Output ''it''''s safe''");
    expect(wrapped).toContain('$LASTEXITCODE');
    expect(wrapped).toContain(']133;D;');
    expect(wrapped).toContain(']7;file://localhost/');
  });
});
