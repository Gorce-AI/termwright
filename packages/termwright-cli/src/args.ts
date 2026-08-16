/**
 * Argument parsing for the `termwright` binary.
 *
 * Split out from the dispatcher so that "what did the user ask for" can be
 * tested without starting a server or a test runner.
 */

import { usageError } from '@termwright/mcp';

/** Everything the CLI can be asked to do. */
export type CliCommand =
  | 'ui'
  | 'report'
  | 'codegen'
  | 'mcp'
  | 'agent-context'
  | 'usage'
  | 'skill'
  | 'help'
  | 'version';

/** How one command is documented. */
export interface CommandDoc {
  /** Invocation lines shown under "Usage:", without the binary name. */
  readonly synopsis: readonly string[];
  /**
   * One self-contained line for the cheat sheet.
   *
   * Separate from {@link summary} because truncating a paragraph to its first
   * line leaves a sentence cut in half — "write the viewer and one archive as a
   * single HTML file," and nothing else.
   */
  readonly headline: string;
  /** The fuller description, for `--help`. */
  readonly summary: readonly string[];
  /** `help` and `version` are listed under "Global:", not as commands. */
  readonly global?: boolean;
}

/**
 * Every command, with its documentation.
 *
 * Typed as `Record<CliCommand, …>` on purpose: {@link CliCommand} is a closed
 * union, so adding a command without documenting it stops the build. A
 * hand-maintained list in the renderer would have stayed quiet instead — which
 * is exactly how `usage` came to describe the MCP server and nothing else.
 */
export const CLI_COMMANDS: Record<CliCommand, CommandDoc> = {
  ui: {
    headline: 'open the runner: live terminal, semantic inspector, timeline.',
    synopsis: [
      'ui [--trace <file>] [--port N] [--host H] [--no-watch] [--no-open] [-- <vitest args>]',
      'ui --record [--out-file <file>] -- <command>',
    ],
    summary: [
      'open the runner: live terminal, semantic inspector, timeline.',
      'With no flags it starts Vitest in watch mode and points it at',
      'the runner; --trace opens a .twtrace archive instead, and',
      '--record drives a program you name and writes the test.',
      'The runner opens in your browser; --no-open just prints the URL.',
    ],
  },
  report: {
    headline: 'write one archive and the viewer as a single HTML file.',
    synopsis: ['report --trace <file> [--out-file <file>]'],
    summary: [
      'write the viewer and one archive as a single HTML file,',
      'openable from disk — a CI artifact rather than a server.',
    ],
  },
  codegen: {
    headline: 'drive a program and write the test from what you did.',
    synopsis: ['codegen [--out-file <file>] -- <command>'],
    summary: ['`ui --record`, for when recording is the whole point.'],
  },
  mcp: {
    headline: 'serve the MCP tools; arguments go to @termwright/mcp untouched.',
    synopsis: ['mcp [--http] [--port N]', 'mcp usage'],
    summary: [
      'serve the MCP tools; every argument is forwarded to',
      '@termwright/mcp untouched — including `mcp usage`, which',
      'prints that server’s own cheat sheet.',
    ],
  },
  'agent-context': {
    headline: 'versioned JSON: every MCP tool, parameter and exit code.',
    synopsis: ['agent-context'],
    summary: ['versioned JSON describing every MCP tool, parameter and exit code.'],
  },
  usage: {
    headline: 'this one-screen cheat sheet.',
    synopsis: ['usage'],
    summary: ['this one-screen cheat sheet.'],
  },
  skill: {
    headline: 'an agent-skill package (SKILL.md + reference + context).',
    synopsis: ['skill [--out <dir>]'],
    summary: ['an agent-skill package (SKILL.md + reference + context).'],
  },
  help: { headline: 'print the full help.', synopsis: ['--help, -h'], summary: ['print the full help.'], global: true },
  version: { headline: 'print the version.', synopsis: ['--version, -v'], summary: ['print the version.'], global: true },
};

/** The commands a user invokes, in the order they are documented. */
export function documentedCommands(): readonly (readonly [CliCommand, CommandDoc])[] {
  return Object.entries(CLI_COMMANDS).filter(([, doc]) => doc.global !== true) as (readonly [
    CliCommand,
    CommandDoc,
  ])[];
}

