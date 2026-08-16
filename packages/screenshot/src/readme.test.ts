import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from './index.js';

/**
 * Guards the README against the way documentation actually rots: an example
 * keeps importing a name that was renamed or removed, and nothing notices
 * because prose is not compiled.
 *
 * A full type-check of every block is stronger and was run by hand when these
 * examples were written; this is the part cheap enough to run on every commit.
 */
const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));
const PACKAGE_NAME = '@termwright/screenshot';

async function readmeText(): Promise<string> {
  return readFile(readmePath, 'utf8');
}

/** Names imported from this package across all fenced `ts` blocks. */
function importedNames(markdown: string): readonly string[] {
  const blocks = [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  const pattern = new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+'${PACKAGE_NAME}'`, 'g');
  const names = new Set<string>();
  for (const block of blocks) {
    for (const match of block.matchAll(pattern)) {
      for (const name of (match[1] ?? '').split(',')) {
        const cleaned = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
        if (cleaned !== undefined && cleaned !== '') names.add(cleaned);
      }
    }
  }
  return [...names];
}

describe('README examples', () => {
  it('import only names this package exports', async () => {
    const names = importedNames(await readmeText());
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !(name in api))).toEqual([]);
  });

  it('document the result fields the renderer actually returns', async () => {
    const markdown = await readmeText();
    const shot = api.renderSvg(
      { columns: 1, rows: 1, cell: () => ({ char: ' ', width: 1, fg: { kind: 'default' }, bg: { kind: 'default' }, attributes: { bold: false, dim: false, italic: false, underline: false, inverse: false, strikethrough: false } }) },
      { glyphs: 'text' },
    );
    for (const field of Object.keys(shot).filter((key) => key !== 'svg')) {
      expect(markdown).toContain(field);
    }
  });
});
