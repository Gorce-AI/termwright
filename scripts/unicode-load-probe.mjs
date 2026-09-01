import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = new Set(process.argv.slice(2));
const candidate = process.env.TERMWRIGHT_UNICODE_CANDIDATE ?? 'xterm-upstream';

if (argv.has('--dirty-buffer-pool')) Buffer.from('termwright-preload');

// Diagnostic model of the one-line upstream fix. This is deliberately not a
// production workaround: it lets the matrix distinguish the trie bug from the
// rest of the grapheme provider before Termwright chooses an engine.
if (candidate === 'xterm-fixed-trie-model') Buffer.poolSize = 0;

const startedAt = performance.now();
let terminal;
if (candidate === 'termwright-owned') {
  const { createTerminal } = await import('../packages/vt/dist/index.js');
  terminal = createTerminal({ columns: 80, rows: 24 }).terminal;
} else {
  const [headlessModule, graphemesModule] = await Promise.all([
    import('@xterm/headless'),
    import('@xterm/addon-unicode-graphemes'),
  ]);
  const { Terminal } = headlessModule.default ?? headlessModule;
  const { UnicodeGraphemesAddon } = graphemesModule.default ?? graphemesModule;
  terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 });
  terminal.loadAddon(new UnicodeGraphemesAddon());
  terminal.unicode.activeVersion = '15-graphemes';
}
const importedAt = performance.now();
const initializedAt = performance.now();
const width = (value) => terminal._core.unicodeService.getStringCellWidth(value);

const observation = {
  candidate,
  node: process.version,
  runtime: process.env.VITEST_POOL_ID === undefined ? 'node' : 'vitest',
  importMs: importedAt - startedAt,
  initializeMs: initializedAt - importedAt,
  rssBytes: process.memoryUsage().rss,
  widths: {
    ascii: width('A'),
    combining: width('e\u0301'),
    familyZwj: width('👨‍👩‍👧'),
    skinTone: width('👍🏽'),
    flag: width('🇵🇱'),
    devanagariConjunct: width('क्ष'),
    arabicWithMarks: width('مَرْحَبًا'),
  },
};
observation.correct =
  observation.widths.familyZwj === 2 &&
  observation.widths.skinTone === 2 &&
  observation.widths.flag === 2;

terminal.dispose();

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  process.stdout.write(`${JSON.stringify(observation)}\n`);
  if (!observation.correct) process.exitCode = 1;
}

export { observation };
