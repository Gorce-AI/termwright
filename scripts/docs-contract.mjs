import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function fencedContract(markdown, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = markdown.match(
    new RegExp(
      `<!-- BEGIN ${escaped} -->\\s*\\n\\x60\\x60\\x60[^\\n]*\\n([\\s\\S]*?)\\n\\x60\\x60\\x60\\s*\\n<!-- END ${escaped} -->`,
      'u',
    ),
  );
  if (match?.[1] === undefined) throw new Error(`missing or malformed ${name} fenced contract`);
  return `${match[1]}\n`;
}

export async function readQuickstartContract() {
  const [readme, gettingStarted] = await Promise.all([
    readFile(resolve(root, 'README.md'), 'utf8'),
    readFile(resolve(root, 'website/src/content/docs/getting-started.md'), 'utf8'),
  ]);
  return Object.freeze({
    readme,
    gettingStarted,
    app: fencedContract(gettingStarted, 'QUICKSTART APP'),
    readmeTest: fencedContract(readme, 'QUICKSTART TEST'),
    docsTest: fencedContract(gettingStarted, 'QUICKSTART TEST'),
  });
}
