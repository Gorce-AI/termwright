#!/usr/bin/env node
/**
 * A bundled native dependency loads from the wrong directory.
 *
 * `@termwright/conpty` finds its addon relative to its own module, so inlining
 * it into another package's bundle makes it look one directory above that
 * bundle instead — a path that does not exist. The failure is quiet: the
 * driver simply reports no native backend and falls back, and every Windows
 * suite then certifies the implementation it was meant to replace.
 *
 * This is what caught it, so this is what keeps it caught.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const CASES = [
  {
    // Explicit backend selection is intentionally absent from the stable root;
    // the experimental integration entry point owns the optional native load.
    entry: 'packages/driver/dist/experimental.js',
    specifier: '@termwright/conpty',
    // What inlining looks like: the addon's own require, sitting in a bundle
    // that is not the addon's package.
    inlined: "'../build/Release/termwright_conpty.node'",
  },
];

let failed = false;
for (const { entry, specifier, inlined } of CASES) {
  let source;
  try {
    source = await reachableBundleSource(entry);
  } catch {
    console.error(`${entry} or one of its chunks is missing; build the workspace before checking its externals`);
    failed = true;
    continue;
  }
  if (source.includes(inlined)) {
    console.error(
      `${entry} inlined ${specifier}: the addon would be looked for beside this bundle ` +
        'rather than beside its own package. Keep it external.',
    );
    failed = true;
    continue;
  }
  if (!source.includes(specifier)) {
    console.error(
      `${entry} no longer references ${specifier} at all; the experimental native-backend ` +
        'integration cannot select it.',
    );
    failed = true;
    continue;
  }
  console.log(`${entry} and its reachable chunks keep ${specifier} external`);
}

process.exit(failed ? 1 : 0);

async function reachableBundleSource(entry) {
  const pending = [resolve(entry)];
  const visited = new Set();
  const sources = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    sources.push(source);
    for (const match of source.matchAll(/(?:from\s+|import\()\s*["'](\.\/[^"']+\.js)["']/gu)) {
      pending.push(resolve(dirname(file), match[1]));
    }
  }
  return sources.join('\n');
}
