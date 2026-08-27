import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/app/', import.meta.url));
const inspected = new Set(['.ts', '.tsx', '.css', '.html']);
const forbidden = [
  {
    label: 'a deleted legacy UI path',
    pattern: /(?:from\s*|import\s*)['"][^'"]*(?:\/old\/|\.\.\/old(?:\/|['"]))/u,
  },
  { label: 'Lit rendering', pattern: /(?:from\s*|import\s*)['"]lit-html(?:\/[^'"]*)?['"]/u },
  {
    label: 'the legacy stylesheet',
    pattern: /(?:from\s*|@import\s*)['"][^'"]*old\/styles\.css['"]/u,
  },
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return nested.flat();
}

const failures = [];
for (const path of await files(root)) {
  if (!inspected.has(extname(path))) continue;
  const source = await readFile(path, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) failures.push(`${relative(root, path)} imports ${rule.label}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Fresh UI boundary violated:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('UI boundary: no imports from deleted legacy paths or Lit.\n');
}
