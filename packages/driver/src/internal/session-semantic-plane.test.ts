import { describe, expect, it } from 'vitest';
import type { SemanticAttachment } from '../semantic.js';
import { buildSessionContract } from './session-semantic-plane.js';

describe('buildSessionContract', () => {
  it('freezes a generic terminal contract without starting a host', () => {
    const contract = buildSessionContract({
      sessionId: 'session:test',
      attachment: null,
      terminalProfile: 'xterm-256color',
      platform: 'linux',
    });
    expect(contract).toMatchObject({
      contractId: 'session:test:0',
      framework: null,
      terminal: { platform: 'linux', mouseModesObservable: true },
      capabilities: {
        'keyboard-input': { status: 'supported' },
        'semantic-tree': { status: 'unsupported', reason: 'not-negotiated' },
      },
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract.providers.map((provider) => provider.id)).toEqual(['termwright-vt']);
  });

  it('treats the certified Windows passthrough stream as mode-observable', () => {
    const contract = buildSessionContract({
      sessionId: 'session:windows',
      attachment: null,
      terminalProfile: 'xterm-256color',
      platform: 'win32',
    });

    expect(contract.terminal.mouseModesObservable).toBe(true);
    expect(contract.capabilities['pointer-input']).toMatchObject({
      status: 'supported',
      evidence: { source: 'terminal', method: 'native' },
    });
    expect(contract.capabilities['focus-input']).toMatchObject({
      status: 'supported',
      evidence: { source: 'terminal', method: 'native' },
    });
  });

  it('attributes provider-backed capabilities to application evidence', () => {
    const attachment = {
      adapter: { name: 'ink', version: '5' },
      probe: {
        framework: 'ink',
        frameworkVersion: '5.1',
        capabilities: ['tree'],
        instrumentation: { highestTier: 'T3', semanticClass: 'A', degradedCapabilities: [] },
      },
      capabilities: ['tree'],
      providers: [
        {
          id: 'app-router',
          version: '1',
          method: 'native',
          capabilities: ['hit-test'],
        },
      ],
    } as unknown as SemanticAttachment;
    const contract = buildSessionContract({
      sessionId: 'session:test',
      attachment,
      terminalProfile: 'default',
      platform: 'win32',
      modesObservable: false,
    });
    expect(contract.framework).toMatchObject({
      name: 'ink',
      version: '5.1',
      instrumentation: { highestTier: 'T3', semanticClass: 'A', degradedCapabilities: [] },
    });
    expect(Object.isFrozen(contract.framework?.instrumentation)).toBe(true);
    expect(Object.isFrozen(contract.framework?.instrumentation?.degradedCapabilities)).toBe(true);
    expect(contract.capabilities['pointer-hit-testing']).toMatchObject({
      status: 'supported',
      evidence: { source: 'application', providerId: 'app-router' },
    });
    expect(contract.capabilities['pointer-input']).toMatchObject({
      status: 'unsupported',
      reason: 'terminal-unobservable',
    });
  });
});
