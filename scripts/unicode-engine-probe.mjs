import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UNICODE_CORPUS } from './unicode-corpus.mjs';

const engine = process.argv[2];
if (engine === undefined) throw new Error('usage: unicode-engine-probe.mjs <engine>');

const encoder = new TextEncoder();
const rssBefore = process.memoryUsage().rss;
const startedAt = performance.now();

function geometryCells(cells, markerColumn) {
  return cells
    .slice(0, markerColumn + 1)
    .map((cell, column) => ({ column, ...cell }))
    .slice(0, 24);
}

function isValidGeometry(observation, expectedColumns) {
  const expectedMarker = expectedColumns ?? observation.markerColumn;
  if (
    observation.markerColumn !== expectedMarker ||
    observation.cursor.x !== observation.markerColumn + 1 ||
    observation.cursor.y !== 0 ||
    observation.cells.length !== observation.markerColumn + 1
  ) {
    return false;
  }
  return observation.cells.every((cell, index) => {
    if (cell.column !== index || ![0, 1, 2].includes(cell.width)) return false;
    if (cell.continuation !== (cell.width === 0)) return false;
    if (
      cell.width === 0 &&
      observation.cells[index - 1]?.width !== 2 &&
      !(index === 0 && expectedColumns === undefined)
    )
      return false;
    if (cell.width === 2 && observation.cells[index + 1]?.width !== 0) return false;
    if (index === observation.markerColumn)
      return cell.text === 'X' && cell.width === 1 && !cell.continuation;
    return true;
  });
}

async function createXtermFactory(kind) {
  if (kind === 'xterm-graphemes-fixed-trie-model') Buffer.poolSize = 0;
  const headlessModule = await import('@xterm/headless');
  const { Terminal } = headlessModule.default ?? headlessModule;
  const addonModule =
    kind === 'xterm-unicode11'
      ? await import('@xterm/addon-unicode11')
      : await import('@xterm/addon-unicode-graphemes');
  const Addon =
    kind === 'xterm-unicode11'
      ? (addonModule.default ?? addonModule).Unicode11Addon
      : (addonModule.default ?? addonModule).UnicodeGraphemesAddon;
  const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 4 });
  terminal.loadAddon(new Addon());
  terminal.unicode.activeVersion = kind === 'xterm-unicode11' ? '11' : '15-graphemes';

  return async (text) => {
    await new Promise((resolve) => terminal.write(`\x1bc${text}X`, resolve));
    const line = terminal.buffer.active.getLine(0);
    const cells = [];
    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line?.getCell(column);
      cells.push({
        text: cell?.getChars() ?? '',
        width: cell?.getWidth() ?? 1,
        continuation: cell?.getWidth() === 0,
      });
    }
    const markerColumn = cells.findIndex((cell) => cell.text === 'X');
    const cursor = { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY };
    return { markerColumn, cursor, cells: geometryCells(cells, markerColumn) };
  };
}

async function createTermwrightFactory() {
  const { createTerminal } = await import('../packages/vt/dist/index.js');
  const { terminal } = createTerminal({ columns: 40, rows: 4 });
  return async (text) => {
    await new Promise((resolve) => terminal.write(`\x1bc${text}X`, resolve));
    const line = terminal.buffer.active.getLine(0);
    const cells = [];
    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line?.getCell(column);
      cells.push({
        text: cell?.getChars() ?? '',
        width: cell?.getWidth() ?? 1,
        continuation: cell?.getWidth() === 0,
      });
    }
    const markerColumn = cells.findIndex((cell) => cell.text === 'X');
    const cursor = { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY };
    return { markerColumn, cursor, cells: geometryCells(cells, markerColumn) };
  };
}

async function createGhosttyFactory(graphemeMode) {
  globalThis.self ??= globalThis;
  self.location ??= new URL('../node_modules/ghostty-web/dist/ghostty-web.js', import.meta.url);
  const { Ghostty } = await import('ghostty-web');
  const ghostty = await Ghostty.load();
  const terminal = ghostty.createTerminal(40, 4);
  return async (text) => {
    terminal.write('\x1bc');
    if (graphemeMode) terminal.write('\x1b[?2027h');
    terminal.write(`${text}X`);
    terminal.update();
    const line = terminal.getLine(0) ?? [];
    const cells = line.map((cell, column) => ({
      text:
        cell.grapheme_len > 0
          ? terminal.getGraphemeString(0, column)
          : cell.codepoint === 0
            ? ''
            : String.fromCodePoint(cell.codepoint),
      width: cell.width,
      continuation: cell.codepoint === 0 && column > 0 && line[column - 1]?.width === 2,
    }));
    const markerColumn = cells.findIndex((cell) => cell.text === 'X');
    const ghosttyCursor = terminal.getCursor();
    const cursor = { x: ghosttyCursor.x, y: ghosttyCursor.y };
    return { markerColumn, cursor, cells: geometryCells(cells, markerColumn) };
  };
}

