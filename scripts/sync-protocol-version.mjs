#!/usr/bin/env node
/**
 * Protocol lockstep.
 *
 * Six packages implement or ship the same wire protocol and MUST share a version:
 *
 *   @termwright/protocol     packages/protocol/package.json   (source of truth)
 *   termwright (PyPI)        clients/python/pyproject.toml
 *   termwright-protocol      clients/rust/Cargo.toml (+ Cargo.lock)
 *   termwright-probe-ratatui clients/rust-probe/Cargo.toml (+ Cargo.lock)
 *   termwright-ratatui       clients/rust-ratatui/Cargo.toml (+ Cargo.lock)
 *   clients/go               no manifest — the git tag IS the version
 *
 * The npm package is the source of truth because changesets already owns it:
 * a protocol bump lands there first, and this script propagates it. Go carries
 * no version in the tree, so `release.yml` derives `clients/go/vX.Y.Z` from the
 * same number.
 *
 * Everything else on npm versions independently. Lockstep is a promise about
 * the protocol, not a release train for the whole monorepo.
 *
 * The Changesets fixed group currently moves every `@termwright/*` manifest
 * with the protocol. The two injected JS probes cannot read package.json after
 * bundling, so their handshake constants are generated here as part of the
 * same release-PR step. A stale runtime version therefore fails CI rather than
 * reaching a published package.
 *
 *   node scripts/sync-protocol-version.mjs           # write
 *   node scripts/sync-protocol-version.mjs --check   # verify, exit 1 on drift
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const SOURCE = 'packages/protocol/package.json';
const COMPATIBILITY_REGISTRY = 'compatibility/registry.json';
const COMPATIBILITY_VERSION_ENTRIES = 12;
const compatibilityAddedUnitSources = [
  {
    framework: 'tview',
    capability: 'private-widget-state',
    target: 'zz_termwright_probe.go',
    source: 'packages/probe-tview/assets/tview_probe.go.txt',
  },
  {
    framework: 'tview',
    capability: 'same-writer-marker',
    target: 'zz_termwright_marker.go',
    source: 'packages/probe-tview/assets/tcell_marker_windows.go.txt',
    transform: (source) => source.replace(/^\/\/go:build windows\n\n/u, ''),
  },
];
const cargoLockstepPackages = new Set([
  'termwright-protocol',
  'termwright-probe-ratatui',
  'termwright-ratatui',
]);
const cargoDependencyManifests = [
  'clients/rust/Cargo.toml',
  'clients/rust-probe/Cargo.toml',
  'clients/rust-ratatui/Cargo.toml',
];
const patchChecksums = [
  {
    source: 'packages/probe-charm/upstream-patches/bubbletea/v1.3.10/add/termwright_probe.go',
    manifest: 'packages/probe-charm/upstream-patches/bubbletea/v1.3.10/manifest.json',
    manifestSource: 'add/termwright_probe.go',
  },
  {
    source: 'packages/probe-charm/upstream-patches/bubbletea/v2.0.8/add/termwright_probe.go',
    manifest: 'packages/probe-charm/upstream-patches/bubbletea/v2.0.8/manifest.json',
    manifestSource: 'add/termwright_probe.go',
  },
  {
    source: 'packages/probe-charm/upstream-patches/bubbletea/v2.0.9/add/termwright_probe.go',
    manifest: 'packages/probe-charm/upstream-patches/bubbletea/v2.0.9/manifest.json',
    manifestSource: 'add/termwright_probe.go',
  },
];

/**
 * Each target names the one line it owns. Manifest package versions are
 * anchored to the first `version =`, which is inside the leading `[package]`
 * or `[project]` table. Dependency and lockfile patterns include their package
 * name so an unrelated version can never be rewritten by position alone.
 */
