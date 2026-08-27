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

/**
 * Line endings are normalised before anything is matched.
 *
 * git checks this file out with CRLF on Windows by default, and a pattern
 * anchored on ```` ```ts\n ```` then matches nothing at all — the scan comes
 * back empty and every "does the README mention X" assertion passes vacuously.
 * That is exactly how this test failed on Windows CI while passing everywhere
 * else.
 */
function normalise(markdown: string): string {
  return markdown.replaceAll('\r\n', '\n');
}

async function readmeText(): Promise<string> {
  return normalise(await readFile(readmePath, 'utf8'));
}

/** Fenced `ts` blocks, in order. */
export function codeBlocks(markdown: string): readonly string[] {
  return [...normalise(markdown).matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
}

/** Names imported from this package across all fenced `ts` blocks. */
function importedNames(markdown: string): readonly string[] {
  const pattern = new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+'${PACKAGE_NAME}'`, 'g');
  const names = new Set<string>();
  for (const block of codeBlocks(markdown)) {
    for (const match of block.matchAll(pattern)) {
      for (const name of (match[1] ?? '').split(',')) {
        const cleaned = name
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0];
        if (cleaned !== undefined && cleaned !== '') names.add(cleaned);
      }
    }
  }
  return [...names];
}

describe('README scanning', () => {
  const sample = [
    '# Doc',
    '',
    '```ts',
    `import { renderSvg } from '${PACKAGE_NAME}';`,
    '```',
    '',
  ].join('\n');

  it('finds blocks regardless of line endings', () => {
    expect(codeBlocks(sample)).toHaveLength(1);
    expect(codeBlocks(sample.replaceAll('\n', '\r\n'))).toHaveLength(1);
  });

  it('reads imports out of a CRLF checkout', () => {
    expect(importedNames(sample.replaceAll('\n', '\r\n'))).toEqual(['renderSvg']);
  });
});

describe('README examples', () => {
  it('import only names this package exports', async () => {
    const names = importedNames(await readmeText());
    // A scan that finds nothing must fail loudly: without this, a parser that
    // matches zero blocks makes every assertion below pass for free.
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !(name in api))).toEqual([]);
  });

  it('document the result fields the renderer actually returns', async () => {
    const markdown = await readmeText();
    const blank = {
      char: ' ',
      width: 1,
      fg: { kind: 'default' },
      bg: { kind: 'default' },
      attributes: {
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        inverse: false,
        strikethrough: false,
      },
    } as const;
    const shot = api.renderSvg({ columns: 1, rows: 1, cell: () => blank }, { glyphs: 'text' });
    for (const field of Object.keys(shot)) {
      expect(markdown).toContain(field);
    }
  });
});
