import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const candidate = process.argv[2];
if (candidate === undefined) {
  throw new Error('usage: terminal-engine-contract-probe.mjs <xterm|wterm-ghostty>');
}

const results = Object.create(null);

function record(name, actual, expected) {
  results[name] = { pass: Object.is(actual, expected), actual, expected };
}

async function probeXterm() {
  Buffer.poolSize = 0;
  const headlessModule = await import('@xterm/headless');
  const graphemeModule = await import('@xterm/addon-unicode-graphemes');
  const { Terminal } = headlessModule.default ?? headlessModule;
  const { UnicodeGraphemesAddon } = graphemeModule.default ?? graphemeModule;
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: 8,
    rows: 3,
    scrollback: 10,
    reflowCursorLine: true,
  });
  terminal.loadAddon(new UnicodeGraphemesAddon());
  terminal.unicode.activeVersion = '15-graphemes';
  let title = null;
  let bells = 0;
  terminal.onTitleChange((value) => (title = value));
  terminal.onBell(() => (bells += 1));

  const write = (value) => new Promise((resolve) => terminal.write(value, resolve));
  await write('\x1b[31;1;4mA\x1b[38;2;1;2;3mB\x1b]2;probe-title\x07\x07');
  const first = terminal.buffer.active.getLine(0)?.getCell(0);
  const second = terminal.buffer.active.getLine(0)?.getCell(1);
  record('palette-color-provenance', first?.isFgPalette(), true);
  record('palette-color-index', first?.getFgColor(), 1);
  record('truecolor-provenance', second?.isFgRGB(), true);
  record('truecolor-value', second?.getFgColor(), 0x01_02_03);
  record('bold', first?.isBold() !== 0, true);
  record('underline', first?.isUnderline() !== 0, true);
  record('title', title, 'probe-title');
  record('bell', bells, 1);

  await write('\x1b[?1h\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[?1049hZ');
  record('alternate-screen', terminal.buffer.active.type, 'alternate');
  record('application-cursor-keys', terminal.modes.applicationCursorKeysMode, true);
  record('bracketed-paste', terminal.modes.bracketedPasteMode, true);
  record('mouse-tracking', terminal.modes.mouseTrackingMode, 'vt200');
  await write('\x1b[?1049l');
  record('normal-screen-restore', terminal.buffer.active.type, 'normal');

  terminal.resize(12, 3);
  await write('\x1bc1234567890');
  terminal.resize(5, 4);
  record('resize-columns', terminal.cols, 5);
  record(
    'resize-reflow-line-0',
    terminal.buffer.active.getLine(0)?.translateToString(true),
    '12345',
  );
  record(
    'resize-reflow-line-1',
    terminal.buffer.active.getLine(1)?.translateToString(true),
    '67890',
  );

  terminal.dispose();
  record('public-dispose', typeof terminal.dispose, 'function');
}

async function probeWtermGhostty() {
  const { GhosttyCore } = await import('@wterm/ghostty');
  const wasmPath = fileURLToPath(import.meta.resolve('@wterm/ghostty/ghostty-vt.wasm'));
  const wasmBytes = await readFile(wasmPath);
  const wasmUrl = `data:application/wasm;base64,${wasmBytes.toString('base64')}`;
  const terminal = await GhosttyCore.load({ scrollbackLimit: 10, wasmPath: wasmUrl });
  terminal.init(8, 3);

  terminal.writeString('\x1b[31;1;4mA\x1b[38;2;1;2;3mB\x1b]2;probe-title\x07\x07');
  const first = terminal.getCell(0, 0);
  const second = terminal.getCell(0, 1);
  record('palette-color-provenance', first.fg, 1);
  record('palette-color-index', first.fg, 1);
  record('truecolor-provenance', second.fgRgb !== undefined, true);
  record('truecolor-value', second.fgRgb, 0x01_02_03);
  record('bold', (first.flags & 0x01) !== 0, true);
  record('underline', (first.flags & 0x08) !== 0, true);
  record('title', terminal.getTitle(), 'probe-title');
  record('bell', undefined, 1);

  terminal.writeString('\x1b[?1h\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[?1049hZ');
  record('alternate-screen', terminal.usingAltScreen(), true);
  record('application-cursor-keys', terminal.cursorKeysApp(), true);
  record('bracketed-paste', terminal.bracketedPaste(), true);
  record('mouse-tracking', terminal.mouseTracking?.(), 1000);
  record('mouse-sgr', terminal.mouseSgr?.(), true);
  terminal.writeString('\x1b[?1049l');
  record('normal-screen-restore', terminal.usingAltScreen(), false);

  terminal.resize(12, 3);
  terminal.writeString('\x1bc1234567890');
  terminal.resize(5, 4);
  const line = (row) =>
    Array.from({ length: 5 }, (_, column) => terminal.getCell(row, column))
      .map((cell) => cell.chars ?? String.fromCodePoint(cell.char))
      .join('')
      .trimEnd();
  record('resize-columns', terminal.getCols(), 5);
  record('resize-reflow-line-0', line(0), '12345');
  record('resize-reflow-line-1', line(1), '67890');
  record('public-dispose', typeof terminal.dispose, 'function');
}

const startedAt = performance.now();
if (candidate === 'xterm') await probeXterm();
else if (candidate === 'wterm-ghostty') await probeWtermGhostty();
else throw new Error(`unknown terminal engine candidate: ${candidate}`);

process.stdout.write(
  `${JSON.stringify({
    candidate,
    node: process.version,
    elapsedMs: performance.now() - startedAt,
    passed: Object.values(results).filter((result) => result.pass).length,
    total: Object.keys(results).length,
    results,
  })}\n`,
);
