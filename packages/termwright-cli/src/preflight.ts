import { execFile as nodeExecFile } from 'node:child_process';
import { statfs as nodeStatfs } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A conservative floor below which a terminal-heavy run is refused. */
export const DEFAULT_MINIMUM_FREE_DISK_BYTES = 1024n * 1024n * 1024n;

export interface TermwrightToolchainRequirement {
  /** Human-readable name used in diagnostics. */
  readonly name: string;
  /**
   * Alternative probes. The requirement passes when any command exits zero.
   * Alternatives cover platform naming differences such as python3/python.
   */
  readonly commands: readonly (readonly [executable: string, ...arguments_: string[]])[];
  readonly timeoutMs?: number;
  /** Environment overrides shared by every alternative probe. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface TermwrightHostPreflightOptions {
  /** Set to zero to disable the default disk floor explicitly. */
  readonly minimumFreeDiskBytes?: bigint;
  readonly requiredToolchains?: readonly TermwrightToolchainRequirement[];
}

export class TermwrightPreflightError extends Error {
  readonly code = 'TW_HOST_PREFLIGHT';

  constructor(readonly issues: readonly string[]) {
    super(
      `Termwright native host preflight failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'TermwrightPreflightError';
  }
}

interface FileSystemSpace {
  readonly bavail: bigint;
  readonly bsize: bigint;
}

interface ExecFileResult {
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface TermwrightPreflightDeps {
  readonly statfs: (path: string) => Promise<FileSystemSpace>;
  readonly execFile: (
    executable: string,
    arguments_: readonly string[],
    options: {
      readonly cwd: string;
      readonly timeout: number;
      readonly windowsHide: true;
      readonly maxBuffer: number;
      readonly env: NodeJS.ProcessEnv;
    },
  ) => Promise<ExecFileResult>;
}

const DEFAULT_DEPS: TermwrightPreflightDeps = {
  statfs: (path) => nodeStatfs(path, { bigint: true }),
  execFile: (executable, arguments_, options) =>
    new Promise((resolve, reject) => {
      nodeExecFile(executable, [...arguments_], options, (error, stdout, stderr) => {
        if (error !== null) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    }),
};

/**
 * Validate cheap host prerequisites before Vitest starts workers or collects
 * suites. Toolchains are caller-declared: a generic test host cannot infer
 * whether files in a polyglot repository belong to the selected test run.
 */
export async function preflightTestHost(
  input: {
    readonly cwd: string;
    readonly runsDir: string;
    readonly preflight?: TermwrightHostPreflightOptions;
  },
  deps: TermwrightPreflightDeps = DEFAULT_DEPS,
): Promise<void> {
  const minimum = input.preflight?.minimumFreeDiskBytes ?? DEFAULT_MINIMUM_FREE_DISK_BYTES;
  if (minimum < 0n) throw new RangeError('minimumFreeDiskBytes must be zero or greater');
  const requirements = input.preflight?.requiredToolchains ?? [];

  const [diskIssue, toolchainIssues] = await Promise.all([
    checkDisk(input.runsDir, minimum, deps),
    Promise.all(requirements.map((requirement) => checkToolchain(requirement, input.cwd, deps))),
  ]);
  const issues = [diskIssue, ...toolchainIssues].filter(
    (issue): issue is string => issue !== undefined,
  );
  if (issues.length > 0) throw new TermwrightPreflightError(Object.freeze(issues));
}

async function checkDisk(
  runsDir: string,
  minimum: bigint,
  deps: TermwrightPreflightDeps,
): Promise<string | undefined> {
  if (minimum === 0n) return undefined;
  try {
    const { path, space } = await statNearestExistingFileSystem(runsDir, deps);
    const available = space.bavail * space.bsize;
    if (available >= minimum) return undefined;
    return (
      `insufficient free disk space for ${runsDir}: ${formatBytes(available)} available on ${path}, ` +
      `${formatBytes(minimum)} required`
    );
  } catch (error) {
    return `could not inspect free disk space for ${runsDir}: ${errorDetail(error)}`;
  }
}

async function statNearestExistingFileSystem(
  requested: string,
  deps: TermwrightPreflightDeps,
): Promise<{ readonly path: string; readonly space: FileSystemSpace }> {
  let path = requested;
  for (;;) {
    try {
      return { path, space: await deps.statfs(path) };
    } catch (error) {
      const parent = dirname(path);
      if (!hasCode(error, 'ENOENT') || parent === path) throw error;
      path = parent;
    }
  }
}

async function checkToolchain(
  requirement: TermwrightToolchainRequirement,
  cwd: string,
  deps: TermwrightPreflightDeps,
): Promise<string | undefined> {
  if (requirement.name.trim() === '') return 'required toolchain has an empty name';
  if (requirement.commands.length === 0)
    return `required toolchain "${requirement.name}" declares no probe commands`;
  const failures: string[] = [];
  for (const [executable, ...arguments_] of requirement.commands) {
    if (executable === '') {
      failures.push('<empty command>');
      continue;
    }
    try {
      await deps.execFile(executable, arguments_, {
        cwd,
        timeout: requirement.timeoutMs ?? 5_000,
        windowsHide: true,
        maxBuffer: 64 * 1024,
        env: { ...process.env, ...requirement.env },
      });
      return undefined;
    } catch (error) {
      failures.push(`${printCommand([executable, ...arguments_])}: ${errorDetail(error)}`);
    }
  }
  return `required toolchain "${requirement.name}" is unavailable (${failures.join('; ')})`;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code
  );
}

function errorDetail(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const record = error as NodeJS.ErrnoException & { stderr?: unknown; killed?: unknown };
  const stderr =
    typeof record.stderr === 'string'
      ? record.stderr.trim().split(/\r?\n/u).slice(-2).join(' ')
      : '';
  if (stderr !== '') return stderr;
  if (record.killed === true) return 'probe timed out';
  return record.code === undefined ? record.message : `${record.code}: ${record.message}`;
}

function printCommand(command: readonly string[]): string {
  return command.map((part) => (/\s/u.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function formatBytes(bytes: bigint): string {
  const mib = 1024n * 1024n;
  const gib = 1024n * mib;
  if (bytes >= gib && bytes % gib === 0n) return `${bytes / gib} GiB`;
  if (bytes >= mib) return `${bytes / mib} MiB`;
  return `${bytes} bytes`;
}
