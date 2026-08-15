#!/usr/bin/env node
/**
 * Protocol lockstep.
 *
 * Four packages implement the same wire protocol and MUST share a version:
 *
 *   @termwright/protocol     packages/protocol/package.json   (source of truth)
 *   termwright (PyPI)        clients/python/pyproject.toml
 *   termwright-protocol      clients/rust/Cargo.toml (+ Cargo.lock)
 *   clients/go               no manifest — the git tag IS the version
 *
 * The npm package is the source of truth because changesets already owns it:
 * a protocol bump lands there first, and this script propagates it. Go carries
 * no version in the tree, so `tag.yml` derives `clients/go/vX.Y.Z` from the
 * same number.
 *
 * Everything else on npm versions independently. Lockstep is a promise about
 * the protocol, not a release train for the whole monorepo.
 *
 *   node scripts/sync-protocol-version.mjs           # write
 *   node scripts/sync-protocol-version.mjs --check   # verify, exit 1 on drift
 */

import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const SOURCE = 'packages/protocol/package.json';

/**
 * Each target names the one line it owns. The patterns are anchored to the
 * manifest's first `version =`, which in both TOML files is inside the leading
 * `[package]` / `[project]` table — a dependency's version is never the first
 * match, and `--check` would catch it if that ever stopped being true.
 */
const targets = [
	{
		file: 'clients/python/pyproject.toml',
		pattern: /^version = "(.+)"$/m,
		render: (version) => `version = "${version}"`,
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
