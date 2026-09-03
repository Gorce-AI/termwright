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
const indexedUrls = [];

const sitemapIndex = path.join(dist, 'sitemap-index.xml');
const robots = path.join(dist, 'robots.txt');
if (!existsSync(sitemapIndex)) throw new Error('built site lacks sitemap-index.xml');
if (!existsSync(robots)) throw new Error('built site lacks robots.txt');
const robotsText = await readFile(robots, 'utf8');
if (!robotsText.includes('Sitemap: https://gorce-ai.github.io/termwright/sitemap-index.xml')) {
  throw new Error('robots.txt does not name the canonical sitemap');
}
for (const entry of await readdir(dist)) {
  if (!/^sitemap(?:-\d+|-index)?\.xml$/u.test(entry)) continue;
  const xml = await readFile(path.join(dist, entry), 'utf8');
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gu)) indexedUrls.push(match[1]);
}

for await (const file of htmlFiles(dist)) {
  const html = await readFile(file, 'utf8');
  // URL of this page, as served
  const relativePage = path.relative(dist, file);
  const pageUrl =
    relativePage === '404.html'
      ? `${base}/404/`
      : `${base}/${relativePage.replace(/index\.html$/, '')}`;
  const expectedCanonical = `https://gorce-ai.github.io${pageUrl}`;
  const canonical = /<link rel="canonical" href="([^"]+)"/u.exec(html)?.[1];
  if (canonical !== expectedCanonical) {
    console.error(
      `CANONICAL     ${pageUrl} -> ${canonical ?? 'missing'} (expected ${expectedCanonical})`,
    );
    broken += 1;
  }
  if (!/<title>[^<]+<\/title>/u.test(html)) {
    console.error(`TITLE         ${pageUrl} is missing`);
    broken += 1;
  }
  if (!/<meta name="description" content="[^"]+"/u.test(html)) {
    console.error(`DESCRIPTION   ${pageUrl} is missing`);
    broken += 1;
  }
  if (relativePage !== '404.html' && !indexedUrls.includes(expectedCanonical)) {
    console.error(`SITEMAP       ${expectedCanonical} is missing`);
    broken += 1;
  }
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

console.log(
  `${checked} internal links and ${indexedUrls.length} sitemap entries checked, ${broken} broken`,
);
process.exit(broken === 0 ? 0 : 1);
