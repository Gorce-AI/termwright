import { spawn, type ChildProcess } from 'node:child_process';
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DESKTOP_HOST_PROTOCOL,
  DESKTOP_CONTROL_ENV,
  MAX_CONTROL_MESSAGE_BYTES,
  encodeControlMessage,
  parseControlMessage,
  validateRunnerUrl,
  type DesktopHostMessage,
} from './protocol.js';
import { withinDeadline } from './deadline.js';

export { DESKTOP_HOST_PROTOCOL, validateRunnerUrl } from './protocol.js';
export { SECURE_WEB_PREFERENCES, contentSecurityPolicy, isAllowedNavigation, isAllowedRequest } from './security.js';

export interface DesktopHostHandle {
  /** Resolves when the user closes the window or the host exits. */
  readonly closed: Promise<void>;
  /** Idempotently asks the host to quit and waits for the process. */
  close(): Promise<void>;
}

export interface DesktopHostLaunchOptions {
  readonly url: string;
  readonly readyTimeoutMs?: number;
  /** Total budget for shutdown acknowledgement plus forced termination. */
  readonly closeTimeoutMs?: number;
  /** Tests and packaged launchers can provide an Electron executable explicitly. */
  readonly executable?: string;
  readonly main?: string;
}

const UNSAFE_ELECTRON_ENV = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NODE_OPTIONS',
  'NODE_INSPECT_RESUME_ON_START',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
]);

/** The host inherits ordinary desktop integration, but never Node/Electron execution overrides. */
export function desktopHostEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => value !== undefined && !UNSAFE_ELECTRON_ENV.has(key)),
  );
}

/** Only the public main-process path belongs in argv; the authenticated URL never does. */
export function desktopHostArguments(main: string): readonly string[] {
  return [main];
}

function electronExecutable(): string {
  const require = createRequire(import.meta.url);
  const value: unknown = require('electron');
  if (typeof value !== 'string' || value === '') throw new Error('Electron executable is unavailable');
  return value;
}

const ELECTRON_VERSION = '43.4.1';
function desktopCacheRoot(fingerprint: string): string {
  const base = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Caches')
    : process.platform === 'win32'
      ? (process.env['LOCALAPPDATA'] ?? tmpdir())
      : (process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'));
  return join(base, 'termwright', 'desktop-host', `${ELECTRON_VERSION}-${process.arch}-${fingerprint}`);
}

function packagedExecutable(bundle: string): string {
  if (process.platform === 'darwin') return join(bundle, 'Termwright.app', 'Contents', 'MacOS', 'Termwright');
  if (process.platform === 'win32') return join(bundle, 'Termwright.exe');
  return join(bundle, 'Termwright');
}

function packagingTarget(): {
  readonly platform: 'darwin' | 'linux' | 'win32';
  readonly arch: 'arm64' | 'x64';
} {
  if (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') {
    throw new Error(`desktop host is not packaged for ${process.platform}`);
  }
  if (process.arch !== 'arm64' && process.arch !== 'x64') {
    throw new Error(`desktop host is not packaged for ${process.arch}`);
  }
  return { platform: process.platform, arch: process.arch };
}

async function hostFingerprint(main: string): Promise<string> {
  const hash = createHash('sha256');
  const dist = dirname(main);
  for (const name of (await readdir(dist)).sort()) {
    if (name.endsWith('.js') || name.startsWith('termwright-icon.')) {
      hash.update(name);
      hash.update(await readFile(join(dist, name)));
    }
  }
  return hash.digest('hex').slice(0, 12);
}

/** Build a correctly named per-platform app bundle once, then reuse it. */
async function ensurePackagedHost(main: string): Promise<string> {
  const cache = desktopCacheRoot(await hostFingerprint(main));
  const bundle = join(cache, 'app');
  const executable = packagedExecutable(bundle);
  if (await access(executable).then(() => true, () => false)) return executable;

  await mkdir(cache, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'termwright-package-'));
  const source = join(work, 'source');
  const output = join(work, 'output');
  await mkdir(source);
  const dist = dirname(main);
  for (const name of await readdir(dist)) {
    if (name.endsWith('.js') || name.startsWith('termwright-icon.')) {
      await cp(join(dist, name), join(source, name));
    }
  }
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: 'termwright-desktop-host-runtime',
    productName: 'Termwright',
    version: '0.2.0',
    main: 'main.js',
  }));

  try {
    const { packager } = await import('@electron/packager');
    const target = packagingTarget();
    const paths = await packager({
      dir: source,
      out: output,
      name: 'Termwright',
      executableName: 'Termwright',
      appBundleId: 'dev.termwright.runner',
      appCategoryType: 'public.app-category.developer-tools',
      electronVersion: ELECTRON_VERSION,
      platform: target.platform,
      arch: target.arch,
      asar: true,
      overwrite: true,
      prune: false,
      quiet: true,
      icon: join(source, target.platform === 'darwin'
        ? 'termwright-icon.icns'
        : target.platform === 'win32'
          ? 'termwright-icon.ico'
          : 'termwright-icon.png'),
    });
    const produced = paths[0];
    if (produced === undefined) throw new Error('Electron packager produced no application');
    const { flipFuses, FuseV1Options, FuseVersion } = await import('@electron/fuses');
    await flipFuses(packagedExecutable(produced), {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: true,
      strictlyRequireAllFuses: true,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // Packager writes ASAR but not Electron's platform-specific integrity
      // metadata. Enabling validation without that metadata makes the signed
      // runtime exit before main.js. OnlyLoadAppFromAsar still prevents an
      // unpacked replacement; integrity moves with signed release artifacts.
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      // The npm Electron distribution contains the shared snapshot, not the
      // browser-process-specific variant this fuse requires.
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      [FuseV1Options.WasmTrapHandlers]: true,
    });
    await rm(bundle, { recursive: true, force: true });
    await rename(produced, bundle);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return executable;
}

