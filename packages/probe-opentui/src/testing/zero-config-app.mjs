/**
 * A fixture that looks like a normal OpenTUI application.
 *
 * The point is what is NOT here: no termwright import, no configuration, no
 * mention of instrumentation. It imports the framework the way any application
 * would, and reports what it found through a file named in the environment so
 * that stdout stays exactly as it would have been.
 */

import { writeFileSync } from 'node:fs';

const core = await import('@opentui/core');

const report = {
  runtime: globalThis.Bun === undefined ? 'node' : 'bun',
  createCliRenderer: typeof core.createCliRenderer,
  wrapped: core.createCliRenderer?.__termwright__ === true,
  // Proof that `export *` forwarded the rest of the module intact.
  renderable: typeof core.Renderable,
  textRenderable: typeof core.TextRenderable,
  boxRenderable: typeof core.BoxRenderable,
};

const target = process.env['TW_PROBE_REPORT'];
if (target !== undefined) writeFileSync(target, JSON.stringify(report), 'utf8');
