/** Capability-driven, add-only compiler injection for tview. */

import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  digestGoToolExecSource,
  prepareGoToolExec,
  type GoToolExecUnit,
} from '@termwright/probe-go';

const run = promisify(execFile);

export const FRAMEWORK = 'github.com/rivo/tview';
export const CLIENT_MODULE = 'github.com/gorce-ai/termwright/clients/go';
export const PROBE_VERSION = '0.2.0';
const TCELL_FRAMEWORK = 'github.com/gdamore/tcell/v2';

export interface PrepareOptions {
  readonly moduleDir: string;
  /** Advisory expectation; runtime capability compilation is authoritative. */
  readonly frameworkVersion?: string;
  readonly outputDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PreparedBuild {
  /** Canonical module directory that must be used as the build cwd. */
  readonly moduleDir: string;
  /** Insert after `go build` or `go test`. */
  readonly goArgs: readonly [string, string];
  readonly env: NodeJS.ProcessEnv;
  readonly wrapperFile: string;
  readonly configDigest: string;
  readonly frameworkVersion: string;
  readonly sourceDigests: readonly string[];
}

/**
 * Prepares one official Go `-toolexec` wrapper. It adds compilation units to
 * package namespaces selected by TOOLEXEC_IMPORTPATH and therefore works for
 * module-cache, workspace, replacement, and vendored dependency layouts.
 * No upstream path is copied, patched, or hashed.
 */
export async function prepareInstrumentedBuild(options: PrepareOptions): Promise<PreparedBuild> {
  const env = options.env ?? process.env;
  const moduleDir = await realpath(options.moduleDir);
  const buildEnv = { ...env, PWD: moduleDir };
  const frameworkVersion = await moduleVersion(moduleDir, FRAMEWORK, buildEnv);
  if (options.frameworkVersion !== undefined && options.frameworkVersion !== frameworkVersion) {
    throw new Error(
      `@termwright/probe-tview expected ${FRAMEWORK} ${options.frameworkVersion}, ` +
        `but the application resolves ${frameworkVersion || 'no version'}`,
    );
  }

  const goos = (await run('go', ['env', 'GOOS'], { cwd: moduleDir, env: buildEnv })).stdout.trim();
  const units = await compilationUnits(goos);
  const prepared = await prepareGoToolExec({
    moduleDir,
    outputDir: options.outputDir ?? join(moduleDir, '.termwright', 'go-toolexec'),
    units,
    env: buildEnv,
  });
  return {
    ...prepared,
    moduleDir,
    frameworkVersion,
    sourceDigests: units.map((unit) => unit.sourceDigest),
  };
}

export function compilerUnitTargetsForPlatform(goos: string): readonly string[] {
  return goos === 'windows'
    ? ['zz_termwright_probe.go', 'zz_termwright_marker.go']
    : ['zz_termwright_probe.go'];
}

async function compilationUnits(goos: string): Promise<readonly GoToolExecUnit[]> {
  const root = packageRoot();
  const declarations: {
    packagePath: string;
    targetFile: string;
    sourceFile: string;
    stripWindowsConstraint?: boolean;
    imports?: readonly string[];
  }[] = [
    {
      packagePath: FRAMEWORK,
      targetFile: 'zz_termwright_probe.go',
      sourceFile: join(root, 'assets', 'tview_probe.go.txt'),
      imports: [
        'errors',
        'reflect',
        'runtime/debug',
        'sort',
        'strconv',
        'strings',
        'sync',
        'sync/atomic',
        'github.com/gdamore/tcell/v2',
        'github.com/gorce-ai/termwright/clients/go/annotate',
        'github.com/gorce-ai/termwright/clients/go/evidence',
        'github.com/gorce-ai/termwright/clients/go/probehost',
        'github.com/gorce-ai/termwright/clients/go/protocol',
      ],
    },
    {
      packagePath: TCELL_FRAMEWORK,
      targetFile: 'zz_termwright_marker.go',
      sourceFile: join(root, 'assets', 'tcell_marker_windows.go.txt'),
      stripWindowsConstraint: true,
      imports: ['errors', 'io', 'syscall', 'unicode/utf16', 'unsafe'],
    },
  ].filter(({ targetFile }) => compilerUnitTargetsForPlatform(goos).includes(targetFile));
  return Promise.all(
    declarations.map(
      async ({ packagePath, targetFile, sourceFile, stripWindowsConstraint, imports }) => {
        const asset = await readFile(sourceFile, 'utf8');
        const source = stripWindowsConstraint
          ? asset.replace(/^\/\/go:build windows\n\n/u, '')
          : asset;
        return {
          packagePath,
          targetFile,
          source,
          sourceDigest: digestGoToolExecSource(source),
          ...(imports === undefined ? {} : { imports }),
        };
      },
    ),
  );
}

async function moduleVersion(
  moduleDir: string,
  framework: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await run('go', ['list', '-m', '-f={{.Version}}', framework], {
    cwd: moduleDir,
    env,
  });
  return result.stdout.trim();
}

function packageRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..');
}
