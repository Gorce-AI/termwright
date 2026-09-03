import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/test-provider-internal';
import {
  CapabilityProviderLostError,
  CapabilityProviderViolationError,
  CapabilityUnavailableError,
  EvidenceConflictError,
  InputModeDisabledError,
  launchTerminal,
} from '@termwright/driver';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const providerApp = join(packageRoot, 'src', 'testing', 'provider-app.mjs');
const preload = pathToFileURL(join(packageRoot, 'dist', 'node-hook.js')).href;
const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });

describe('Ink application evidence provider over a real PTY', { timeout: 60_000 }, () => {
  it('fails launch when pointer hit testing is required without a provider', async () => {
    const vanilla = join(packageRoot, 'src', 'testing', 'vanilla-app.mjs');
    const failure = await launchTerminal({
      command: [process.execPath, '--import', preload, vanilla],
      columns: 40,
      rows: 8,
      requiredCapabilities: ['pointer-hit-testing'],
      semanticNegotiationMs: 5_000,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CapabilityUnavailableError);
  });

  it('routes a high-level click through normal PTY mouse bytes', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      requiredCapabilities: ['semantic-tree', 'pointer-geometry', 'pointer-hit-testing'],
      semanticNegotiationMs: 5_000,
    });
    try {
      await terminal.settled();
      expect(terminal.terminalState.snapshot().modes).toMatchObject({
        mouseTracking: 'drag',
        mouseEncoding: 'sgr',
        focusReporting: 'off',
      });
      await terminal.getByRole('button', { name: '[Reject]' }).click();
      await terminal.waitForText('last: reject');
      expect(terminal.contract()?.capabilities['pointer-hit-testing']).toMatchObject({
        status: 'supported',
        evidence: { providerId: 'permission-production-router' },
      });
    } finally {
      await terminal.close();
    }
  });

  it('uses production parser mode evidence when the terminal transport hides DEC modes', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      modesObservable: false,
      requiredCapabilities: [
        'semantic-tree',
        'pointer-geometry',
        'pointer-hit-testing',
        'pointer-input',
      ],
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_PROVIDER_SCENARIO: 'input-mode' },
    });
    try {
      await terminal.getByRole('button', { name: '[Reject]' }).click();
      await terminal.waitForText('last: reject@');
      expect(terminal.contract()?.capabilities['pointer-input']).toMatchObject({
        status: 'supported',
        evidence: { providerId: 'permission-production-input-parser' },
      });
    } finally {
      await terminal.close();
    }
  });

  it('delivers provider-proven focus reports through the real PTY parser path', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      modesObservable: false,
      requiredCapabilities: ['semantic-tree', 'focus-input'],
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_PROVIDER_SCENARIO: 'input-mode-focus' },
    });
    try {
      await terminal.settled();
      expect(terminal.terminalState.snapshot().modes.focusReporting).toBe('on');
      await terminal.window.focus();
      await terminal.waitForText('last: terminal focused');
      await terminal.window.blur();
      await terminal.waitForText('last: terminal blurred');
      expect(terminal.contract()?.capabilities['focus-input']).toMatchObject({
        status: 'supported',
        evidence: { providerId: 'permission-production-input-parser' },
      });
    } finally {
      await terminal.close();
    }
  });

  it('does not reuse stale mode evidence after its provider disappears', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      modesObservable: false,
      requiredCapabilities: ['semantic-tree', 'pointer-input'],
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_PROVIDER_SCENARIO: 'input-mode' },
    });
    try {
      await terminal.settled();
      const providerFailure = new Promise<void>((resolve) => {
        const unsubscribe = terminal.events.on('diagnostic', (diagnostic) => {
          if (diagnostic.code === 'adapter-guarantee-violation') {
            unsubscribe();
            resolve();
          }
        });
      });
      await terminal.keyboard.press('i');
      await terminal.waitForText('last: input mode provider disposed');
      await providerFailure;
      await expect(terminal.mouse.click({ row: 1, column: 1 })).rejects.toBeInstanceOf(
        CapabilityProviderLostError,
      );
    } finally {
      await terminal.close();
    }
  });

  it('does not encode a second click from mode evidence the first click invalidated', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      modesObservable: false,
      requiredCapabilities: ['semantic-tree', 'pointer-input'],
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_PROVIDER_SCENARIO: 'input-mode-revoked' },
    });
    try {
      await terminal.settled();
      await terminal.mouse.click({ row: 1, column: 1 });
      // Deliberately no wait between the two clicks. The application turns
      // mouse tracking off while handling the first one, and the terminal
      // hides its own modes, so the only thing that can say so is the
      // provider frame published afterwards. Reading the pre-click evidence
      // here would encode SGR bytes for a mode the application just
      // disabled, which the program would print as text.
      await expect(terminal.mouse.click({ row: 1, column: 1 })).rejects.toBeInstanceOf(
        InputModeDisabledError,
      );
    } finally {
      await terminal.close();
    }
  });

  it('fails closed when production parser modes disagree with observable VT modes', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      modesObservable: true,
      requiredCapabilities: ['semantic-tree', 'pointer-input'],
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_PROVIDER_SCENARIO: 'input-mode-conflict' },
    });
    try {
      await expect(terminal.settled()).rejects.toBeInstanceOf(EvidenceConflictError);
    } finally {
      await terminal.close();
    }
  });

  it('carries revision-bound application scroll evidence through the real semantic channel', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      requiredCapabilities: ['semantic-tree', 'scroll', 'painted-region'],
      semanticNegotiationMs: 5_000,
    });
    try {
      const viewport = terminal.getByRole('button', { name: '[Approve]' });
      expect(await viewport.semanticScroll()).toMatchObject({
        status: 'known',
        value: { axis: 'vertical', offset: 0, viewport: 4, extent: 10 },
        evidence: { providerId: 'permission-production-scroll' },
      });
      expect(await viewport.paintedRegion()).toMatchObject({
        status: 'known',
        value: {
          regionBounds: { row: 1, column: 0, width: 9, height: 1 },
          spans: [{ row: 1, from: 0, to: 9 }],
        },
        evidence: { providerId: 'permission-production-painter' },
      });
      const before = viewport.checkpoint();
      await terminal.keyboard.press('m');
      let stamp = before;
      let changed = await viewport.semanticScroll();
      const deadline = performance.now() + 5_000;
      while (!(changed.status === 'known' && changed.value.offset === 2)) {
        stamp = await viewport.waitForCheckpointChange({
          after: stamp,
          timeout: Math.max(1, deadline - performance.now()),
        });
        changed = await viewport.semanticScroll();
      }
      expect(changed).toMatchObject({
        status: 'known',
        value: { offset: 2 },
      });
      expect(terminal.contract()?.capabilities.scroll).toMatchObject({
        status: 'supported',
        evidence: { providerId: 'permission-production-scroll' },
      });
    } finally {
      await terminal.close();
    }
  });

  it('uses an explicit authoritative production-region contract without a negotiated hit test', async () => {
    const terminal = await launchProvider('region-only', false);
    try {
      const receipt = await terminal.getByRole('button', { name: '[Reject]' }).click();
      await terminal.waitForText('last: reject@');
      expect(terminal.contract()?.capabilities['pointer-hit-testing'].status).toBe('unsupported');
      expect(
        receipt.plan?.requirements.find(({ condition }) => condition.kind === 'receives-pointer'),
      ).toMatchObject({
        verdict: 'satisfied',
        observation: { evidence: { method: 'declared' } },
      });
    } finally {
      await terminal.close();
    }
  });

  it('preserves modifier-click evidence while the production router receives PTY bytes', async () => {
    const terminal = await launchProvider();
    try {
      const receipt = await terminal.getByRole('button', { name: '[Reject]' }).click({
        modifiers: ['control', 'shift', 'alt'],
      });
      await terminal.waitForText('last: reject@');
      expect(receipt.executed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'down',
            modifiers: ['shift', 'alt', 'control'],
          }),
          expect.objectContaining({
            kind: 'up',
            modifiers: ['shift', 'alt', 'control'],
          }),
        ]),
      );
    } finally {
      await terminal.close();
    }
  });

  it('uses fresh provider evidence after a semantic target moves', async () => {
    const terminal = await launchProvider();
    try {
      await terminal.keyboard.press('m');
      await terminal.waitForText('last: moved@19');
      const receipt = await terminal.getByRole('button', { name: '[Reject]' }).click();
      await terminal.waitForText('last: reject@');
      expect(receipt.plan?.checkpoint.semanticRevision).toBe(receipt.before.semanticRevision);
      expect(receipt.plan?.physicalRegion?.spans).toEqual([
        expect.objectContaining({ row: 1, from: 19, to: 27 }),
      ]);
    } finally {
      await terminal.close();
    }
  });

  it('replans from the committed provider revision after resize', async () => {
    const terminal = await launchProvider('resize');
    try {
      await terminal.resize({ columns: 60, rows: 8 });
      await terminal.waitForText('last: resize 60 reject@27');
      const receipt = await terminal.getByRole('button', { name: '[Reject]' }).click();
      await terminal.waitForText('last: reject@');
      expect(receipt.plan?.physicalRegion?.spans).toEqual([
        expect.objectContaining({ row: 1, from: 27, to: 35 }),
      ]);
    } finally {
      await terminal.close();
    }
  });

  it('chooses a reachable cell from a partially clipped production region', async () => {
    const terminal = await launchProvider('clipped');
    try {
      const receipt = await terminal.getByRole('button', { name: '[Reject]' }).click();
      await terminal.waitForText('last: reject@');
      expect(receipt.plan?.physicalRegion).toMatchObject({
        intendedRect: { row: 1, column: 38, width: 8, height: 1 },
        spans: [{ row: 1, from: 38, to: 40 }],
      });
      expect(receipt.executed[0]).toMatchObject({
        row: 1,
        column: expect.any(Number),
      });
      expect((receipt.executed[0] as { column: number }).column).toBeGreaterThanOrEqual(38);
    } finally {
      await terminal.close();
    }
  });

  it('routes stepped semantic drag through the production PTY input path', async () => {
    const terminal = await launchProvider();
    try {
      const receipt = await terminal
        .getByRole('button', { name: '[Approve]' })
        .dragTo(terminal.getByRole('button', { name: '[Reject]' }), {
          steps: 6,
        });
      await terminal.waitForText('last: drag [Approve]->[Reject]');
      expect(receipt.executed.filter((step) => step.kind === 'move')).toHaveLength(6);
    } finally {
      await terminal.close();
    }
  });

  it('routes semantic hover through any-event mouse reporting', async () => {
    const terminal = await launchProvider('hover');
    try {
      const receipt = await terminal.getByRole('button', { name: '[Reject]' }).hover();
      await terminal.waitForText('last: hover [Reject]@');
      expect(receipt.executed).toEqual([expect.objectContaining({ kind: 'move', row: 1 })]);
    } finally {
      await terminal.close();
    }
  });

  it('fails closed when a provider disappears after the contract freezes', async () => {
    const terminal = await launchProvider();
    try {
      // The status text and provider lifecycle travel over different causal
      // channels. Arm the authoritative diagnostic before input and require
      // it before asserting the typed failure; screen paint alone cannot
      // prove that the provider registry has committed the loss.
      const providerFailure = new Promise<void>((resolve) => {
        const unsubscribe = terminal.events.on('diagnostic', (diagnostic) => {
          if (diagnostic.code === 'adapter-guarantee-violation') {
            unsubscribe();
            resolve();
          }
        });
      });
      await terminal.keyboard.press('l');
      await terminal.waitForText('last: provider disposed');
      await providerFailure;
      await expect(
        terminal.getByRole('button', { name: '[Reject]' }).click(),
      ).rejects.toBeInstanceOf(CapabilityProviderLostError);
    } finally {
      await terminal.close();
    }
  });

  it('fails closed for an opaque Ink child when the terminal hides input modes', async () => {
    // The ConPTY condition, reproduced on every platform: the terminal hides
    // its DEC modes. Ink's stream shadow is not authoritative because direct
    // descriptor/native writes and descendants can bypass it, so the adapter
    // must not promote those observed bytes into terminal-input-modes evidence.
    const terminal = await launchTerminal({
      command: [process.execPath, '--import', preload, providerApp],
      columns: 40,
      rows: 8,
      modesObservable: false,
      requiredCapabilities: ['semantic-tree', 'pointer-geometry', 'pointer-hit-testing'],
      semanticNegotiationMs: 5_000,
      env: { TERMWRIGHT_PROVIDER_SCENARIO: 'opaque-input-modes' },
    });
    try {
      await terminal.settled();
      expect(terminal.contract()?.capabilities['pointer-input']).toMatchObject({
        status: 'unsupported',
        reason: 'terminal-unobservable',
      });
      expect(terminal.contract()?.capabilities['focus-input']).toMatchObject({
        status: 'unsupported',
        reason: 'terminal-unobservable',
      });
      const physicalInputs: string[] = [];
      terminal.events.on('input', ({ kind }) => physicalInputs.push(kind));
      await expect(
        terminal.getByRole('button', { name: '[Reject]' }).click(),
      ).rejects.toBeInstanceOf(CapabilityUnavailableError);
      await expect(terminal.window.focus()).rejects.toBeInstanceOf(InputModeDisabledError);
      expect(physicalInputs).toEqual([]);
    } finally {
      await terminal.close();
    }
  });

  it('fails closed when declared regions disagree with the production hit test', async () => {
    const terminal = await launchProvider('disagreement');
    try {
      await expect(
        terminal.getByRole('button', { name: '[Reject]' }).click(),
      ).rejects.toBeInstanceOf(CapabilityProviderViolationError);
    } finally {
      await terminal.close();
    }
  });
});

async function launchProvider(scenario = 'baseline', requireHitTest = true) {
  return launchTerminal({
    command: [process.execPath, '--import', preload, providerApp],
    columns: 40,
    rows: 8,
    requiredCapabilities: [
      'semantic-tree',
      'pointer-geometry',
      ...(requireHitTest ? ['pointer-hit-testing' as const] : []),
    ],
    semanticNegotiationMs: 5_000,
    env: { TERMWRIGHT_PROVIDER_SCENARIO: scenario },
  });
}
