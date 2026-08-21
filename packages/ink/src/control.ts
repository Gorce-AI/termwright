/**
 * The control channel: how a test changes a fixture's props without pretending
 * to be its user.
 *
 * A fixture runs in another process, so `rerender` cannot hand it a React
 * element — it has to send data. The obvious cheap route, writing to the
 * fixture's stdin, is exactly the one that must not be taken: stdin is the
 * simulated *user*, and a harness that multiplexes commands onto it would make
 * every keystroke test depend on nobody typing the escape sequence the harness
 * happens to use. The channel is therefore separate, out of band, and shaped
 * like the one the driver already opens for semantics: the harness listens, the
 * fixture connects, the address travels in the environment.
 *
 * What crosses it is newline-delimited JSON, bounded and authenticated, and
 * nothing on either end ever evaluates a string.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapacityError, ProtocolViolationError, SessionClosedError, TimeoutError } from '@termwright/driver';
import { assertJsonProps, type JsonProps } from './payload.js';

/** Environment variable carrying the control endpoint address. */
export const ENV_CONTROL_ENDPOINT = 'TERMWRIGHT_FIXTURE_CONTROL';

/** Environment variable carrying the shared secret for the control channel. */
export const ENV_CONTROL_TOKEN = 'TERMWRIGHT_FIXTURE_CONTROL_TOKEN';

/**
 * Largest control message accepted, in bytes, in either direction.
 *
 * Deliberately **larger than `MAX_PAYLOAD_BYTES` in `payload.ts`**, capped by
 * the narrowest platform command line because the launch payload travels in
 * argv. A rerender travels over this socket, where no such limit exists, so
 * copying the argv ceiling here would import a constraint from a transport
 * this one does not use.
 *
 * The visible consequence is worth knowing before it surprises someone: props
 * too large to *launch* a fixture with can be small enough to *rerender* it
 * with. See NOTES.md.
 */
export const MAX_CONTROL_BYTES = 64 * 1024;

/** How long a command waits for the fixture to acknowledge it. */
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;

/** The one command the channel carries today. */
export interface RerenderCommand {
  readonly v: 1;
  readonly type: 'rerender';
  readonly props: JsonProps;
}

interface CommandReply {
  readonly v: 1;
  readonly type: 'ok' | 'error';
  readonly detail?: string;
}

/**
 * The harness end of the control channel.
 *
 * Created before the fixture is spawned, so the address exists by the time the
 * process starts and no connection can be missed.
 */
export class ControlChannel {
  readonly endpoint: string;
  readonly token: string;

  readonly #server: Server;
  readonly #directory: string | null;

  #accepted: Socket | null = null;
  #socket: Socket | null = null;
  #buffer = '';
  #pending: { readonly resolve: (reply: CommandReply) => void; readonly reject: (error: Error) => void } | null = null;
  #waitingForFixture: { readonly resolve: () => void; readonly reject: (error: Error) => void }[] = [];
  #everAttached = false;
  #fixtureGone = false;
  #closed = false;

  private constructor(server: Server, endpoint: string, token: string, directory: string | null) {
    this.#server = server;
    this.endpoint = endpoint;
    this.token = token;
    this.#directory = directory;
    this.#server.on('connection', (socket) => this.#accept(socket));
    // A control channel that fails is a rerender that fails, never a crashed
    // test run: the fixture itself keeps rendering whatever it last received.
    this.#server.on('error', () => undefined);
  }

  /** Creates the endpoint and starts listening. */
  static async listen(): Promise<ControlChannel> {
    const server = createServer();
    const token = randomBytes(32).toString('base64url');
    let endpoint: string;
    let directory: string | null = null;

    if (process.platform === 'win32') {
      endpoint = `\\\\.\\pipe\\termwright-control-${randomBytes(16).toString('hex')}`;
    } else {
      directory = await mkdtemp(join(tmpdir(), 'termwright-control-'));
      endpoint = join(directory, 'control.sock');
    }

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    return new ControlChannel(server, endpoint, token, directory);
  }

  /** True once the fixture has connected and authenticated. */
  get connected(): boolean {
    return this.#socket !== null;
  }

