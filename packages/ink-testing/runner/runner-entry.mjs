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

import { connect } from 'node:net';
import { createElement } from 'react';
import { semanticRender } from '@termwright/ink';

/** Mirrors `MAX_PAYLOAD_BYTES` in `src/payload.ts`. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Mirrors the control-channel constants in `src/control.ts`. */
const ENV_CONTROL_ENDPOINT = 'TERMWRIGHT_FIXTURE_CONTROL';
const ENV_CONTROL_TOKEN = 'TERMWRIGHT_FIXTURE_CONTROL_TOKEN';
const MAX_CONTROL_BYTES = 64 * 1024;

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

/**
 * Attach to the harness's control channel, when there is one.
 *
 * The channel is optional by design: a fixture launched without it is a plain
 * program that happens to render a component, which is what makes the runner
 * usable on its own. When it is present, the only thing that crosses it is
 * props — the component to render was fixed at startup and is never re-resolved
 * from a message, so a compromised or confused channel can change what a
 * component is *showing* but never *which code runs*.
 */
function connectControlChannel(app, Component) {
  const endpoint = process.env[ENV_CONTROL_ENDPOINT];
  const token = process.env[ENV_CONTROL_TOKEN];
  if (typeof endpoint !== 'string' || endpoint.length === 0) return;
  if (typeof token !== 'string' || token.length === 0) return;

  const socket = connect(endpoint);
  socket.setEncoding('utf8');
  // The channel must never hold the process open: the fixture ends when its app
  // ends, exactly as it would without a harness attached.
  socket.unref();

  let buffer = '';

  const reply = (type, detail) => {
    socket.write(`${JSON.stringify(detail === undefined ? { v: 1, type } : { v: 1, type, detail })}\n`);
  };

  const handle = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      reply('error', 'message is not valid JSON');
      return;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      reply('error', 'message must be a JSON object');
      return;
    }
    if (message.v !== 1) {
      reply('error', `unsupported control message version ${JSON.stringify(message.v)}`);
      return;
    }
    if (message.type !== 'rerender') {
      reply('error', `unknown control message type ${JSON.stringify(message.type)}`);
      return;
    }
    if (message.props === null || typeof message.props !== 'object' || Array.isArray(message.props)) {
      reply('error', 'rerender props must be a JSON object');
      return;
    }
    try {
      app.rerender(createElement(Component, message.props));
      reply('ok');
    } catch (error) {
      reply('error', error instanceof Error ? error.message : String(error));
    }
  };

  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_CONTROL_BYTES) {
      buffer = '';
      reply('error', 'control message exceeded the size limit');
      return;
    }
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      handle(line);
    }
  });
  // Losing the channel is not fatal: the component keeps rendering whatever it
  // was last given, and the test will fail on its own assertion instead.
  socket.on('error', () => socket.destroy());
  socket.on('connect', () => {
    socket.write(`${JSON.stringify({ v: 1, type: 'hello', token })}\n`);
  });
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

connectControlChannel(app, Component);

try {
  await app.waitUntilExit();
  process.exit(0);
} catch (error) {
  process.stderr.write(`termwright fixture: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(EXIT_INTERNAL);
}