function processClosed(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
}

/** Start the companion without placing the authenticated URL in argv or the environment. */
export async function launchDesktopHost(options: DesktopHostLaunchOptions): Promise<DesktopHostHandle> {
  validateRunnerUrl(options.url);
  const readyTimeoutMs = positiveTimeout(options.readyTimeoutMs ?? 10_000, 'readyTimeoutMs');
  const closeTimeoutMs = positiveTimeout(options.closeTimeoutMs ?? 2_000, 'closeTimeoutMs');
  const readyDeadline = performance.now() + readyTimeoutMs;
  const main = options.main ?? fileURLToPath(new URL('./main.js', import.meta.url));
  // Resolve the npm Electron runtime early so a missing/corrupt install fails
  // before packaging rather than producing a partial cache entry.
  if (options.executable === undefined) electronExecutable();
  const executable = options.executable ?? await ensurePackagedHost(main);
  let controlDirectory: string | undefined = process.platform === 'win32'
    ? undefined
    : await mkdtemp(join(tmpdir(), 'termwright-desktop-'));
  const controlAddress = process.platform === 'win32'
    ? `\\\\.\\pipe\\termwright-${randomUUID()}`
    : join(controlDirectory as string, 'control.sock');
  let acceptControl: ((socket: Socket) => void) | undefined;
  const connected = new Promise<Socket>((resolve) => { acceptControl = resolve; });
  let acceptedSocket: Socket | undefined;
  const server = createServer((candidate) => {
    if (acceptedSocket !== undefined) {
      candidate.destroy();
      return;
    }
    acceptedSocket = candidate;
    acceptControl?.(candidate);
  });
  let child: ChildProcess | undefined;
  let socket: Socket | undefined;
  try {
    await withinDeadline(new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(controlAddress, () => {
        server.removeListener('error', reject);
        resolve();
      });
    }), readyDeadline, 'desktop control endpoint did not bind');
    if (process.platform !== 'win32') await chmod(controlAddress, 0o600);
    child = spawn(executable, options.executable === undefined ? [] : [...desktopHostArguments(main)], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...desktopHostEnvironment(), [DESKTOP_CONTROL_ENV]: controlAddress },
    });
    const spawned = child;
    const exitedBeforeConnect = processClosed(spawned).then(() => {
      throw new Error('desktop host exited before connecting');
    });
    socket = await withinDeadline(
      Promise.race([connected, exitedBeforeConnect]),
      readyDeadline,
      'desktop host did not connect to its control endpoint',
    );
    socket.on('error', () => undefined);
    // stop accepting synchronously; its final `close` event follows when the
    // one owned control socket is destroyed during host teardown.
    server.close();
    if (controlDirectory !== undefined) {
      await rm(controlDirectory, { recursive: true, force: true });
      controlDirectory = undefined;
    }
  } catch (error) {
    await rollbackDesktopLaunch({ server, child, socket: socket ?? acceptedSocket, controlDirectory, error });
    throw error;
  }

  const runningChild = child;
  const runningSocket = socket;
  if (runningChild === undefined || runningSocket === undefined) {
    throw new Error('desktop host startup completed without owned process and control socket');
  }
  const exited = processClosed(runningChild);
  const input = runningSocket;
  const output = runningSocket;
  let buffer = '';
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  let didReady = false;
  let lastStage = 'connected';
  let didClose = false;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const closed = new Promise<void>((resolve) => {
    const finish = (): void => {
      if (didClose) return;
      didClose = true;
      resolve();
    };
    runningChild.once('exit', finish);
    runningChild.once('error', finish);
  });

  const accept = (message: DesktopHostMessage): void => {
    if (message.type === 'stage') {
      lastStage = message.stage;
    } else if (message.type === 'ready') {
      didReady = true;
      readyResolve?.();
    } else if (message.type === 'error') {
      readyReject?.(new Error(message.message));
    }
  };
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > MAX_CONTROL_MESSAGE_BYTES * 2) {
      readyReject?.(new Error('desktop host sent too much control data'));
      runningChild.kill('SIGKILL');
      return;
    }
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message = parseControlMessage(line);
        if (message.type === 'stage' || message.type === 'ready' || message.type === 'closed' || message.type === 'error') accept(message);
      } catch {
        readyReject?.(new Error('desktop host sent an invalid control message'));
      }
    }
  });
  runningChild.once('error', (error) => readyReject?.(new Error(`could not start desktop host: ${error.message}`)));
  runningChild.once('exit', () => {
    if (!didReady) readyReject?.(new Error('desktop host exited before the runner loaded'));
  });

  input.write(encodeControlMessage({ protocol: DESKTOP_HOST_PROTOCOL, type: 'bootstrap', url: options.url }));
  try {
    await withinDeadline(ready, readyDeadline, () => `desktop host did not become ready (last stage: ${lastStage})`);
  } catch (error) {
    await rollbackDesktopLaunch({ server, child: runningChild, socket: runningSocket, controlDirectory, error });
    throw error;
  }

  // Losing the authenticated control path means this process can no longer be
  // supervised. Fail closed by terminating it; `closed` resolves only from
  // actual process evidence, never from the socket event itself.
  let shutdownRequested = false;
  runningSocket.once('close', () => {
    if (!shutdownRequested && runningChild.exitCode === null && runningChild.signalCode === null) {
      runningChild.kill('SIGKILL');
    }
  });

  let closePromise: Promise<void> | undefined;

  return {
    closed,
    close(): Promise<void> {
      if (closePromise === undefined) {
        shutdownRequested = true;
        closePromise = closeDesktopHost(runningChild, runningSocket, exited, closeTimeoutMs);
      }
      return closePromise;
    },
  };
}

