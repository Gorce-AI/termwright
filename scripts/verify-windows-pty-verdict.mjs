#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

export async function verifyWindowsPtyVerdict(
  directory,
  verdictName = 'certification-verdict.json',
) {
  const packageDirectory = resolve(directory);
  if (!/^certification-verdict(?:-[a-z0-9-]+)?\.json$/u.test(verdictName)) {
    throw new TypeError(`invalid Windows PTY verdict filename: ${verdictName}`);
  }
  const verdict = JSON.parse(await readFile(join(packageDirectory, verdictName), 'utf8'));
  const manifestPath = join(packageDirectory, 'vendor', 'conpty-manifest.json');

  if (
    verdict.schemaVersion !== 4 ||
    verdict.platform !== 'win32' ||
    !['x64', 'arm64'].includes(verdict.architecture) ||
    verdict.addonSha256 !== (await digest(join(packageDirectory, 'termwright_pty.node'))) ||
    verdict.conptyManifestSha256 !== (await digest(manifestPath)) ||
    verdict.runtime?.provider !== 'vendored' ||
    verdict.runtime?.assetsValidated !== true ||
    verdict.runtime?.mode !== 'ordered-vt-passthrough' ||
    verdict.runtime?.policy !== 'strict' ||
    verdict.runtime?.failureCode !== '' ||
    verdict.runtime?.failureWin32 !== 0 ||
    verdict.runtime?.orderedMarkerSemantics !==
      'marker-authoritative-after-behavioral-certification' ||
    !['x64', 'arm64'].includes(verdict.runtime?.selectedHostArchitecture) ||
    (verdict.architecture === 'arm64' && verdict.runtime?.selectedHostArchitecture !== 'arm64') ||
    verdict.runtime?.coreExports !== true ||
    verdict.causal?.node !== true ||
    verdict.causal?.bun !== true ||
    verdict.causal?.legacy !== true ||
    verdict.causal?.alternateScreen !== true ||
    verdict.causal?.markerOsc !== 8487 ||
    verdict.causal?.inactiveBuffer !== true ||
    verdict.causal?.applicationModes !== true ||
    verdict.causal?.resize !== true ||
    verdict.causal?.markerSplit !== true ||
    verdict.causal?.markerModeNode !== true ||
    verdict.causal?.markerModeBun !== true ||
    verdict.causal?.hiddenCursorSequencePassthrough !== true ||
    verdict.causal?.unicodePassthrough !== true ||
    verdict.causal?.sgrStyleTruecolorSequencePassthrough !== true ||
    verdict.causal?.adjacentMarkerPassthrough !== true ||
    verdict.causal?.forgedMarkerPassthrough !== true ||
    verdict.causal?.mouseDecsetPassthrough !== true ||
    verdict.causal?.focusDecsetPassthrough !== true ||
    verdict.causal?.osc8Passthrough !== true ||
    verdict.causal?.dcsPassthrough !== true ||
    verdict.causal?.apcPassthrough !== true ||
    verdict.causal?.fragmentedControlPassthrough !== true ||
    verdict.causal?.batchedControlPassthrough !== true ||
    verdict.causal?.fragmentedConsoleDelivery !== true
  ) {
    throw new Error(
      `Windows PTY certification verdict does not bind the complete causal contract: ${packageDirectory}`,
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    manifest.architecture !== verdict.architecture ||
    manifest.mode !== 'ordered-vt-passthrough' ||
    manifest.package !== verdict.runtime.package ||
    manifest.version !== verdict.runtime.version
  ) {
    throw new Error(
      `Windows PTY certification verdict names a different vendored runtime: ${packageDirectory}`,
    );
  }
  return verdict;
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  if (argv[2] === undefined) {
    throw new TypeError(
      'usage: verify-windows-pty-verdict.mjs <artifact-package-directory> [verdict-filename]',
    );
  }
  const verdict = await verifyWindowsPtyVerdict(argv[2], argv[3]);
  console.log(
    `verified causal Windows PTY verdict for ${verdict.architecture} ${verdict.addonSha256}`,
  );
}
