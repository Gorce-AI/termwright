#!/usr/bin/env node
/**
 * Prove a consumer install resolves the prebuilt addon and runs it.
 *
 * Everything upstream of this checks a working tree: the binary is where the
 * build put it, the manifests say the right things, packing refuses an empty
 * archive. None of that is what a user gets. This installs the packed
 * tarballs into a clean directory and asks the installed copy to open a real
 * pseudoconsole — the first point where optional-dependency resolution, the
 * os/cpu filter, the loader's candidate list and the file actually being in
 * the archive are all exercised at once.
 *
 * The probe runs as a child process with its working directory inside the
 * install, because that is what makes a bare specifier resolve the way it
 * will for a consumer. Resolving it from here would ask this repository's
 * module graph a question about someone else's.
 *
 * Usage: check-installed-pty.mjs <install-dir>
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { argv, execPath, exit, platform, arch } from 'node:process';
import { fileURLToPath } from 'node:url';

const installDirectory = argv[2];
const checkProbeSyntax = installDirectory === '--check-probe-syntax';
const verdictFlag = argv.indexOf('--verdict');
const verdictPath = verdictFlag < 0 ? undefined : argv[verdictFlag + 1];
const causalFixturePath = fileURLToPath(
  new URL('./fixtures/conpty-causal-order.ps1', import.meta.url),
);
const inactiveBufferFixturePath = fileURLToPath(
  new URL('./fixtures/conpty-inactive-buffer-order.ps1', import.meta.url),
);
const consoleMarkerFixturePath = fileURLToPath(
  new URL('./fixtures/conpty-console-marker.ps1', import.meta.url),
);
const consoleMarkerScriptPath = fileURLToPath(
  new URL('./fixtures/conpty-console-marker.mjs', import.meta.url),
);
const observableResizeFixturePath = fileURLToPath(
  new URL('./fixtures/conpty-observable-resize.ps1', import.meta.url),
);
const probe = `
	const { createServer } = await import('node:net');
	const { spawnSync } = await import('node:child_process');
	const { createHash, createHmac } = await import('node:crypto');
	const { encodeConPtyHostCursorResponse, parseConPtyHostCursorRequest } = await import('@termwright/protocol');
	const pty = await import('@termwright/pty');
if (!pty.ptyAvailable()) {
  console.error('resolved no addon: ' + (pty.ptyUnavailableReason?.() ?? 'no reason reported'));
  process.exit(2);
}
if (process.platform === 'win32') {
  const runtime = pty.conPtyRuntimeInfo();
  // Do not infer the native machine from PROCESSOR_ARCHITECTURE. GitHub's
  // ARM64 runners do not consistently expose PROCESSOR_ARCHITEW6432 to an
  // emulated x64 child, while IsWow64Process2 (used by the addon) still
  // correctly selects the native ARM64 OpenConsole host. An ARM64 addon can
  // only run on ARM64; an x64 addon may validly select either host.
  const selectedHostIsValid = process.arch === 'arm64'
    ? runtime.selectedHostArchitecture === 'arm64'
    : runtime.selectedHostArchitecture === 'x64' || runtime.selectedHostArchitecture === 'arm64';
  if (runtime.provider !== 'termwright-patched-openconsole' ||
      runtime.upstreamCommit !== 'dd494ac79a82a04e1e7252a91c8939a3c3039908' ||
      runtime.patchSha256 !== '839ff6fb8c2d3490ee8ccd1f20310baa315475fa187b4967e5e940fa98610d1c' ||
      runtime.hostCursorRpc !== 'twh-cpr-v1' || runtime.mode !== 'ordered-vt-passthrough' ||
      runtime.policy !== 'strict' || runtime.assetsValidated !== true ||
      runtime.coreExports !== true || runtime.failureCode !== '' || runtime.failureWin32 !== 0 ||
      runtime.orderedMarkerSemantics !== 'marker-authoritative-after-behavioral-certification' ||
      Object.hasOwn(runtime, 'package') || Object.hasOwn(runtime, 'version') ||
      !selectedHostIsValid) {
    console.error('the installed addon did not load the pinned patched OpenConsole runtime: ' + JSON.stringify(runtime));
    process.exit(9);
  }
  console.log('[pty-cert] pinned-patched-openconsole ' + JSON.stringify(runtime));
}
// Loading is not running. A binary that loads and then cannot open a
// pseudoconsole would still satisfy a resolution check, and the point of
// shipping a prebuild is that it works on arrival.
console.log('[pty-cert] lifecycle');
const handle = pty.spawnPty({
  command: [process.execPath, '-e', 'process.stdout.write("PREBUILD OK\\\\r\\\\n")'],
  env: { ...process.env, TERM: 'xterm-256color' },
  columns: 80,
  rows: 24,
});
const chunks = [];
handle.onData((data) => chunks.push(Buffer.from(data)));
const attachHostControlResponder = (session, text) => {
  const answeredCursorRequests = new Set();
  let answeredPrimaryDeviceAttributes = false;
  const writeHostControl = (response, description) => {
    let route;
    try {
      route = session.writeTerminalResponse(Buffer.from(response, 'ascii'));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'ConPTY input is closed' &&
        session.treeState() === 'gone'
      )
        return;
      throw error;
    }
    if (route !== 'host-control') throw new Error(description + ' used route ' + route);
  };
  const answer = () => {
    const observed = text();
    if (!answeredPrimaryDeviceAttributes && observed.includes('\x1b[c')) {
      answeredPrimaryDeviceAttributes = true;
      writeHostControl('\x1b[?1;2c', 'startup DA1');
    }
    for (const match of observed.matchAll(/\x1b\]8488;(twh-cpr-v1:q:[0-9a-f]{32})\x07/g)) {
      const payload = match[1];
      if (answeredCursorRequests.has(payload)) continue;
      const request = parseConPtyHostCursorRequest(payload);
      if (request === null) throw new Error('invalid ConPTY host cursor request: ' + payload);
      answeredCursorRequests.add(payload);
      const response = encodeConPtyHostCursorResponse(request, 1, 1);
      writeHostControl(response, 'host cursor RPC');
    }
  };
  const release = session.onData(answer);
  answer();
  return release;
};
const closeOwnedInputAfterExit = (session, releaseHostControl) => {
  if (process.platform !== 'win32' || session.closeInput === undefined) return;
  session.onExit(() => {
    try {
      releaseHostControl();
    } finally {
      // Exit and trailing output can share one native delivery batch. Revoke
      // the response producer synchronously, then close input after that
      // batch returns so a reentrant native call cannot abort delivery before
      // its authoritative EOF event.
      queueMicrotask(() => session.closeInput());
    }
  });
};
closeOwnedInputAfterExit(
  handle,
  attachHostControlResponder(handle, () => Buffer.concat(chunks).toString('utf8')),
);
const exited = new Promise((resolve) => handle.onExit(resolve));
const [status] = await Promise.all([exited, handle.outputEnded]);
const text = Buffer.concat(chunks).toString('utf8');
const sawEof = handle.sawRealEof;
const tree = handle.treeState();
if (!sawEof || status.code !== 0 || tree !== 'gone') {
  console.error('the session did not reach an owned EOF/exit/tree boundary: ' + JSON.stringify({ status, tree }));
  process.exit(3);
}
if (!text.includes('PREBUILD OK')) {
  console.error('the child produced no output; saw ' + JSON.stringify(text));
  process.exit(4);
}
let rejectedAfterEof = false;
try { handle.write(Buffer.from('late')); } catch { rejectedAfterEof = true; }
if (!rejectedAfterEof) {
  console.error('the installed addon admitted input after authoritative EOF');
  process.exit(5);
}
handle.dispose();

const environment = { ...process.env, TERM: 'xterm-256color' };
const command = (source, executable = process.execPath) => [executable, '-e', source];
const collect = (source, executable = process.execPath) => {
  const session = pty.spawnPty({ command: command(source, executable), env: environment, columns: 80, rows: 24 });
  const output = [];
  session.onData((data) => output.push(Buffer.from(data)));
  const collected = { session, output, text: () => Buffer.concat(output).toString('utf8') };
  closeOwnedInputAfterExit(session, attachHostControlResponder(session, collected.text));
  return collected;
};

if (process.platform === 'win32') {
  const causalCycles = 256;
  const causalSource = [
    'const { writeSync } = require("node:fs");',
    'for (let index = 0; index < ' + causalCycles + '; index += 1) {',
    '  const id = index.toString(16).padStart(4, "0");',
    '  writeSync(1, Buffer.from("A" + id + "\\x1b]8487;TW_CAUSAL;A;" + id + "\\x07"));',
    '  writeSync(1, Buffer.from("B" + id + "\\x1b]8487;TW_CAUSAL;B;" + id + "\\x07"));',
    '  writeSync(1, Buffer.from("A" + id + "\\x1b]8487;TW_CAUSAL;C;" + id + "\\x07"));',
    '}',
    'writeSync(1, Buffer.from("\\x1b[?1049hALT\\x1b]8487;TW_CAUSAL;ALT\\x07\\x1b[?1049lPRIMARY\\x1b]8487;TW_CAUSAL;FINAL\\x07"));',
  ].join('');
  const certifyVtOrder = async (name, executable) => {
    const causal = collect(causalSource, executable);
    await causal.session.outputEnded;
    const bytes = causal.text();
    let cursor = bytes.indexOf('A0000\x1b]8487;TW_CAUSAL;A;0000\x07');
    let valid = cursor >= 0 && !/[AB][0-9a-f]{4}/u.test(bytes.slice(0, cursor));
    for (let index = 0; index < causalCycles && valid; index += 1) {
      const id = index.toString(16).padStart(4, '0');
      for (const [text, phase] of [['A', 'A'], ['B', 'B'], ['A', 'C']]) {
        const expected = text + id + '\x1b]8487;TW_CAUSAL;' + phase + ';' + id + '\x07';
        if (bytes.indexOf(expected, cursor) !== cursor) { valid = false; break; }
        cursor += expected.length;
      }
    }
    const tail = '\x1b[?1049hALT\x1b]8487;TW_CAUSAL;ALT\x07\x1b[?1049lPRIMARY\x1b]8487;TW_CAUSAL;FINAL\x07';
    valid &&= bytes.indexOf(tail, cursor) === cursor && causal.session.sawRealEof;
    causal.session.dispose();
    if (!valid) throw new Error(name + ' application writes lost causal VT/alternate-screen order');
  };

  console.log('[pty-cert] causal-vt-node');
  await certifyVtOrder('Node', process.execPath);
  if (process.env.TERMWRIGHT_REQUIRE_BUN === '1') {
    if (spawnSync('bun', ['--version'], { stdio: 'ignore' }).status !== 0) {
      throw new Error('Bun is required for Windows PTY certification');
    }
    console.log('[pty-cert] causal-vt-bun');
    await certifyVtOrder('Bun', 'bun');
  }

  console.log('[pty-cert] causal-legacy');
  const legacySession = pty.spawnPty({
    command: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', process.env.TERMWRIGHT_CONPTY_CAUSAL_FIXTURE],
    env: environment,
    columns: 100,
    rows: 30,
  });
  const legacyOutput = [];
  legacySession.onData((data) => legacyOutput.push(Buffer.from(data)));
  const legacy = { session: legacySession, text: () => Buffer.concat(legacyOutput).toString('utf8') };
  closeOwnedInputAfterExit(legacySession, attachHostControlResponder(legacySession, legacy.text));
  await legacy.session.outputEnded;
  const legacyBytes = legacy.text();
  let legacyCursor = legacyBytes.indexOf('A0000\x1b]8487;TW_LEGACY;A;0000\x07');
  let legacyValid = legacyCursor >= 0;
  for (let index = 0; index < 256 && legacyValid; index += 1) {
    const id = index.toString(16).padStart(4, '0');
    const first = 'A' + id + '\x1b]8487;TW_LEGACY;A;' + id + '\x07';
    legacyValid &&= legacyBytes.indexOf(first, legacyCursor) === legacyCursor;
    legacyCursor += first.length;
    const textIndex = legacyBytes.indexOf('B' + id, legacyCursor);
    const markerText = '\x1b]8487;TW_LEGACY;B;' + id + '\x07';
    const markerIndex = legacyBytes.indexOf(markerText, legacyCursor);
    legacyValid &&= textIndex >= legacyCursor && markerIndex > textIndex;
    legacyCursor = markerIndex + markerText.length;
    const final = 'A' + id + '\x1b]8487;TW_LEGACY;C;' + id + '\x07';
    legacyValid &&= legacyBytes.indexOf(final, legacyCursor) === legacyCursor;
    legacyCursor += final.length;
  }
  legacyValid &&= legacy.session.sawRealEof;
  legacy.session.dispose();
  if (!legacyValid) throw new Error('legacy Console API output was overtaken by its following VT marker');

  console.log('[pty-cert] inactive-buffer-order');
  const inactiveSession = pty.spawnPty({
    command: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', process.env.TERMWRIGHT_CONPTY_INACTIVE_BUFFER_FIXTURE],
    env: environment,
    columns: 100,
    rows: 30,
  });
  const inactiveOutput = [];
  inactiveSession.onData((data) => inactiveOutput.push(Buffer.from(data)));
  closeOwnedInputAfterExit(
    inactiveSession,
    attachHostControlResponder(inactiveSession, () => Buffer.concat(inactiveOutput).toString('utf8')),
  );
  await inactiveSession.outputEnded;
  const inactiveBytes = Buffer.concat(inactiveOutput).toString('utf8');
  const beforeBuffer = inactiveBytes.indexOf('ACTIVE-BEFORE\x1b]8487;TW_BUFFER;BEFORE\x07');
  const activatedBuffer = inactiveBytes.indexOf('INACTIVE-BUFFER', beforeBuffer + 1);
  const afterBuffer = inactiveBytes.indexOf('\x1b]8487;TW_BUFFER;AFTER\x07', activatedBuffer + 1);
  const inactiveValid = beforeBuffer >= 0 && activatedBuffer > beforeBuffer && afterBuffer > activatedBuffer &&
    !inactiveBytes.includes('\x1b]8487;TW_BUFFER;INACTIVE\x07') && inactiveSession.sawRealEof;
  inactiveSession.dispose();
  if (!inactiveValid) throw new Error('inactive console buffer activation did not preserve its causal marker boundary');

  const certifyModeSafeMarker = async (name, executable) => {
    console.log('[pty-cert] mode-safe-marker-' + name.toLowerCase());
    const markerText = '\x1b]8487;TW_MODE_SAFE;' + name.toUpperCase() + '\x07';
    const markerSession = pty.spawnPty({
      command: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', process.env.TERMWRIGHT_CONPTY_CONSOLE_MARKER_FIXTURE],
      env: {
        ...environment,
        TW_MARKER_NODE: executable,
        TW_MARKER_SCRIPT: process.env.TERMWRIGHT_CONPTY_CONSOLE_MARKER_SCRIPT,
        TW_MARKER_TEXT: markerText,
      },
      columns: 80,
      rows: 24,
    });
    const markerOutput = [];
    markerSession.onData((data) => markerOutput.push(Buffer.from(data)));
    closeOwnedInputAfterExit(
      markerSession,
      attachHostControlResponder(markerSession, () => Buffer.concat(markerOutput).toString('utf8')),
    );
    const markerExited = new Promise((resolve) => markerSession.onExit(resolve));
    const [markerStatus] = await Promise.all([markerExited, markerSession.outputEnded]);
    const markerBytes = Buffer.concat(markerOutput).toString('utf8');
    const markerValid = markerStatus.code === 0 && markerBytes.includes(markerText) &&
      markerBytes.includes('MODE_RESTORED') && markerSession.sawRealEof;
    markerSession.dispose();
    if (!markerValid) {
      throw new Error(name + ' did not restore disabled Windows console mode around OSC 8487: ' +
        JSON.stringify({ status: markerStatus, output: markerBytes }));
    }
  };
  await certifyModeSafeMarker('Node', process.execPath);
  if (process.env.TERMWRIGHT_REQUIRE_BUN === '1') await certifyModeSafeMarker('Bun', 'bun');

  console.log('[pty-cert] application-modes');
  const focusOn = '\x1b[?1004h';
  const focusOff = '\x1b[?1004l';
  const win32On = '\x1b[?9001h';
  const win32Off = '\x1b[?9001l';
  const applicationModes = 'BEGIN' + focusOff + focusOn + win32Off + win32On + '\x1bc' + focusOn + win32On + 'END';
  const modes = collect('require("node:fs").writeSync(1, Buffer.from(' + JSON.stringify(applicationModes) + '))');
  await modes.session.outputEnded;
  const modeBytes = modes.text();
  const modesValid = modeBytes.includes(applicationModes) &&
    !modeBytes.includes('\x1b[c' + focusOn + win32On) && modes.session.sawRealEof;
  modes.session.dispose();
  if (!modesValid) throw new Error('ConPTY changed application DEC modes or injected host control-plane modes');

  // Certify the passthrough families whose loss on the legacy inbox ConPTY
  // originally constrained Windows. Boundaries deliberately cut through CSI,
  // OSC and APC sequences, while the drag+SGR mouse modes share one write.
  // The exact reconstructed byte string proves both fragmented and batched
  // child writes preserve their order; no quiet interval participates.
  console.log('[pty-cert] control-family-permeability');
  const controlEsc = String.fromCharCode(27);
  const controlSt = controlEsc + String.fromCharCode(92);
  const mouseClick = controlEsc + '[?1000h';
  const mouseDrag = controlEsc + '[?1002h';
  const mouseSgr = controlEsc + '[?1006h';
  const focus = controlEsc + '[?1004h';
  const osc8 = controlEsc + ']8;id=tw-packed;https://termwright.invalid/packed' +
    controlSt + 'LINK' + controlEsc + ']8;;' + controlSt;
  const dcs = controlEsc + 'PqTW-PACKED-DCS' + controlSt;
  const apc = controlEsc + '_TW-PACKED-APC' + controlSt;
  const permeabilityPieces = [
    'PERMEABILITY-BEGIN',
    controlEsc + '[?10', '00h',
    mouseDrag + mouseSgr,
    controlEsc + '[?100', '4h',
    controlEsc + ']8;id=tw-packed;https://termwright.invalid/',
    'packed' + controlSt + 'LINK' + controlEsc + ']8;;' + controlSt,
    controlEsc + 'PqTW-PACKED-', 'DCS' + controlSt,
    controlEsc + '_', 'TW-PACKED-APC' + controlSt,
    'PERMEABILITY-END',
  ];
  const permeability = collect([
    'const { writeSync } = require("node:fs");',
    'const pieces = ' + JSON.stringify(permeabilityPieces) + ';',
    'for (const piece of pieces) writeSync(1, Buffer.from(piece));',
  ].join(''));
  await permeability.session.outputEnded;
  const permeabilityBytes = permeability.text();
  const exactPermeability = permeabilityPieces.join('');
  const fragmentedControlPassthroughValid = permeabilityBytes.includes(exactPermeability);
  const batchedControlPassthroughValid = permeabilityBytes.includes(mouseDrag + mouseSgr);
  const mouseDecsetPassthroughValid =
    permeabilityBytes.includes(mouseClick + mouseDrag + mouseSgr);
  const focusDecsetPassthroughValid = permeabilityBytes.includes(focus);
  const osc8PassthroughValid = permeabilityBytes.includes(osc8);
  const dcsPassthroughValid = permeabilityBytes.includes(dcs);
  const apcPassthroughValid = permeabilityBytes.includes(apc);
  const permeabilityEof = permeability.session.sawRealEof;
  permeability.session.dispose();
  if (!fragmentedControlPassthroughValid || !batchedControlPassthroughValid ||
      !mouseDecsetPassthroughValid || !focusDecsetPassthroughValid ||
      !osc8PassthroughValid || !dcsPassthroughValid ||
      !apcPassthroughValid || !permeabilityEof) {
    throw new Error('ConPTY control-family permeability certification failed: ' + JSON.stringify({
      fragmentedControlPassthroughValid,
      batchedControlPassthroughValid,
      mouseDecsetPassthroughValid,
      focusDecsetPassthroughValid,
      osc8PassthroughValid,
      dcsPassthroughValid,
      apcPassthroughValid,
      observed: permeabilityBytes,
    }));
  }

  // ResizePseudoConsole and the input pipe are independent channels. A public
  // WINDOW_BUFFER_SIZE_EVENT, followed by public geometry inspection in the
  // child, is the causal acknowledgement. The terminal replies and lone key
  // below use their dedicated transports; no timing window is a barrier.
  console.log('[pty-cert] observable-resize-win32');
  const resizeSession = pty.spawnPty({
    command: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', process.env.TERMWRIGHT_CONPTY_OBSERVABLE_RESIZE_FIXTURE],
    env: environment,
    columns: 80,
    rows: 24,
  });
  const resizeOutput = [];
  resizeSession.onData((data) => resizeOutput.push(Buffer.from(data)));
  const resizing = { session: resizeSession, text: () => Buffer.concat(resizeOutput).toString('utf8') };
  let resizeStatus;
  resizeSession.onExit((status) => { resizeStatus = status; });
  let startupDaAnswered = false;
  const hostCursorAnswered = new Set();
  let runtimeHostCursorAnswered = false;
  let applicationCprAnswered = false;
  let escapeSent = false;
  let responseFailure;
  let resizeStage = 'startup-handshake';
  const releaseResizeResponder = resizeSession.onData(() => {
    const observed = resizing.text();
    try {
      for (const match of observed.matchAll(/\x1b\]8488;(twh-cpr-v1:q:([0-9a-f]{32}))\x07/g)) {
        const payload = match[1];
        const token = match[2];
        if (hostCursorAnswered.has(payload)) continue;
        hostCursorAnswered.add(payload);
        const runtime = observed.indexOf('RESIZE-READY') >= 0;
        resizeStage = runtime ? 'runtime-host-cursor-rpc' : 'startup-host-cursor-rpc';
        const response =
          controlEsc + ']8488;twh-cpr-v1:r:' + token + (runtime ? ':3:17' : ':1:1') + '\x07';
        const route = resizeSession.writeTerminalResponse(Buffer.from(response, 'ascii'));
        if (route !== 'host-control') throw new Error('host cursor RPC used route ' + route);
        if (runtime) runtimeHostCursorAnswered = true;
      }
      const startupDa = observed.indexOf(controlEsc + '[c');
      if (!startupDaAnswered && startupDa >= 0) {
        resizeStage = 'startup-da1';
        const route = resizeSession.writeTerminalResponse(Buffer.from(controlEsc + '[?1;2c', 'ascii'));
        if (route !== 'host-control') throw new Error('startup DA1 used route ' + route);
        startupDaAnswered = true;
      }
      if (!applicationCprAnswered && observed.includes(';APP-DSR:' + controlEsc + '[6n')) {
        resizeStage = 'application-cpr';
        const route = resizeSession.writeTerminalResponse(Buffer.from(controlEsc + '[9;17R', 'ascii'));
        if (route !== 'application-win32-input') throw new Error('application CPR used route ' + route);
        applicationCprAnswered = true;
      }
      if (!escapeSent && observed.includes(';APP-CPR:1b5b393b313752;ESC-READY')) {
        resizeStage = 'physical-escape';
        resizeSession.writeApplicationInput(Buffer.from(controlEsc, 'ascii'), 'key');
        escapeSent = true;
      }
    } catch (error) {
      responseFailure ??= error;
      resizeSession.dispose();
    }
  });
  closeOwnedInputAfterExit(resizeSession, releaseResizeResponder);
  const resizeWatchdog = startDiagnosticWatchdog(resizing, () => resizeStage);
  try {
    await Promise.race([waitForText(resizing, 'RESIZE-READY'), resizeWatchdog.failure]);
    resizeStage = 'resize-acknowledgement';
    if (!resizeSession.resize(120, 40)) throw new Error('installed ConPTY refused a valid resize');
    await Promise.race([resizeSession.outputEnded, resizeWatchdog.failure]);
  } finally {
    resizeWatchdog.cancel();
  }
  const resizeEvidence = resizing.text();
  const resizeValid = responseFailure === undefined &&
    startupDaAnswered && runtimeHostCursorAnswered && applicationCprAnswered && escapeSent &&
    resizeStatus?.code === 0 &&
    resizeEvidence.includes('RESIZED:120x40;HOST-CPR:16,2;HOST-REPLY-LEAK:false') &&
    resizeEvidence.includes(';APP-CPR:1b5b393b313752') &&
    resizeEvidence.includes(';ESC:1b;VK:27;SCAN:1;REPEAT:1') && resizeSession.sawRealEof;
  resizeSession.dispose();
  if (!resizeValid) {
    throw new Error('Win32 did not certify host cursor RPC and application CPR after resize: ' +
      JSON.stringify({ status: resizeStatus, output: resizeEvidence, responseFailure: String(responseFailure ?? '') }));
  }

  console.log('[pty-cert] split-production-marker');
  const splitMarker = collect([
    'const { writeSync } = require("node:fs");',
    'writeSync(1, Buffer.from("SPLIT-BEFORE\\x1b]"));',
    'writeSync(1, Buffer.from("8487;TW_SPLIT;"));',
    'writeSync(1, Buffer.from("MARKER\\x07SPLIT-AFTER"));',
  ].join(''));
  await splitMarker.session.outputEnded;
  const splitExpected = 'SPLIT-BEFORE\x1b]8487;TW_SPLIT;MARKER\x07SPLIT-AFTER';
  const splitValid = splitMarker.text().includes(splitExpected) && splitMarker.session.sawRealEof;
  splitMarker.session.dispose();
  if (!splitValid) throw new Error('production OSC 8487 marker split across application writes lost ordering');

  // One exact byte-stream case covers terminal state which is easy to lose in
  // a frame-oriented host: cursor visibility, non-ASCII UTF-8, compound SGR and
  // truecolour all have to remain ahead of the marker that commits them. The
  // second marker is deliberately adjacent to the first, proving that the PTY
  // preserves a marker-only boundary for the protocol layer above it.
  console.log('[pty-cert] visual-and-semantic-checkpoints');
  const markerToken = 'termwright-packed-artifact-token';
  const markerSession = 'packed-artifact-session';
  const markerMac = (revision, token = markerToken, sessionId = markerSession) =>
    createHmac('sha256', Buffer.from(token, 'utf8'))
      .update(sessionId + ':' + revision, 'utf8')
      .digest()
      .subarray(0, 16)
      .toString('base64url');
  const productionMarker = (revision, token = markerToken, sessionId = markerSession) =>
    '\x1b]8487;twm;' + revision + ';' + markerMac(revision, token, sessionId) + '\x07';
  const visualFrame =
    'VISUAL-BEGIN\x1b[?25lZażółć gęślą jaźń 😀 ' +
    '\x1b[1;4;38;2;10;20;30;48;2;40;50;60mSTYLED-TRUECOLOR\x1b[0m';
  const visualMarker = productionMarker(1);
  const adjacentMarker = productionMarker(2);
  const forgedMarker = productionMarker(3, 'wrong-token');
  const cursorRestore = '\x1b[?25hVISUAL-END';
  const checkpointBytes = visualFrame + visualMarker + adjacentMarker + forgedMarker + cursorRestore;
  const checkpoints = collect(
    // This certifies the Node TTY path applications actually use. A Buffer
    // passed to fs.writeSync targets Win32 WriteFile and is decoded through
    // the console output code page; UTF-8 there is not a valid assumption
    // unless the child explicitly selected CP_UTF8.
    'process.stdout.write(' + JSON.stringify(checkpointBytes) + ', "utf8", () => {})',
  );
  await checkpoints.session.outputEnded;
  const observedCheckpoints = checkpoints.text();
  const checkpointStart = observedCheckpoints.indexOf('VISUAL-BEGIN');
  const cursorHidden = observedCheckpoints.indexOf('\x1b[?25l', checkpointStart);
  const visualCommit = observedCheckpoints.indexOf(visualMarker, checkpointStart);
  const forgedCommit = observedCheckpoints.indexOf(forgedMarker, visualCommit);
  const cursorRestored = observedCheckpoints.indexOf('\x1b[?25h', forgedCommit);
  const hiddenCursorSequencePassthroughValid = checkpointStart >= 0 &&
    cursorHidden > checkpointStart && visualCommit > cursorHidden &&
    forgedCommit > visualCommit && cursorRestored > forgedCommit;
  const unicodePassthroughValid = observedCheckpoints.includes('Zażółć gęślą jaźń 😀');
  const sgrStyleTruecolorSequencePassthroughValid = observedCheckpoints.includes(
    '\x1b[1;4;38;2;10;20;30;48;2;40;50;60mSTYLED-TRUECOLOR\x1b[0m' + visualMarker,
  );
  const adjacentMarkerValid = observedCheckpoints.includes(visualMarker + adjacentMarker);
  // This package certifies PTY transport, not protocol authentication. The
  // production protocol/driver suite proves rejection of the wrong-token
  // marker; here the exact artifact must carry every byte unchanged so that
  // the driver's verifier can make that decision.
  const forgedMarkerPassthroughValid = observedCheckpoints.includes(forgedMarker);
  checkpoints.session.dispose();
  if (!hiddenCursorSequencePassthroughValid || !unicodePassthroughValid ||
      !sgrStyleTruecolorSequencePassthroughValid || !adjacentMarkerValid ||
      !forgedMarkerPassthroughValid || !checkpoints.session.sawRealEof) {
    throw new Error('visual/semantic production marker certification failed: ' + JSON.stringify({
      hiddenCursorSequencePassthroughValid,
      unicodePassthroughValid,
      sgrStyleTruecolorSequencePassthroughValid,
      adjacentMarkerValid,
      forgedMarkerPassthroughValid,
      observed: observedCheckpoints,
    }));
  }
}
function waitForText({ session, text }, marker) {
  if (text().includes(marker)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = session.onData(() => {
      if (settled || !text().includes(marker)) return;
      settled = true;
      release();
      resolve();
    });
    session.outputEnded.then(() => {
      if (settled) return;
      settled = true;
      release();
      if (text().includes(marker)) resolve();
      else reject(new Error('session ended before causal marker ' + JSON.stringify(marker)));
    }, reject);
  });
}

// This timeout is not evidence and never admits success. It only turns a
// broken native causal seam into an attributable certification failure instead
// of occupying a release runner forever.
function startDiagnosticWatchdog({ session, text }, stage, timeoutMs = 30_000) {
  let timer;
  const failure = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('installed ConPTY causal proof stalled: ' + JSON.stringify({
        stage: stage(),
        output: text(),
      }));
      reject(error);
      try { session.dispose(); } catch {}
    }, timeoutMs);
    timer.unref?.();
  });
  return { failure, cancel: () => clearTimeout(timer) };
}

// Certify the bounded input queue in the packed consumer install, on this
// artifact's actual OS/architecture. The child deliberately never consumes
// stdin; rejection, not elapsed time, is the verdict.
console.log('[pty-cert] bounded-input');
const blocked = collect('require("node:net").createServer().listen(0); process.stdout.write("READY")');
await waitForText(blocked, 'READY');
let overflowRejected = false;
try {
  const block = Buffer.alloc(1024 * 1024, 0x61);
  for (let index = 0; index < 32; index += 1) blocked.session.write(block);
} catch (error) {
  overflowRejected = /input queue capacity exceeded/u.test(String(error));
}
blocked.session.dispose();
if (!overflowRejected) {
  console.error('the installed addon did not enforce its bounded input queue');
  process.exit(6);
}

// Keep the child alive until both native drain and exact child receipt are
// observed. This avoids racing the writer's drain publication against input
// pipe teardown while exercising the installed platform writer.
// Keep this to one OpenConsole input-read quantum. Without VT input mode each
// ASCII byte becomes key-down/key-up INPUT_RECORDs, so a large repeated write
// measures keyboard-event expansion rather than strengthening the drain proof.
const inputPayload = Buffer.from('termwright-input-0123456789'.repeat(152)).subarray(0, 4096);
const inputReceipt = createHash('sha256').update(inputPayload).digest('hex');
console.log('[pty-cert] drain');
const controlServer = createServer();
const controlConnected = new Promise((resolve) => controlServer.once('connection', resolve));
await new Promise((resolve, reject) => {
  controlServer.once('error', reject);
  controlServer.listen(0, '127.0.0.1', resolve);
});
const controlAddress = controlServer.address();
if (controlAddress === null || typeof controlAddress === 'string') {
  console.error('the drain control server has no TCP port');
  process.exit(7);
}
const draining = collect([
  'const net = require("node:net");',
  'process.stdin.setRawMode?.(true);',
  'process.stdin.resume();',
  'const { createHash } = require("node:crypto");',
  'const hash = createHash("sha256");',
  'let received = 0;',
  'const control = net.connect(' + controlAddress.port + ', "127.0.0.1", () => process.stdout.write("READY"));',
  'control.once("data", () => control.end("BYE"));',
  'control.once("close", () => process.exit(0));',
  'process.stdin.on("data", chunk => {',
  '  received += chunk.length;',
  '  hash.update(chunk);',
  '  if (received === ' + inputPayload.length + ') process.stdout.write("INPUT_DRAINED:" + hash.digest("hex"));',
  '});',
].join(''));
await waitForText(draining, 'READY');
const control = await controlConnected;
let drainObserved = false;
const drained = new Promise((resolve) => {
  const release = draining.session.onDrain(() => { drainObserved = true; release(); resolve(); });
});
draining.session.write(inputPayload);
if (drainObserved) throw new Error('native drain was published synchronously with admission');
await Promise.all([drained, waitForText(draining, 'INPUT_DRAINED:' + inputReceipt)]);
const controlClosed = new Promise((resolve, reject) => {
  const reply = [];
  control.on('data', (data) => reply.push(data));
  control.once('error', reject);
  control.once('end', () => control.end());
  control.once('close', (hadError) => {
    if (hadError) return;
    const message = Buffer.concat(reply).toString();
    if (message === 'BYE') resolve();
    else reject(new Error('unexpected drain-control farewell: ' + JSON.stringify(message)));
  });
});
control.write('X');
await Promise.all([controlClosed, draining.session.outputEnded]);
if (!draining.text().includes('INPUT_DRAINED:' + inputReceipt) || !draining.session.sawRealEof) {
  console.error('the installed addon did not drain admitted input before owned EOF');
  process.exit(7);
}
draining.session.dispose();
control.destroy();
await new Promise((resolve, reject) => controlServer.close((error) => error === undefined ? resolve() : reject(error)));

// Drive a burst several times larger than the bounded native-to-JavaScript
// queue's maximum represented byte volume and prove every framed application
// payload plus the final tail is delivered before EOF. Queue occupancy is an
// implementation detail; this certifies the observable lossless contract.
const pressureFrameCount = 4096;
const pressureFrameBytes = 4096;
console.log('[pty-cert] output-pressure');
const pressure = collect([
  'const fs = require("node:fs");',
  'const payload = Buffer.alloc(' + pressureFrameBytes + ', 0x71);',
  'const parts = [];',
  'for (let index = 0; index < ' + pressureFrameCount + '; index += 1) {',
  'parts.push(Buffer.from("\\x1b]8487;TW_PRESSURE;" + index.toString(16).padStart(8, "0") + ";"), payload, Buffer.from("\\x07"));',
  '}',
  'parts.push(Buffer.from("PRESSURE_SENTINEL"));',
  'const burst = Buffer.concat(parts);',
  'for (let offset = 0; offset < burst.length;) {',
  'const written = fs.writeSync(1, burst, offset);',
  'if (written <= 0) throw new Error("pressure burst made no write progress");',
  'offset += written;',
  '}',
].join(''));
await pressure.session.outputEnded;
const pressureOutput = Buffer.concat(pressure.output);
const pressurePrefix = Buffer.from('\x1b]8487;TW_PRESSURE;');
const pressureSentinel = Buffer.from('PRESSURE_SENTINEL');
let pressureCursor = pressureOutput.indexOf(pressurePrefix);
let pressureValid = true;
for (let index = 0; index < pressureFrameCount; index += 1) {
  const start = pressureOutput.indexOf(pressurePrefix, pressureCursor);
  const end = start < 0 ? -1 : pressureOutput.indexOf(0x07, start + pressurePrefix.length);
  const body = end < 0 ? Buffer.alloc(0) : pressureOutput.subarray(start + pressurePrefix.length, end);
  const header = index.toString(16).padStart(8, '0') + ';';
  const startIsValid = start === pressureCursor;
  if (!startIsValid || end <= start || body.length !== 9 + pressureFrameBytes ||
      body.subarray(0, 9).toString('ascii') !== header ||
      !body.subarray(9).every((byte) => byte === 0x71)) {
    pressureValid = false;
    break;
  }
  pressureCursor = end + 1;
}
const sentinelIndex = pressureOutput.indexOf(pressureSentinel, pressureCursor);
const sentinelIsValid = sentinelIndex === pressureCursor;
pressureValid &&= pressureOutput.indexOf(pressurePrefix, pressureCursor) === -1 &&
  sentinelIsValid && sentinelIndex === pressureOutput.lastIndexOf(pressureSentinel);
if (!pressureValid || !pressure.session.sawRealEof) {
  console.error('the installed addon lost its final output under channel pressure');
  process.exit(8);
}
pressure.session.dispose();

if (process.platform === 'win32') {
  // A passthrough ConPTY preserves the application's WriteConsole boundaries.
  // Keep JavaScript out of the TSFN callback until the child exits and prove the
  // native reader continues draining more than the former 64-event limit. The
  // 10-second process wait is only a failure watchdog; process exit is the
  // causal success boundary.
  console.log('[pty-cert] fragmented-console-delivery');
  const fragmentedPayloadBytes = 6 * 1024 * 1024;
  const fragmentedSentinel = 'FRAGMENTED_CONSOLE_SENTINEL';
  const fragmentedSource = [
    'process.stdout.write("FRAGMENTED-READY", () => {',
    ' process.stdin.resume();',
    ' process.stdin.once("data", () => {',
    '  const payload = Buffer.alloc(' + fragmentedPayloadBytes + ', 0x58);',
    '  process.stdout.write(payload, () => {',
    '    process.stdout.write(' + JSON.stringify(fragmentedSentinel) + ', () => process.exit(0));',
    '  });',
    ' });',
    '});',
  ].join('');
  const fragmentedSyntax = spawnSync(process.execPath, ['--check', '-'], {
    encoding: 'utf8',
    input: fragmentedSource,
  });
  if (fragmentedSyntax.status !== 0) {
    throw new Error(
      'fragmented console fixture is invalid: ' +
        (fragmentedSyntax.stderr || fragmentedSyntax.stdout),
    );
  }
  const fragmented = collect(fragmentedSource);
  await waitForText(fragmented, 'FRAGMENTED-READY');
  fragmented.session.write(Buffer.from('go\\r'));
  const fragmentedWait = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'try { $target = [Diagnostics.Process]::GetProcessById(' + fragmented.session.pid + ') } ' +
      'catch [ArgumentException] { exit 0 } ' +
      'catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 72 }; ' +
      'if (-not $target.WaitForExit(10000)) { exit 71 }; exit 0',
  ], { encoding: 'utf8' });
  if (fragmentedWait.status !== 0) {
    fragmented.session.dispose();
    throw new Error('fragmented console writer did not reach process exit ' +
      '(helper ' + fragmentedWait.status + '): ' +
      (fragmentedWait.error?.message ?? fragmentedWait.stderr));
  }
  await fragmented.session.outputEnded;
  const fragmentedOutput = Buffer.concat(fragmented.output);
  const fragmentedSentinelBytes = Buffer.from(fragmentedSentinel);
  const fragmentedSentinelAt = fragmentedOutput.indexOf(fragmentedSentinelBytes);
  let fragmentedPayloadStart = fragmentedSentinelAt;
  while (fragmentedPayloadStart > 0 && fragmentedOutput[fragmentedPayloadStart - 1] === 0x58) {
    fragmentedPayloadStart -= 1;
  }
  const fragmentedConsoleDeliveryValid =
    fragmentedSentinelAt >= fragmentedPayloadBytes &&
    fragmentedSentinelAt - fragmentedPayloadStart === fragmentedPayloadBytes &&
    fragmented.session.sawRealEof;
  fragmented.session.dispose();
  if (!fragmentedConsoleDeliveryValid) {
    throw new Error(
      'installed addon did not preserve fragmented console delivery through EOF: ' +
        JSON.stringify({
          outputBytes: fragmentedOutput.length,
          sentinelAt: fragmentedSentinelAt,
          payloadRunBytes: fragmentedSentinelAt - fragmentedPayloadStart,
          sawRealEof: fragmented.session.sawRealEof,
          tail: fragmentedOutput.subarray(Math.max(0, fragmentedOutput.length - 256)).toString('hex'),
        }),
    );
  }
}

console.log('ran native PTY lifecycle and flow-control certification');
`;

if (checkProbeSyntax) {
  const syntax = spawnSync(execPath, ['--input-type=module', '--check'], {
    encoding: 'utf8',
    input: probe,
  });
  if (syntax.stdout) process.stdout.write(syntax.stdout);
  if (syntax.stderr) process.stderr.write(syntax.stderr);
  exit(syntax.status ?? 1);
}
if (installDirectory === undefined) {
  console.error('usage: check-installed-pty.mjs <install-dir> [--verdict <path>]');
  exit(1);
}
if (verdictFlag >= 0 && verdictPath === undefined) {
  console.error('--verdict requires an output path');
  exit(1);
}

writeFileSync(
  join(installDirectory, 'termwright console marker.mjs'),
  readFileSync(consoleMarkerScriptPath),
);
const certifierPath = join(installDirectory, 'termwright-pty-certifier.mjs');
writeFileSync(certifierPath, probe);

// Execute a file inside the clean install. Passing this growing conformance
// program through `node -e` eventually exceeds Windows' command-line limit
// before Node can start, yielding a non-attributable null exit status.
const result = spawnSync(
  execPath,
  ['--force-node-api-uncaught-exceptions-policy=true', certifierPath],
  {
    cwd: installDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      TERMWRIGHT_CONPTY_CAUSAL_FIXTURE: causalFixturePath,
      TERMWRIGHT_CONPTY_INACTIVE_BUFFER_FIXTURE: inactiveBufferFixturePath,
      TERMWRIGHT_CONPTY_CONSOLE_MARKER_FIXTURE: consoleMarkerFixturePath,
      TERMWRIGHT_CONPTY_CONSOLE_MARKER_SCRIPT: join(
        installDirectory,
        'termwright console marker.mjs',
      ),
      TERMWRIGHT_CONPTY_OBSERVABLE_RESIZE_FIXTURE: observableResizeFixturePath,
    },
    // Certification stage markers must remain visible while the child runs. A
    // buffered pipe hid the exact causal boundary whenever a runner watchdog
    // terminated a stuck certifier.
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
if (result.status !== 0) {
  console.error(
    `the installed @termwright/pty failed on ${platform}-${arch}: ` +
      JSON.stringify({
        exit: result.status,
        signal: result.signal,
        spawnError: result.error?.message,
      }),
  );
  exit(1);
}
if (verdictPath !== undefined) {
  if (platform !== 'win32') {
    console.error('--verdict is only supported for a Windows ConPTY bundle');
    exit(1);
  }
  const installedRequire = createRequire(join(installDirectory, 'termwright-pty-certifier.cjs'));
  const addonPath = installedRequire.resolve(`@termwright/pty-win32-${arch}/termwright_pty.node`);
  const manifestPath = join(dirname(addonPath), 'vendor', 'conpty-manifest.json');
  const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const runtime = installedRequire(addonPath).conPtyRuntimeInfo();
  writeFileSync(
    verdictPath,
    `${JSON.stringify(
      {
        schemaVersion: 5,
        platform,
        architecture: arch,
        addonSha256: sha256(addonPath),
        conptyManifestSha256: sha256(manifestPath),
        runtime,
        causal: {
          markerOsc: 8487,
          node: true,
          bun: process.env.TERMWRIGHT_REQUIRE_BUN === '1',
          legacy: true,
          alternateScreen: true,
          inactiveBuffer: true,
          applicationModes: true,
          resize: true,
          markerSplit: true,
          markerModeNode: true,
          markerModeBun: process.env.TERMWRIGHT_REQUIRE_BUN === '1',
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
      },
      null,
      2,
    )}\n`,
  );
}
console.log(`the installed @termwright/pty runs a real pseudoterminal on ${platform}-${arch}`);