/** A parsed command line. */
export interface ParsedArgs {
  readonly command: CliCommand;
  /** Machine-readable output, including errors carrying `kind`. */
  readonly json: boolean;
  /** `ui --trace <file>`: open an archive in post-mortem mode. */
  readonly trace: string | undefined;
  /** `ui --record` / `codegen`: the runner owns the pty and writes the test. */
  readonly record: boolean;
  /** Where a recorded test is written. */
  readonly outFile: string | undefined;
  /** `skill --out <dir>`. */
  readonly out: string | undefined;
  readonly port: number | undefined;
  readonly host: string | undefined;
  /** Whether `ui` should also run the test suite in watch mode. Default true. */
  readonly watch: boolean;
  /** Whether `ui` should open the runner in a browser. Default true. */
  readonly open: boolean;
  /**
   * Everything after `--`.
   *
   * The recorded command in record mode, extra arguments for the test runner
   * otherwise, and the arguments to forward verbatim for `mcp`.
   */
  readonly rest: readonly string[];
}

const NEEDS_VALUE = new Set(['--trace', '--out-file', '--out', '--port', '--host']);

/**
 * Parse `process.argv.slice(2)`.
 *
 * `mcp` is special: everything after it is forwarded to `@termwright/mcp`
 * untouched, so `termwright mcp --http --port 7333` behaves exactly like
 * `termwright-mcp --http --port 7333` and this parser never has to grow that
 * package's flags.
 *
 * @throws McpError of kind `usage` — exit code 2 — on an unknown flag, a
 * missing value, or a contradictory combination.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: CliCommand | undefined;
  let json = false;
  let trace: string | undefined;
  let record = false;
  let outFile: string | undefined;
  let out: string | undefined;
  let port: number | undefined;
  let host: string | undefined;
  let watch = true;
  let open = true;
  let rest: readonly string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';

    if (arg === '--') {
      rest = argv.slice(index + 1);
      break;
    }

    // Everything after `mcp` belongs to the MCP CLI, `--` included.
    if (command === 'mcp') {
      rest = argv.slice(index);
      break;
    }

    if (NEEDS_VALUE.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw usageError(`${arg} needs a value`);
      }
      index += 1;
      switch (arg) {
        case '--trace':
          trace = value;
          break;
        case '--out-file':
          outFile = value;
          break;
        case '--out':
          out = value;
          break;
        case '--host':
          host = value;
          break;
        case '--port': {
          const parsed = Number(value);
          if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
            throw usageError('--port needs an integer between 0 and 65535');
          }
          port = parsed;
          break;
        }
        default:
          break;
      }
      continue;
    }

    switch (arg) {
      case '--json':
        json = true;
        break;
      case '--record':
        record = true;
        break;
      case '--no-watch':
        watch = false;
        break;
      case '--no-open':
        open = false;
        break;
      case '--help':
      case '-h':
        command ??= 'help';
        break;
      case '--version':
      case '-v':
        command ??= 'version';
        break;
      case 'ui':
      case 'report':
      case 'codegen':
      case 'mcp':
      case 'agent-context':
      case 'usage':
      case 'skill':
      case 'help':
        if (command !== undefined && command !== 'help' && command !== 'version') {
          throw usageError(`${arg} cannot follow ${command}`, 'run `termwright --help`');
        }
        command = arg === 'help' ? 'help' : arg;
        break;
      default:
        throw usageError(
          `unknown argument ${JSON.stringify(arg)}`,
          'run `termwright --help` for the command list',
        );
    }
  }

  const resolved = command ?? 'help';
  if (resolved === 'codegen') record = true;

  if (record && trace !== undefined) {
    throw usageError('--trace and --record are different modes; pass one', 'see `termwright --help`');
  }
  if (resolved === 'report' && trace === undefined) {
    throw usageError(
      'report needs the archive to render',
      'name it with --trace, as in `termwright report --trace out/login.twtrace`',
    );
  }
  if (record && rest.length === 0) {
    throw usageError(
      'recording needs a command to record',
      'write it after `--`, as in `termwright codegen -- node agent.js`',
    );
  }

  return { command: resolved, json, trace, record, outFile, out, port, host, watch, open, rest };
}
