import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyWindowsPtyVerdict } from './verify-windows-pty-verdict.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tw-pty-verdict-'));
  const addon = Buffer.from('exact-addon');
  const manifest = Buffer.from(`${JSON.stringify({
    architecture: 'x64', package: 'Microsoft.Windows.Console.ConPTY', version: '1.24.260710001',
    mode: 'ordered-vt-passthrough',
  })}\n`);
  await mkdir(join(root, 'vendor'));
  await writeFile(join(root, 'termwright_pty.node'), addon);
  await writeFile(join(root, 'vendor', 'conpty-manifest.json'), manifest);
  const verdict = {
    schemaVersion: 1,
    platform: 'win32',
    architecture: 'x64',
    addonSha256: sha256(addon),
    conptyManifestSha256: sha256(manifest),
    runtime: {
      provider: 'vendored', package: 'Microsoft.Windows.Console.ConPTY', version: '1.24.260710001',
      mode: 'ordered-vt-passthrough', policy: 'strict', failureCode: '', failureWin32: 0,
      orderedMarkerSemantics: 'marker-authoritative-after-behavioral-certification',
      selectedHostArchitecture: 'x64', assetsValidated: true, coreExports: true,
    },
    causal: { node: true, bun: true, legacy: true, alternateScreen: true },
  };
  await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
  return { root, verdict };
}

describe('Windows PTY causal verdict', () => {
  it('binds all causal claims to the exact addon and vendored manifest', async () => {
    const { root, verdict } = await fixture();
    await expect(verifyWindowsPtyVerdict(root)).resolves.toEqual(verdict);
    await writeFile(join(root, 'termwright_pty.node'), 'different-addon');
    await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
  });

  it('rejects a verdict with reduced Bun coverage', async () => {
    const { root, verdict } = await fixture();
    verdict.causal.bun = false;
    await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
    await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
  });

  it('rejects a verdict that weakens the loaded runtime contract', async () => {
    const { root, verdict } = await fixture();
    verdict.runtime.mode = 'legacy-framed';
    await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
    await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
  });

  it('verifies a separately named cross-host verdict against the same bytes', async () => {
    const { root, verdict } = await fixture();
    verdict.runtime.selectedHostArchitecture = 'arm64';
    await writeFile(
      join(root, 'certification-verdict-arm64-host.json'),
      `${JSON.stringify(verdict)}\n`,
    );
    await expect(
      verifyWindowsPtyVerdict(root, 'certification-verdict-arm64-host.json'),
    ).resolves.toEqual(verdict);
    await expect(verifyWindowsPtyVerdict(root, '../outside.json')).rejects.toThrow(
      /invalid Windows PTY verdict filename/u,
    );
  });
});
