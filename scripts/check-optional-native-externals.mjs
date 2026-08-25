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

const CASES = [
  {
    bundle: 'packages/driver/dist/index.js',
    specifier: '@termwright/conpty',
    // What inlining looks like: the addon's own require, sitting in a bundle
    // that is not the addon's package.
    inlined: "'../build/Release/termwright_conpty.node'",
  },
];

let failed = false;
for (const { bundle, specifier, inlined } of CASES) {
  let source;
  try {
    source = await readFile(bundle, 'utf8');
  } catch {
    console.error(`${bundle} is missing; build the workspace before checking its externals`);
    failed = true;
    continue;
  }
  if (source.includes(inlined)) {
    console.error(
      `${bundle} inlined ${specifier}: the addon would be looked for beside this bundle ` +
        'rather than beside its own package. Keep it external.',
    );
    failed = true;
    continue;
  }
  if (!source.includes(specifier)) {
    console.error(
      `${bundle} no longer references ${specifier} at all; the optional native backend ` +
        'cannot be selected from it.',
    );
    failed = true;
    continue;
  }
  console.log(`${bundle} keeps ${specifier} external`);
}

process.exit(failed ? 1 : 0);
