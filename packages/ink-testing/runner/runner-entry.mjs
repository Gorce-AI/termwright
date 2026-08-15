/**
 * Fixture entry point: the program `launchInkFixture` runs inside the pty.
 *
 * It receives one argument — a JSON payload — and does exactly three things
 * with it: parse it, validate it, and `import()` the module it names. It never
 * evaluates a string as code, never resolves a path from the payload against
 * anything but its own `file:` URL, and refuses anything it does not recognise
 * rather than guessing. A fixture is test input, but it is still input.
 *
 * Plain JavaScript on purpose: this file ships next to `dist/` and must run
 * under a bare `node`, with no build step and no loader.
 */

import { createElement } from 'react';
import { semanticRender } from '@termwright/ink';

/** Mirrors `MAX_PAYLOAD_BYTES` in `src/payload.ts`. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Exit codes. `2` is a usage error, matching the CLI convention in CONTRACTS. */
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 5;

function fail(message) {
  process.stderr.write(`termwright fixture: ${message}\n`);
  process.exit(EXIT_USAGE);
}

function parsePayload(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    fail('missing payload argument');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES) {
    fail(`payload larger than ${MAX_PAYLOAD_BYTES} bytes`);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    fail(`payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('payload must be a JSON object');
  }
  if (payload.v !== 1) {
    fail(`unsupported payload version ${JSON.stringify(payload.v)}`);
  }
  if (typeof payload.module !== 'string' || !payload.module.startsWith('file:')) {
    fail('payload.module must be a file: URL');
  }
  if (typeof payload.exportName !== 'string' || payload.exportName.length === 0) {
    fail('payload.exportName must be a non-empty string');
  }
  if (payload.props === null || typeof payload.props !== 'object' || Array.isArray(payload.props)) {
    fail('payload.props must be a JSON object');
  }
  if (typeof payload.maxFps !== 'number' || !Number.isFinite(payload.maxFps) || payload.maxFps <= 0) {
    fail('payload.maxFps must be a positive number');
  }
  return payload;
}

const payload = parsePayload(process.argv[2]);

let module;
try {
  module = await import(payload.module);
} catch (error) {
  fail(`cannot import ${payload.module}: ${error instanceof Error ? error.message : String(error)}`);
}

const Component = module[payload.exportName];
if (typeof Component !== 'function') {
  fail(
    `export ${JSON.stringify(payload.exportName)} of ${payload.module} is ` +
      `${Component === undefined ? 'missing' : `a ${typeof Component}`}, not a component`,
  );
}

const app = semanticRender(createElement(Component, payload.props), {
  // The same configuration mountInk uses, so a component's semantic tree does
  // not depend on which mode the test picked.
  interactive: true,
  alternateScreen: true,
  patchConsole: false,
  maxFps: payload.maxFps,
});

try {
  await app.waitUntilExit();
  process.exit(0);
} catch (error) {
  process.stderr.write(`termwright fixture: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(EXIT_INTERNAL);
}
