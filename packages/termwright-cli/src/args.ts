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
  | 'codegen'
  | 'mcp'
  | 'agent-context'
  | 'usage'
  | 'skill'
  | 'help'
  | 'version';

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
  if (record && rest.length === 0) {
    throw usageError(
      'recording needs a command to record',
      'write it after `--`, as in `termwright codegen -- node agent.js`',
    );
  }

  return { command: resolved, json, trace, record, outFile, out, port, host, watch, open, rest };
}
