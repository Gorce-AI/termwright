import { describe, expect, it } from 'vitest';
import {
  integratedPowerShellCommand,
  posixShellBootstrap,
  powershellStartupCommand,
  wrapPosixShellCommand,
  wrapPowerShellCommand,
} from './shell-integration.js';

describe('managed shell integration', () => {
  it('boots both shells into an exact OSC 133 prompt', () => {
    for (const bootstrap of [posixShellBootstrap(), powershellStartupCommand()]) {
      expect(bootstrap).toContain(']133;A');
      expect(bootstrap).toContain(']133;B');
    }
  });

  it('installs PowerShell integration through its startup command', () => {
    expect(integratedPowerShellCommand(['pwsh.exe', '-NoLogo', '-NoProfile'])).toEqual([
      'pwsh.exe',
      '-NoLogo',
      '-NoProfile',
      '-NoExit',
      '-Command',
      powershellStartupCommand(),
    ]);
    expect(integratedPowerShellCommand(['pwsh.exe', '-NoExit'])).toEqual([
      'pwsh.exe',
      '-NoExit',
      '-Command',
      powershellStartupCommand(),
    ]);
    expect(
      integratedPowerShellCommand([
        'pwsh.exe',
        '-ExecutionPolicy',
        'Bypass',
        '-WorkingDirectory',
        'C:\\work',
      ]),
    ).toEqual([
      'pwsh.exe',
      '-ExecutionPolicy',
      'Bypass',
      '-WorkingDirectory',
      'C:\\work',
      '-NoExit',
      '-Command',
      powershellStartupCommand(),
    ]);
  });

  it('refuses every non-allowlisted startup argument, including legal aliases and abbreviations', () => {
    for (const option of [
      '-Command',
      '-CommandWithArgs',
      '-c',
      '-cwa',
      '-Com',
      '-EncodedCommand',
      '-e',
      '-ec',
      '-Enc',
      '-File',
      '-f',
      '-Fi',
      '-NonInteractive',
      '-Noni',
      'script.ps1',
    ]) {
      expect(() => integratedPowerShellCommand(['pwsh.exe', option, 'something'])).toThrow(
        TypeError,
      );
    }
  });

  it('validates the arity of safe PowerShell startup options', () => {
    expect(() => integratedPowerShellCommand(['pwsh.exe', '-ExecutionPolicy'])).toThrow(TypeError);
    expect(() =>
      integratedPowerShellCommand(['pwsh.exe', '-WorkingDirectory', '-NoProfile']),
    ).toThrow(TypeError);
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
