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

import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const SOURCE = 'packages/protocol/package.json';
const COMPATIBILITY_REGISTRY = 'compatibility/registry.json';
const COMPATIBILITY_VERSION_ENTRIES = 12;
const patchChecksums = [
	{
		source: 'packages/probe-tview/upstream-patches/tview/v0.42.0/add/termwright_probe.go',
		manifest: 'packages/probe-tview/upstream-patches/tview/v0.42.0/manifest.json',
		manifestSource: 'add/termwright_probe.go',
	},
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
		pattern: /(?<=name: 'termwright-desktop-host-runtime',\n    productName: 'Termwright',\n    version: ')([^']+)(?=',)/,
		render: (version) => version,
		whole: true,
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
		file: 'packages/probe-tview/upstream-patches/tview/v0.42.0/add/termwright_probe.go',
		pattern: /(?<=probeVersion     = ")([^"]+)(?=")/,
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
		file: 'clients/rust-probe/Cargo.toml',
		pattern: /(?<=termwright-protocol = \{ path = "\.\.\/rust", version = ")([^"]+)(?=" \})/,
		render: (version) => version,
		whole: true,
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
		file: 'clients/rust-ratatui/Cargo.toml',
		pattern: /(?<=termwright-probe-ratatui = \{ path = "\.\.\/rust-probe", version = ")([^"]+)(?=" \})/,
		render: (version) => version,
		whole: true,
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
		pattern: /(?<=`termwright` )([^ ]+)(?= \(PyPI\))/,
		render: (version) => version,
		whole: true,
	},
	{
		file: 'clients/README.md',
		pattern: /(?<=`github\.com\/gorce-ai\/termwright\/clients\/go` v)([^ ]+)(?= \|)/,
		render: (version) => version,
		whole: true,
	},
	{
		file: 'clients/README.md',
		pattern: /(?<=`termwright-protocol` )([^ ]+)(?= \(crates\.io\))/,
		render: (version) => version,
		whole: true,
	},
	{
		file: 'clients/README.md',
		pattern: /(?<=`termwright-probe-ratatui` )([^ ]+)(?= \|)/,
		render: (version) => version,
		whole: true,
	},
	{
		file: 'clients/README.md',
		pattern: /(?<=`termwright-ratatui` )([^ ]+)(?= \|)/,
		render: (version) => version,
		whole: true,
	},
];

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

		const current = target.whole === true ? match[0] : match[1];
		if (current === version) continue;

		drift.push({file: target.file, current});
		if (check) continue;

		const after = before.replace(target.pattern, target.render(version));
		await writeFile(file, after);
		console.log(`updated ${target.file}: ${current} -> ${version}`);
	}

	// Versioned Go probe sources are copied into upstream framework modules.
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

		drift.push({file: target.manifest, current: entry.sha256});
		if (check) continue;

		entry.sha256 = expected;
		await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
		console.log(`updated ${target.manifest}: ${target.manifestSource} -> ${expected}`);
	}

	// The compatibility registry is executable release metadata: its drift
	// test compares these package versions with npm, Python, Go and Rust
	// manifests. Changesets cannot update a JSON document outside package.json,
	// so leaving this out would make every generated Version PR fail its own
	// release-hygiene gate. Go module versions retain their leading `v`.
	const registryFile = path.join(root, COMPATIBILITY_REGISTRY);
	const registryBefore = await readFile(registryFile, 'utf8');
	const packageVersionPattern = /"packageVersion": "(v?)([^"]+)"/g;
	const registryVersions = [...registryBefore.matchAll(packageVersionPattern)];
	if (registryVersions.length !== COMPATIBILITY_VERSION_ENTRIES) {
		fail(
			`${COMPATIBILITY_REGISTRY}: expected ${COMPATIBILITY_VERSION_ENTRIES} `
			+ `Termwright packageVersion entries, found ${registryVersions.length}`,
		);
	}
	const registryDrift = registryVersions.filter((match) => match[2] !== version);
	for (const match of registryDrift) {
		drift.push({
			file: COMPATIBILITY_REGISTRY,
			current: `${match[1]}${match[2]}`,
		});
	}
	if (!check && registryDrift.length > 0) {
		const after = registryBefore.replace(
			packageVersionPattern,
			(_whole, prefix) => `"packageVersion": "${prefix}${version}"`,
		);
		await writeFile(registryFile, after);
		console.log(
			`updated ${COMPATIBILITY_REGISTRY}: ${registryDrift.length} package version entries -> ${version}`,
		);
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

await main();
