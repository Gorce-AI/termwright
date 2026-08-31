import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyWindowsPtyVerdict } from './verify-windows-pty-verdict.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tw-pty-verdict-'));
  const addon = Buffer.from('exact-addon');
  const manifest = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 2,
      architecture: 'x64',
      provider: 'termwright-patched-openconsole',
      upstreamCommit: 'dd494ac79a82a04e1e7252a91c8939a3c3039908',
      patchSha256: 'a09171f65d36283338c589b1a3ab4a95816cbe63bd81b2657eaf7551d1013527',
      hostCursorRpc: 'twh-cpr-v1',
      mode: 'ordered-vt-passthrough',
    })}\n`,
  );
  await mkdir(join(root, 'vendor'));
  await writeFile(join(root, 'termwright_pty.node'), addon);
  await writeFile(join(root, 'vendor', 'conpty-manifest.json'), manifest);
  const verdict = {
    schemaVersion: 5,
    platform: 'win32',
    architecture: 'x64',
    addonSha256: sha256(addon),
    conptyManifestSha256: sha256(manifest),
    runtime: {
      provider: 'termwright-patched-openconsole',
      upstreamCommit: 'dd494ac79a82a04e1e7252a91c8939a3c3039908',
      patchSha256: 'a09171f65d36283338c589b1a3ab4a95816cbe63bd81b2657eaf7551d1013527',
      hostCursorRpc: 'twh-cpr-v1',
      mode: 'ordered-vt-passthrough',
      policy: 'strict',
      failureCode: '',
      failureWin32: 0,
      orderedMarkerSemantics: 'marker-authoritative-after-behavioral-certification',
      selectedHostArchitecture: 'x64',
      assetsValidated: true,
      coreExports: true,
    },
    causal: {
      markerOsc: 8487,
      node: true,
      bun: true,
      legacy: true,
      alternateScreen: true,
      inactiveBuffer: true,
      applicationModes: true,
      resize: true,
      markerSplit: true,
      markerModeNode: true,
      markerModeBun: true,
      hiddenCursorSequencePassthrough: true,
      unicodePassthrough: true,
      sgrStyleTruecolorSequencePassthrough: true,
      adjacentMarkerPassthrough: true,
      forgedMarkerPassthrough: true,
      mouseDecsetPassthrough: true,
      focusDecsetPassthrough: true,
      osc8Passthrough: true,
      dcsPassthrough: true,
      apcPassthrough: true,
      fragmentedControlPassthrough: true,
      batchedControlPassthrough: true,
      fragmentedConsoleDelivery: true,
    },
  };
  await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
  return { root, verdict };
}

describe('Windows PTY causal verdict', () => {
  it('rejects the previous schema before the extended visual and semantic facts existed', async () => {
    const { root, verdict } = await fixture();
    verdict.schemaVersion = 4;
    await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
    await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
  });

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

  it.each([
    'inactiveBuffer',
    'applicationModes',
    'resize',
    'markerSplit',
    'markerModeNode',
    'markerModeBun',
    'hiddenCursorSequencePassthrough',
    'unicodePassthrough',
    'sgrStyleTruecolorSequencePassthrough',
    'adjacentMarkerPassthrough',
    'forgedMarkerPassthrough',
    'mouseDecsetPassthrough',
    'focusDecsetPassthrough',
    'osc8Passthrough',
    'dcsPassthrough',
    'apcPassthrough',
    'fragmentedControlPassthrough',
    'batchedControlPassthrough',
    'fragmentedConsoleDelivery',
  ])('rejects a verdict without the %s causal fact', async (fact) => {
    const { root, verdict } = await fixture();
    verdict.causal[fact] = false;
    await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
    await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
  });

  it('rejects a verdict certified with a non-production marker OSC', async () => {
    const { root, verdict } = await fixture();
    verdict.causal.markerOsc = 8486;
    await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
    await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
  });

  it('rejects a verdict that weakens the loaded runtime contract', async () => {
    const { root, verdict } = await fixture();
    verdict.runtime.mode = 'legacy-framed';
    await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
    await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
  });

  it.each(['provider', 'upstreamCommit', 'patchSha256', 'hostCursorRpc'])(
    'rejects a verdict with a different %s runtime identity',
    async (field) => {
      const { root, verdict } = await fixture();
      verdict.runtime[field] = 'different';
      await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
      await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
    },
  );

  it.each(['package', 'version'])(
    'rejects the removed %s runtime compatibility identity',
    async (field) => {
      const { root, verdict } = await fixture();
      verdict.runtime[field] = 'legacy';
      await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
      await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/does not bind/u);
    },
  );

  it.each(['provider', 'upstreamCommit', 'patchSha256', 'hostCursorRpc', 'package', 'version'])(
    'rejects a vendored manifest with a different %s identity',
    async (field) => {
      const { root } = await fixture();
      const manifest = JSON.parse(
        await readFile(join(root, 'vendor', 'conpty-manifest.json'), 'utf8'),
      );
      manifest[field] = 'different';
      const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
      await writeFile(join(root, 'vendor', 'conpty-manifest.json'), bytes);
      const verdict = JSON.parse(await readFile(join(root, 'certification-verdict.json'), 'utf8'));
      verdict.conptyManifestSha256 = sha256(bytes);
      await writeFile(join(root, 'certification-verdict.json'), `${JSON.stringify(verdict)}\n`);
      await expect(verifyWindowsPtyVerdict(root)).rejects.toThrow(/different vendored runtime/u);
    },
  );

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