async function createVtermFactory() {
  const { createVtermBackend } = await import('@termless/vterm');
  const terminal = createVtermBackend();
  terminal.init({ cols: 40, rows: 4, scrollbackLimit: 0 });
  return async (text) => {
    terminal.reset();
    terminal.feed(encoder.encode(`${text}X`));
    const line = terminal.getRow(0);
    const cells = line.map((cell) => ({
      text: cell.char,
      width: cell.wide ? 2 : cell.continuation ? 0 : 1,
      continuation: cell.continuation,
    }));
    const markerColumn = cells.findIndex((cell) => cell.text === 'X');
    const vtermCursor = terminal.getCursor();
    const cursor = { x: vtermCursor.col, y: vtermCursor.row };
    return { markerColumn, cursor, cells: geometryCells(cells, markerColumn) };
  };
}

async function createWtermGhosttyFactory(graphemeMode) {
  const { GhosttyCore } = await import('@wterm/ghostty');
  // @wterm/ghostty currently fetches even file: URLs, which Node rejects.
  // A data URL keeps this research lane self-contained while recording that
  // the package does not yet provide a native headless Node loader.
  const wasmPath = fileURLToPath(import.meta.resolve('@wterm/ghostty/ghostty-vt.wasm'));
  const wasmBytes = await readFile(wasmPath);
  const wasmUrl = `data:application/wasm;base64,${wasmBytes.toString('base64')}`;
  const terminal = await GhosttyCore.load({ scrollbackLimit: 0, wasmPath: wasmUrl });
  terminal.init(40, 4);
  return async (text) => {
    terminal.writeString(`\x1bc${graphemeMode ? '\x1b[?2027h' : ''}${text}X`);
    const cells = Array.from({ length: 40 }, (_, column) => {
      const cell = terminal.getCell(0, column);
      return {
        text: cell.chars ?? (cell.char === 0 ? '' : String.fromCodePoint(cell.char)),
        width: cell.width ?? 1,
        continuation: cell.width === 0,
      };
    });
    const markerColumn = cells.findIndex((cell) => cell.text === 'X');
    const wtermCursor = terminal.getCursor();
    const cursor = { x: wtermCursor.col, y: wtermCursor.row };
    return { markerColumn, cursor, cells: geometryCells(cells, markerColumn) };
  };
}

const factory =
  engine === 'termwright-graphemes'
    ? await createTermwrightFactory()
    : engine === 'xterm-unicode11' || engine === 'xterm-graphemes-fixed-trie-model'
      ? await createXtermFactory(engine)
      : engine === 'ghostty-default'
        ? await createGhosttyFactory(false)
        : engine === 'ghostty-grapheme-mode'
          ? await createGhosttyFactory(true)
          : engine === 'wterm-ghostty' || engine === 'wterm-ghostty-grapheme-mode'
            ? await createWtermGhosttyFactory(engine === 'wterm-ghostty-grapheme-mode')
            : engine === 'vterm-reference'
              ? await createVtermFactory()
              : undefined;
if (factory === undefined) throw new Error(`unknown Unicode engine candidate: ${engine}`);

const initializedAt = performance.now();
const cases = [];
const selectedCorpus =
  process.env.TERMWRIGHT_UNICODE_CASE === undefined
    ? UNICODE_CORPUS
    : UNICODE_CORPUS.filter((sample) => sample.id === process.env.TERMWRIGHT_UNICODE_CASE);
if (selectedCorpus.length === 0) {
  throw new Error(`unknown Unicode corpus case: ${process.env.TERMWRIGHT_UNICODE_CASE}`);
}
for (const sample of selectedCorpus) {
  const observation = await factory(sample.text);
  cases.push({
    id: sample.id,
    expectedColumns: sample.expectedColumns ?? null,
    ...observation,
    correct: isValidGeometry(observation, sample.expectedColumns),
  });
}
const completedAt = performance.now();

process.stdout.write(
  `${JSON.stringify({
    engine,
    node: process.version,
    initializeMs: initializedAt - startedAt,
    corpusMs: completedAt - initializedAt,
    rssDeltaBytes: process.memoryUsage().rss - rssBefore,
    cases,
  })}\n`,
);
