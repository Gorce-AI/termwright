import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CapabilityProviderLostError,
  CapabilityProviderViolationError,
  CapabilityUnavailableError,
  launchTerminal,
} from '@termwright/driver';

const exec = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = join(packageRoot, '..', '..');
const providerApp = join(packageRoot, 'src', 'testing', 'provider-app.mjs');
const preload = pathToFileURL(join(packageRoot, 'dist', 'node-hook.js')).href;

async function buildRuntime(): Promise<void> {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  await exec(pnpm, ['--filter', '@termwright/evidence-provider', 'build'], { cwd: workspaceRoot });
  await exec(pnpm, ['--filter', '@termwright/probe-runtime', 'build'], { cwd: workspaceRoot });
  await exec(pnpm, ['--filter', '@termwright/probe-ink', 'build'], { cwd: workspaceRoot });
}

describe('Ink application evidence provider over a real PTY', { timeout: 60_000 }, () => {
  beforeAll(buildRuntime, 60_000);

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
      await terminal.getByRole('button', { name: '[Reject]' }).click();
      await terminal.waitForText('last: reject');
      expect(terminal.contract()?.capabilities['pointer-hit-testing']).toMatchObject({
        status: 'supported', evidence: { providerId: 'permission-production-router' },
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
      expect(receipt.plan?.requirements.find(({ condition }) => condition.kind === 'receives-pointer'))
        .toMatchObject({ verdict: 'satisfied', observation: { evidence: { method: 'declared' } } });
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
      expect(receipt.executed).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'down', modifiers: ['shift', 'alt', 'control'] }),
        expect.objectContaining({ kind: 'up', modifiers: ['shift', 'alt', 'control'] }),
      ]));
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
      expect(receipt.executed[0]).toMatchObject({ row: 1, column: expect.any(Number) });
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
        .dragTo(terminal.getByRole('button', { name: '[Reject]' }), { steps: 6 });
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
      expect(receipt.executed).toEqual([
        expect.objectContaining({ kind: 'move', row: 1 }),
      ]);
    } finally {
      await terminal.close();
    }
  });

  it('fails closed when a provider disappears after the contract freezes', async () => {
    const terminal = await launchProvider();
    try {
      await terminal.keyboard.press('l');
      await terminal.waitForText('last: provider disposed');
      await expect(
        terminal.getByRole('button', { name: '[Reject]' }).click(),
      ).rejects.toBeInstanceOf(CapabilityProviderLostError);
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
