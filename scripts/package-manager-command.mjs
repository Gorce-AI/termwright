import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

const pnpmJavaScriptExtensions = new Set(['.cjs', '.js', '.mjs']);
const expectedPnpmVersion = readJson(new URL('../package.json', import.meta.url))?.packageManager?.match(/^pnpm@([^+]+)(?:\+.*)?$/u)?.[1];
if (expectedPnpmVersion === undefined) throw new Error('root package.json must pin an exact pnpm packageManager version');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function regularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function validatedPnpmCli(path) {
  if (typeof path !== 'string' || path.length === 0 || !pnpmJavaScriptExtensions.has(extname(path))) {
    return undefined;
  }
  let entry;
  try {
    entry = realpathSync(path);
  } catch {
    return undefined;
  }
  if (!regularFile(entry)) return undefined;

  let directory = dirname(entry);
  for (;;) {
    const manifest = readJson(join(directory, 'package.json'));
    if (manifest?.name === 'pnpm') {
      if (manifest.version !== expectedPnpmVersion) return undefined;
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm;
      if (typeof bin !== 'string') return undefined;
      try {
        return realpathSync(resolve(directory, bin)) === entry ? entry : undefined;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function directoryEntries(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function pnpmHomePackageRoots(home) {
  const roots = [];

  // action-setup v6 self-updates its bootstrap into
  // PNPM_HOME/global/<generation>/<opaque-id>/node_modules/pnpm. Consider
  // every structurally valid target before the bootstrap next to PNPM_HOME.
  for (const generation of directoryEntries(join(home, 'global'))) {
    const generationRoot = join(home, 'global', generation);
    roots.push(join(generationRoot, 'node_modules', 'pnpm'));
    for (const installation of directoryEntries(generationRoot)) {
      roots.push(join(generationRoot, installation, 'node_modules', 'pnpm'));
    }
  }

  // Older self-managed installations use .tools instead of global.
  for (const version of directoryEntries(join(home, '.tools', 'pnpm'))) {
    const versionRoot = join(home, '.tools', 'pnpm', version);
    roots.push(join(versionRoot, 'node_modules', 'pnpm'), join(versionRoot, 'pnpm'));
  }

  roots.push(join(home, 'node_modules', 'pnpm'));

  // pnpm/action-setup exposes <destination>/node_modules/.bin as PNPM_HOME.
  // The package containing the real JavaScript CLI is its sibling.
  if (basename(home) === '.bin' && basename(dirname(home)) === 'node_modules') {
    roots.push(join(dirname(home), 'pnpm'));
  }
  return roots;
}

function cliFromPackageRoot(packageRoot) {
  const manifest = readJson(join(packageRoot, 'package.json'));
  if (manifest?.name !== 'pnpm') return undefined;
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm;
  return typeof bin === 'string' ? validatedPnpmCli(resolve(packageRoot, bin)) : undefined;
}

function resolvePnpmCli(env) {
  const fromLifecycle = validatedPnpmCli(env.npm_execpath);
  if (fromLifecycle !== undefined) return fromLifecycle;

  if (typeof env.PNPM_HOME === 'string' && env.PNPM_HOME.length > 0) {
    for (const packageRoot of pnpmHomePackageRoots(resolve(env.PNPM_HOME))) {
      const entry = cliFromPackageRoot(packageRoot);
      if (entry !== undefined) return entry;
    }
  }
  return undefined;
}

/**
 * Resolves pnpm for direct execFile/spawn use without a shell or a `.cmd` shim.
 *
 * A JavaScript entrypoint is accepted only when it is the declared `pnpm` bin
 * of an installed `pnpm` package. Windows fails closed if neither npm_execpath
 * nor PNPM_HOME identifies one. POSIX retains the ordinary PATH executable as
 * a portable fallback.
 */
export function pnpmInvocation(args, options = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('pnpm arguments must be an array of strings');
  }
  const env = options.env ?? process.env;
  const entry = resolvePnpmCli(env);
  if (entry !== undefined) {
    return {
      command: options.nodeExecutable ?? process.execPath,
      args: [entry, ...args],
    };
  }
  if ((options.platform ?? process.platform) === 'win32') {
    throw new Error(
      'Unable to resolve a validated pnpm JavaScript CLI from npm_execpath or PNPM_HOME on Windows; refusing a pnpm.cmd or shell fallback.',
    );
  }
  return { command: 'pnpm', args: [...args] };
}
