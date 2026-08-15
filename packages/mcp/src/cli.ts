/**
 * `termwright-mcp` — the standalone binary for this package.
 *
 * Commands: serve over stdio (the default), serve Streamable HTTP, print
 * `agent-context`, print `usage`. Exit codes follow the taxonomy in
 * CONTRACTS.md §MCP: 0 ok / 1 assertion / 2 usage / 3 no-session / 4 ipc /
 * 5 internal. With `--json`, failures are one JSON object carrying `kind`.
 *
 * The umbrella `termwright` CLI (task #10) reuses {@link runCli} and the
 * generators it calls rather than spawning this binary.
 */
import { buildAgentContext, buildUsage } from './agent-context.js';
import { buildAgentSkill, writeAgentSkill } from './agent-skill.js';
import { EXIT_CODES, exitCodeFor, toErrorPayload, usageError } from './errors.js';
import { serveHttp, serveStdio } from './server.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

/** Where the CLI writes. Injectable so tests never touch the real streams. */
export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

interface ParsedArgs {
  readonly command: 'serve' | 'agent-context' | 'usage' | 'skill' | 'help' | 'version';
  readonly json: boolean;
  readonly http: boolean;
  readonly port: number | undefined;
  readonly host: string | undefined;
  /** Destination directory for `skill`; without it the package goes to stdout. */
  readonly out: string | undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: ParsedArgs['command'] = 'serve';
  let json = false;
  let http = false;
  let port: number | undefined;
  let host: string | undefined;
  let out: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    switch (arg) {
      case '--json':
        json = true;
        break;
      case '--http':
        http = true;
        break;
      case '--port': {
        const value = Number(argv[index + 1]);
        if (!Number.isInteger(value) || value < 0 || value > 65_535) {
          throw usageError('--port needs an integer between 0 and 65535');
        }
        port = value;
        index += 1;
        break;
      }
      case '--host':
        host = argv[index + 1];
        if (host === undefined) throw usageError('--host needs a value');
        index += 1;
        break;
      case '--out':
        out = argv[index + 1];
        if (out === undefined) throw usageError('--out needs a directory');
        index += 1;
        break;
      case '--help':
      case '-h':
        command = 'help';
        break;
      case '--version':
      case '-v':
        command = 'version';
        break;
      case 'serve':
      case 'stdio':
        command = 'serve';
        break;
      case 'agent-context':
        command = 'agent-context';
        break;
      case 'usage':
        command = 'usage';
        break;
      case 'skill':
        command = 'skill';
        break;
      default:
        throw usageError(
          `unknown argument ${JSON.stringify(arg)}`,
          'run `termwright-mcp usage` for the one-screen cheat sheet',
        );
    }
  }
  return { command, json, http, port, host, out };
}

/**
 * Runs the CLI and resolves with the process exit code. Serving blocks until
 * the transport closes, so `serve` only resolves on shutdown.
 */
export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  // Read before parsing: a failure on a later argument must still honour --json.
  let json = argv.includes('--json');
  try {
    const args = parseArgs(argv);
    json = args.json;
    switch (args.command) {
      case 'version':
        io.out(json ? JSON.stringify({ name: SERVER_NAME, version: SERVER_VERSION }) : SERVER_VERSION);
        return EXIT_CODES.ok;
      case 'help':
      case 'usage':
        io.out(json ? JSON.stringify(buildAgentContext()) : buildUsage());
        return EXIT_CODES.ok;
      case 'agent-context':
        io.out(JSON.stringify(buildAgentContext(), null, json ? 0 : 2));
        return EXIT_CODES.ok;
      case 'skill': {
        if (args.out === undefined) {
          const files = buildAgentSkill();
          io.out(
            json
              ? JSON.stringify(Object.fromEntries(files.map((file) => [file.path, file.contents])))
              : files.map((file) => `=== ${file.path}\n${file.contents}`).join('\n'),
          );
          return EXIT_CODES.ok;
        }
        const written = await writeAgentSkill(args.out);
        io.out(json ? JSON.stringify({ written }) : written.join('\n'));
        return EXIT_CODES.ok;
      }
      case 'serve': {
        if (args.http) {
          const handle = await serveHttp({
            ...(args.port === undefined ? {} : { port: args.port }),
            ...(args.host === undefined ? {} : { host: args.host }),
          });
          // stderr, never stdout: stdout may be a protocol stream.
          io.err(`${SERVER_NAME} MCP listening on http://${args.host ?? '127.0.0.1'}:${handle.port}/mcp`);
          await new Promise<void>((resolve) => {
            handle.http.on('close', resolve);
          });
          return EXIT_CODES.ok;
        }
        const running = await serveStdio();
        await new Promise<void>((resolve) => {
          const shutdown = (): void => {
            void running.close().then(resolve, resolve);
          };
          process.once('SIGINT', shutdown);
          process.once('SIGTERM', shutdown);
          running.server.server.onclose = shutdown;
        });
        return EXIT_CODES.ok;
      }
    }
  } catch (error) {
    const payload = toErrorPayload(error);
    io.err(json ? JSON.stringify(payload) : `${payload.kind}: ${payload.message}`);
    if (!json && payload.suggestion !== undefined) io.err(`suggestion: ${payload.suggestion}`);
    return exitCodeFor(payload.kind);
  }
}

/** Entry point for the `termwright-mcp` bin. */
export async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2));
}