  /** Resolves when the fixture attaches, or rejects when the wait runs out. */
  async waitForFixture(timeoutMs: number): Promise<void> {
    if (this.#closed || this.#fixtureGone) throw this.#sessionClosed();
    if (this.#socket !== null) return;
    if (this.#everAttached) {
      // It was here and it is not any more. Waiting out the full timeout would
      // only delay a failure that is already certain.
      throw new SessionClosedError('the fixture disconnected from the control channel', {
        semanticTree: false,
        suggestion: 'the process exited; relaunch the fixture to drive it again',
      });
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waitingForFixture = this.#waitingForFixture.filter((waiter) => waiter.resolve !== onAttach);
        reject(
          new TimeoutError(`the fixture did not attach to the control channel within ${timeoutMs} ms`, {
            semanticTree: false,
            suggestion: 'rerender needs a fixture started by this package; check the runner is the shipped one',
          }),
        );
      }, timeoutMs);
      timer.unref?.();
      const onAttach = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const onClosed = (error: Error): void => {
        clearTimeout(timer);
        reject(error);
      };
      this.#waitingForFixture.push({ resolve: onAttach, reject: onClosed });
    });
  }

  /**
   * Marks the authenticated fixture process as exited.
   *
   * The process lifecycle is more authoritative than the timing of the local
   * socket's `close` event. Calling this before exposing `waitForExit()` to the
   * user makes every later control operation fail as `session-closed`, even if
   * the kernel has not delivered the socket event yet.
   */
  fixtureExited(): void {
    this.#markFixtureGone();
  }

  /**
   * Sends new props and resolves when the fixture reports it applied them.
   *
   * Props are validated here, before anything is written, so an unserializable
   * value fails in the test's own stack rather than as a silent no-op in
   * another process.
   *
   * @throws TypeError when props cannot cross as JSON
   * @throws SessionClosedError when no fixture is attached
   * @throws ProtocolViolationError when the fixture explicitly refuses the command
   * @throws CapacityError when the encoded command exceeds the limit
   * @throws TimeoutError when the fixture does not acknowledge in time
   */
  async rerender(props: JsonProps, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<void> {
    assertJsonProps(props);
    const command: RerenderCommand = { v: 1, type: 'rerender', props };
    const line = `${JSON.stringify(command)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_CONTROL_BYTES) {
      throw new CapacityError(
        `rerender props exceed the ${MAX_CONTROL_BYTES}-byte control-message limit`,
        {
          semanticTree: false,
          suggestion: 'send an identifier and let the fixture module load the bulk itself',
        },
      );
    }

    const socket = this.#socket;
    if (socket === null || this.#closed || this.#fixtureGone) throw this.#sessionClosed();

    const reply = await new Promise<CommandReply>((resolve, reject) => {
      const pending = {
        resolve: (value: CommandReply): void => {
          clearTimeout(timer);
          if (this.#pending === pending) this.#pending = null;
          resolve(value);
        },
        reject: (error: Error): void => {
          clearTimeout(timer);
          if (this.#pending === pending) this.#pending = null;
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        if (this.#pending === pending) this.#pending = null;
        reject(
          new TimeoutError(`the fixture did not acknowledge the rerender within ${timeoutMs} ms`, {
            semanticTree: false,
          }),
        );
      }, timeoutMs);
      timer.unref?.();
      this.#pending = pending;
      socket.write(line, (error) => {
        if (error === undefined || error === null) return;
        clearTimeout(timer);
        if (this.#pending === pending) this.#pending = null;
        this.#markFixtureGone();
        reject(this.#sessionClosed(`the rerender could not be delivered: ${error.message}`));
      });
    });

    if (reply.type === 'error') {
      throw new ProtocolViolationError(`the fixture refused the rerender: ${reply.detail ?? 'no detail given'}`, {
        semanticTree: false,
        suggestion: 'the runner rejects props it cannot apply; check the component accepts them',
      });
    }
  }

  /** Closes the endpoint and removes the socket directory. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectLifecycleWaiters(this.#sessionClosed('the control channel was closed'));
    this.#accepted?.destroy();
    this.#accepted = null;
    this.#socket?.destroy();
    this.#socket = null;
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    if (this.#directory !== null) {
      await rm(this.#directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  #accept(socket: Socket): void {
    // One fixture, one connection — before authentication as much as after.
    // Sharing the line buffer between two unauthenticated peers would let one
    // of them split the other's messages.
    if (this.#closed || this.#accepted !== null) {
      socket.destroy();
      return;
    }
    this.#accepted = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.#consume(socket, chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (this.#accepted === socket) this.#accepted = null;
      if (this.#socket === socket) this.#markFixtureGone(socket);
    });
  }

  #consume(socket: Socket, chunk: string): void {
    this.#buffer += chunk;
    if (this.#buffer.length > MAX_CONTROL_BYTES) {
      // A peer that floods the channel is not the fixture behaving badly, it is
      // something else on the socket; drop it rather than grow without bound.
      this.#buffer = '';
      socket.destroy();
      return;
    }

    for (;;) {
      const newline = this.#buffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#handleLine(socket, line);
    }
  }

  #handleLine(socket: Socket, line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      socket.destroy();
      return;
    }
    if (typeof message !== 'object' || message === null) {
      socket.destroy();
      return;
    }

    const record = message as Record<string, unknown>;

    if (this.#socket === null) {
      // Until the token checks out this connection is a stranger, and the only
      // message a stranger may send is the hello that makes it the fixture.
      if (record['type'] !== 'hello' || record['token'] !== this.token) {
        socket.destroy();
        return;
      }
      this.#socket = socket;
      this.#everAttached = true;
      const waiters = this.#waitingForFixture;
      this.#waitingForFixture = [];
      for (const waiter of waiters) waiter.resolve();
      return;
    }

    if (socket !== this.#socket) {
      socket.destroy();
      return;
    }
    if (record['type'] !== 'ok' && record['type'] !== 'error') return;
    this.#pending?.resolve({
      v: 1,
      type: record['type'],
      ...(typeof record['detail'] === 'string' ? { detail: record['detail'] } : {}),
    });
  }

  #markFixtureGone(socket?: Socket): void {
    if (socket !== undefined && this.#socket !== socket) return;
    this.#fixtureGone = true;
    this.#accepted?.destroy();
    this.#accepted = null;
    this.#socket?.destroy();
    this.#socket = null;
    this.#rejectLifecycleWaiters(this.#sessionClosed());
  }

  #rejectLifecycleWaiters(error: SessionClosedError): void {
    const pending = this.#pending;
    this.#pending = null;
    pending?.reject(error);
    const waiters = this.#waitingForFixture;
    this.#waitingForFixture = [];
    for (const waiter of waiters) waiter.reject(error);
  }

  #sessionClosed(message = 'the control channel has no attached fixture'): SessionClosedError {
    return new SessionClosedError(message, {
      semanticTree: false,
      suggestion: 'the fixture exited, or it was not launched by launchInkFixture',
    });
  }
}