function positiveTimeout(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a positive finite number`);
  return value;
}


async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

async function rollbackDesktopLaunch(options: {
  readonly server: Server;
  readonly child: ChildProcess | undefined;
  readonly socket: Socket | undefined;
  readonly controlDirectory: string | undefined;
  readonly error: unknown;
}): Promise<void> {
  const failures: unknown[] = [];
  options.socket?.destroy();
  try { await closeServer(options.server); } catch (error) { failures.push(error); }
  if (options.child !== undefined && options.child.exitCode === null && options.child.signalCode === null) {
    options.child.kill('SIGKILL');
    try {
      await withinDeadline(processClosed(options.child), performance.now() + 2_000, 'desktop host did not exit during startup rollback');
    } catch (error) {
      failures.push(error);
    }
  }
  if (options.controlDirectory !== undefined) {
    try { await rm(options.controlDirectory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) {
    throw new AggregateError([options.error, ...failures], 'desktop host startup and rollback failed', { cause: options.error });
  }
}

async function closeDesktopHost(
  child: ChildProcess,
  socket: Socket,
  exited: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    socket.destroy();
    return;
  }
  const deadline = performance.now() + timeoutMs;
  try {
    if (!socket.destroyed) {
      socket.write(encodeControlMessage({ protocol: DESKTOP_HOST_PROTOCOL, type: 'shutdown' }));
      socket.end();
    }
    await withinDeadline(exited, deadline, 'desktop host did not acknowledge shutdown');
  } catch (error) {
    child.kill('SIGKILL');
    try {
      await withinDeadline(exited, performance.now() + 2_000, 'desktop host remained alive after hard termination');
    } catch (killError) {
      throw new AggregateError([error, killError], 'desktop host cleanup failed', { cause: error });
    }
  } finally {
    socket.destroy();
  }
}
