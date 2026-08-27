// Resolves every internal href in the built site against dist/, so a broken
// relative link (or one that escapes the base path) fails loudly.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dist = process.argv[2] ?? 'website/dist';
const base = '/termwright';

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

let broken = 0;
let checked = 0;

for await (const file of htmlFiles(dist)) {
  const html = await readFile(file, 'utf8');
  // URL of this page, as served
  const pageUrl = `${base}/${path.relative(dist, file).replace(/index\.html$/, '')}`;
  for (const match of html.matchAll(/href="([^"#?]+)(?:[#?][^"]*)?"/g)) {
    const href = match[1];
    if (/^(https?:|mailto:|data:|\/\/)/.test(href)) continue;
    const resolved = new URL(href, `https://x${pageUrl}`).pathname;
    checked += 1;
    if (!resolved.startsWith(base + '/') && resolved !== base) {
      console.error(`ESCAPES BASE  ${pageUrl} -> ${href} (${resolved})`);
      broken += 1;
      continue;
    }
    const rel = resolved.slice(base.length).replace(/^\//, '');
    const candidates = [
      path.join(dist, rel),
      path.join(dist, rel, 'index.html'),
      path.join(dist, rel.replace(/\/$/, '') + '.html'),
    ];
    if (!candidates.some((c) => existsSync(c))) {
      console.error(`MISSING       ${pageUrl} -> ${href} (${resolved})`);
      broken += 1;
    }
  }
}

console.log(`${checked} internal links checked, ${broken} broken`);
process.exit(broken === 0 ? 0 : 1);
