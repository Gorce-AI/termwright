import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../website/src/content/docs/api/', import.meta.url));

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
    }),
  );
  return nested.flat();
}

function routeFor(markdownPath) {
  const withoutExtension = markdownPath.replace(/\.md$/u, '');
  return (
    withoutExtension === 'index'
      ? ''
      : withoutExtension.endsWith('/index')
        ? withoutExtension.slice(0, -'/index'.length)
        : withoutExtension
  ).toLowerCase();
}

for (const path of await markdownFiles(root)) {
  const source = await readFile(path, 'utf8');
  const sourcePath = path.slice(root.length).replaceAll('\\', '/');
  if (sourcePath === 'index.md') continue;
  const heading = source.match(/^# (.+)$/mu)?.[1]?.replaceAll('\\_', '_');
  if (heading === undefined) throw new Error(`Generated API page has no H1: ${path}`);
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/u)?.[1];
  if (frontmatter === undefined || !/^editUrl: false$/mu.test(frontmatter)) {
    throw new Error(`Unexpected generated frontmatter: ${path}`);
  }
  // Starlight renders frontmatter as HTML. A TypeDoc generic such as `\<T\>`
  // otherwise becomes an empty HTML element inside `<title>`, leaving search
  // results and browser tabs without a usable name.
  const plainTitle = heading.replaceAll(/\\<[^>]*\\>/gu, '').replaceAll('\\', '');
  const title = JSON.stringify(plainTitle);
  const sourceRoute = routeFor(sourcePath);
  const withRoutes = source.replace(
    /\]\(([^)#]+\.md)(#[^)]+)?\)/gu,
    (_match, target, hash = '') => {
      const targetPath = posix.normalize(posix.join(dirname(sourcePath), target));
      const targetRoute = routeFor(targetPath);
      const destination = (
        sourceRoute === '' ? targetRoute : relative(sourceRoute, targetRoute)
      ).replaceAll('\\', '/');
      return `](${destination === '' ? './' : `${destination}/`}${hash})`;
    },
  );
  // TypeDoc may resolve a re-export through another workspace package's
  // generated dist/*.d.ts. Those files are build artifacts, not repository
  // source, so a GitHub URL would be a guaranteed 404. Keep the useful display
  // location but do not manufacture a dead link.
  const withValidSourceLinks = withRoutes.replace(
    /\[([^\]]*\/dist\/[^\]]*)\]\(https:\/\/github\.com\/Gorce-AI\/termwright\/blob\/main\/[^)]*\/dist\/[^)]+\)/gu,
    '$1',
  );
  await writeFile(path, withValidSourceLinks.replace(/^---\n/u, `---\ntitle: ${title}\n`));
}