const targets = [
  {
    file: 'packages/termwright-cli/src/version.ts',
    pattern: /(?<=export const CLI_VERSION = ')([^']+)(?=';)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/mcp/src/version.ts',
    pattern: /(?<=export const SERVER_VERSION = ')([^']+)(?=';)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/desktop-host/src/index.ts',
    pattern:
      /(name:\s*'termwright-desktop-host-runtime'\s*,\s*productName:\s*'Termwright'\s*,\s*version:\s*')([^']+)(',)/,
    render: (version, _whole, prefix, _current, suffix) => `${prefix}${version}${suffix}`,
    versionGroup: 2,
  },
  {
    file: 'packages/probe-ink/src/version.ts',
    pattern: /(?<=export const PACKAGE_VERSION = ')([^']+)(?=';)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/probe-opentui/src/version.ts',
    pattern: /(?<=export const PACKAGE_VERSION = ')([^']+)(?=';)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/probe-tview/src/launch.ts',
    pattern: /(?<=export const PROBE_VERSION = ['"])([^'"]+)(?=['"];)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/probe-charm/src/launch.ts',
    pattern: /(?<=export const PROBE_VERSION = ['"])([^'"]+)(?=['"];)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/probe-tview/assets/tview_probe.go.txt',
    pattern: /(?<=probeVersion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/probe-charm/upstream-patches/bubbletea/v1.3.10/add/termwright_probe.go',
    pattern: /(?<=probeVersion     = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/probe-charm/upstream-patches/bubbletea/v2.0.8/add/termwright_probe.go',
    pattern: /(?<=probeVersion     = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'packages/probe-charm/upstream-patches/bubbletea/v2.0.9/add/termwright_probe.go',
    pattern: /(?<=probeVersion     = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/python/pyproject.toml',
    pattern: /^version = "(.+)"$/m,
    render: (version) => `version = "${version}"`,
  },
  {
    file: 'clients/python/uv.lock',
    pattern: /(?<=name = "termwright"\nversion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/python/src/termwright/__init__.py',
    pattern: /(?<=__version__ = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/python/src/termwright_probe/__init__.py',
    pattern: /(?<=__version__ = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/rust/Cargo.toml',
    pattern: /^version = "(.+)"$/m,
    render: (version) => `version = "${version}"`,
  },
  {
    // Cargo.lock records the workspace member's own version; leaving it
    // behind makes `cargo publish` fail on a dirty lockfile.
    file: 'clients/rust/Cargo.lock',
    pattern: /(?<=name = "termwright-protocol"\nversion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/rust-probe/Cargo.toml',
    pattern: /^version = "(.+)"$/m,
    render: (version) => `version = "${version}"`,
  },
  {
    file: 'clients/rust-probe/Cargo.lock',
    pattern: /(?<=name = "termwright-probe-ratatui"\nversion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/rust-probe/Cargo.lock',
    pattern: /(?<=name = "termwright-protocol"\nversion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/rust-ratatui/Cargo.toml',
    pattern: /^version = "(.+)"$/m,
    render: (version) => `version = "${version}"`,
  },
  {
    file: 'clients/rust-ratatui/Cargo.lock',
    pattern: /(?<=name = "termwright-ratatui"\nversion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/rust-ratatui/Cargo.lock',
    pattern: /(?<=name = "termwright-probe-ratatui"\nversion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/rust-ratatui/Cargo.lock',
    pattern: /(?<=name = "termwright-protocol"\nversion = ")([^"]+)(?=")/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/README.md',
    pattern: /(?<=`termwright` )(\S+)(?=\s+\(PyPI\))/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/README.md',
    pattern: /(?<=`github\.com\/gorce-ai\/termwright\/clients\/go` v)(\S+)(?=\s+\|)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/README.md',
    pattern: /(?<=`termwright-protocol` )(\S+)(?=\s+\(crates\.io\))/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/README.md',
    pattern: /(?<=`termwright-probe-ratatui` )(\S+)(?=\s+\|)/,
    render: (version) => version,
    whole: true,
  },
  {
    file: 'clients/README.md',
    pattern: /(?<=`termwright-ratatui` )(\S+)(?=\s+\|)/,
    render: (version) => version,
    whole: true,
  },
];

/**
 * Cargo path dependencies still need a registry version for `cargo package`.
 * Keep every dependency edge between the lockstep crates on the release
 * version, regardless of which crate happens to depend on which. This is
 * deliberately graph-shaped rather than a list of known edges: adding a new
 * direct dependency cannot be forgotten by the release transform.
 */
export function rewriteCargoPathDependencies(source, version, file = 'Cargo.toml') {
  const changes = [];
  const output = source.replace(
    /^(\s*([A-Za-z0-9_-]+)\s*=\s*\{[^\r\n]*\bpath\s*=\s*"[^"]+"[^\r\n]*\}\s*(?:#.*)?)$/gm,
    (line, _declaration, packageName) => {
      if (!cargoLockstepPackages.has(packageName)) return line;

      const versionPattern = /(\bversion\s*=\s*")([^"]+)(")/;
      const match = versionPattern.exec(line);
      if (match === null) {
        throw new Error(
          `${file}: path dependency ${packageName} must declare a registry version for publishing`,
        );
      }
      if (match[2] === version) return line;

      changes.push({ packageName, current: match[2] });
      return line.replace(versionPattern, `$1${version}$3`);
    },
  );

  return { output, changes };
}

export function synchronizeCompatibilityRegistry(registry, version, addedUnitDigests) {
  const drift = [];
  const unmatchedAddedUnits = new Set(addedUnitDigests.keys());
  let packageVersionEntries = 0;
  let changed = false;

  for (const framework of registry.frameworks ?? []) {
    for (const owner of [framework.probe, framework.annotations]) {
      if (owner === null || typeof owner?.packageVersion !== 'string') continue;
      packageVersionEntries += 1;
      const expectedVersion = owner.packageVersion.startsWith('v') ? `v${version}` : version;
      if (owner.packageVersion === expectedVersion) continue;
      drift.push({ file: COMPATIBILITY_REGISTRY, current: owner.packageVersion });
      owner.packageVersion = expectedVersion;
      changed = true;
    }

    const adapterVersion = framework.probe?.packageVersion;
    if (typeof adapterVersion !== 'string') {
      fail(`${COMPATIBILITY_REGISTRY}: ${framework.id ?? '<unknown>'} has no probe packageVersion`);
    }
    if (framework.certification?.adapterVersion !== adapterVersion) {
      drift.push({
        file: COMPATIBILITY_REGISTRY,
        current: framework.certification?.adapterVersion ?? '<missing adapterVersion>',
      });
      framework.certification.adapterVersion = adapterVersion;
      changed = true;
    }

    const capabilityId =
      framework.certification.strategy === 'compile-and-behavioral-capability'
        ? 'compile-capability'
        : 'runtime-capability';
    const expectedIds =
      framework.versions.policy === 'capability'
        ? [`${framework.id}@${capabilityId}/${adapterVersion}`]
        : framework.versions.verified.map(
            (frameworkVersion) => `${framework.id}@${frameworkVersion}/${adapterVersion}`,
          );
    if (JSON.stringify(framework.certification.ids) !== JSON.stringify(expectedIds)) {
      drift.push({
        file: COMPATIBILITY_REGISTRY,
        current: (framework.certification.ids ?? []).join(', ') || '<missing certification ids>',
      });
      framework.certification.ids = expectedIds;
      changed = true;
    }

    for (const intervention of framework.instrumentation?.interventions ?? []) {
      for (const unit of intervention.addedUnits ?? []) {
        const key = `${framework.id}/${intervention.capability}/${unit.target}`;
        const expectedDigest = addedUnitDigests.get(key);
        if (expectedDigest === undefined) continue;
        unmatchedAddedUnits.delete(key);
        if (unit.sourceDigest === expectedDigest) continue;
        drift.push({ file: COMPATIBILITY_REGISTRY, current: unit.sourceDigest });
        unit.sourceDigest = expectedDigest;
        changed = true;
      }
    }
  }

  if (packageVersionEntries !== COMPATIBILITY_VERSION_ENTRIES) {
    fail(
      `${COMPATIBILITY_REGISTRY}: expected ${COMPATIBILITY_VERSION_ENTRIES} ` +
        `Termwright packageVersion entries, found ${packageVersionEntries}`,
    );
  }
  if (unmatchedAddedUnits.size > 0) {
    throw new Error(
      `${COMPATIBILITY_REGISTRY}: configured added units not found: ${[...unmatchedAddedUnits].join(', ')}`,
    );
  }

  return { changed, drift };
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(root, SOURCE), 'utf8'));
  const version = manifest.version;
  if (typeof version !== 'string' || version.length === 0) {
    fail(`${SOURCE} has no version`);
  }

  const drift = [];

  for (const target of targets) {
    const file = path.join(root, target.file);
    const before = await readFile(file, 'utf8');
    const match = target.pattern.exec(before);
    if (match === null) {
      fail(`${target.file}: no version line matched — the manifest layout changed`);
    }

    const current = match[target.versionGroup ?? (target.whole === true ? 0 : 1)];
    if (current === version) continue;

    drift.push({ file: target.file, current });
    if (check) continue;

    const after = before.replace(target.pattern, (...args) => target.render(version, ...args));
    await writeFile(file, after);
    console.log(`updated ${target.file}: ${current} -> ${version}`);
  }

  for (const target of cargoDependencyManifests) {
    const file = path.join(root, target);
    const before = await readFile(file, 'utf8');
    let rewritten;
    try {
      rewritten = rewriteCargoPathDependencies(before, version, target);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }

    for (const change of rewritten.changes) {
      drift.push({ file: `${target} (${change.packageName})`, current: change.current });
    }
    if (!check && rewritten.changes.length > 0) {
      await writeFile(file, rewritten.output);
      for (const change of rewritten.changes) {
        console.log(
          `updated ${target} dependency ${change.packageName}: ${change.current} -> ${version}`,
        );
      }
    }
  }

  // Exact Bubble Tea probe sources are copied into upstream framework modules.
  // Their manifests intentionally pin the exact resulting bytes, so changing
  // the handshake version must refresh those checksums in the same operation.
  for (const target of patchChecksums) {
    const source = await readFile(path.join(root, target.source));
    const expected = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    const manifestFile = path.join(root, target.manifest);
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const entry = manifest.added?.find((candidate) => candidate.source === target.manifestSource);
    if (entry === undefined || typeof entry.sha256 !== 'string') {
      fail(`${target.manifest}: no checksum entry for ${target.manifestSource}`);
    }
    if (entry.sha256 === expected) continue;

    drift.push({ file: target.manifest, current: entry.sha256 });
    if (check) continue;

    entry.sha256 = expected;
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`updated ${target.manifest}: ${target.manifestSource} -> ${expected}`);
  }

  // The compatibility registry is executable release metadata. Besides its
  // package versions, certification identities and owned-unit digests are
  // derived from release-versioned sources and must move in the same operation.
  const registryFile = path.join(root, COMPATIBILITY_REGISTRY);
  const registry = JSON.parse(await readFile(registryFile, 'utf8'));
  const addedUnitDigests = new Map();
  for (const unit of compatibilityAddedUnitSources) {
    const raw = await readFile(path.join(root, unit.source), 'utf8');
    const source = unit.transform === undefined ? raw : unit.transform(raw);
    const key = `${unit.framework}/${unit.capability}/${unit.target}`;
    if (addedUnitDigests.has(key)) {
      throw new Error(`${COMPATIBILITY_REGISTRY}: duplicate added-unit source mapping: ${key}`);
    }
    addedUnitDigests.set(key, `sha256:${createHash('sha256').update(source).digest('hex')}`);
  }
  const registrySync = synchronizeCompatibilityRegistry(registry, version, addedUnitDigests);
  drift.push(...registrySync.drift);
  if (!check && registrySync.changed) {
    await writeFile(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    console.log(`updated ${COMPATIBILITY_REGISTRY}: derived release metadata -> ${version}`);
  }

  if (drift.length === 0) {
    console.log(
      check
        ? `protocol lockstep holds at ${version}`
        : `protocol lockstep already at ${version}, nothing to do`,
    );
    return;
  }

  if (check) {
    console.error(`protocol lockstep broken. ${SOURCE} is ${version}, but:`);
    for (const entry of drift) console.error(`  ${entry.file} is ${entry.current}`);
    console.error('');
    console.error('run: node scripts/sync-protocol-version.mjs');
    process.exit(1);
  }

  console.log('');
  console.log(`tag the Go module as clients/go/v${version} — it has no manifest to update.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
