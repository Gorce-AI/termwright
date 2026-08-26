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

/** Maximum simultaneous unauthenticated local peers retained for token proof. */
const MAX_AUTH_CANDIDATES = 8;

/** The one command the channel carries today. */
export interface RerenderCommand {
  readonly v: 1;
  readonly commandId: number;
  readonly type: 'rerender';
  readonly props: JsonProps;
}

type CommandReply = {
  readonly v: 1;
  readonly commandId: number;
  readonly type: 'ok';
  readonly semanticRevision: number;
} | {
  readonly v: 1;
  readonly commandId: number;
  readonly type: 'error';
  readonly detail?: string;
};

/** Internal fault-injection seam for endpoint startup lifecycle tests. */
interface ControlChannelListenDependencies {
  readonly platform?: NodeJS.Platform;
  readonly createServer?: () => Server;
  readonly listen?: (server: Server, endpoint: string) => Promise<void>;
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

  #socket: Socket | null = null;
  readonly #candidateBuffers = new Map<Socket, string>();
  #pending: {
    readonly commandId: number;
    readonly resolve: (reply: CommandReply) => void;
    readonly reject: (error: Error) => void;
  } | null = null;
  #nextCommandId = 1;
  #commandTail: Promise<void> = Promise.resolve();
  #waitingForFixture: { readonly resolve: () => void; readonly reject: (error: Error) => void }[] = [];
  #everAttached = false;
  #fixtureGone = false;
  #closed = false;
  #closePromise: Promise<void> | null = null;

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
  static async listen(dependencies: ControlChannelListenDependencies = {}): Promise<ControlChannel> {
    const server = (dependencies.createServer ?? createServer)();
    const token = randomBytes(32).toString('base64url');
    let endpoint: string;
    let directory: string | null = null;

    if ((dependencies.platform ?? process.platform) === 'win32') {
      endpoint = `\\\\.\\pipe\\termwright-control-${randomBytes(16).toString('hex')}`;
    } else {
      directory = await mkdtemp(join(tmpdir(), 'termwright-control-'));
      endpoint = join(directory, 'control.sock');
    }

    try {
      await (dependencies.listen ?? listenServer)(server, endpoint);
    } catch (error) {
      const cleanupFailures: unknown[] = [];
      try {
        await closeServer(server);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
      if (directory !== null) {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          'control endpoint listen and rollback both failed',
          { cause: error },
        );
      }
      throw error;
    }

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
  async rerender(props: JsonProps, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<number> {
    assertJsonProps(props);
    const command: RerenderCommand = {
      v: 1,
      commandId: this.#nextCommandId,
      type: 'rerender',
      props,
    };
    this.#nextCommandId += 1;
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

    // Commands stay serialized so React cannot coalesce two requested frames.
    // The id additionally prevents a late reply from a failed command from
    // acknowledging the following command.
    const commandRun = this.#commandTail.then(
      () => this.#sendRerender(command.commandId, line, timeoutMs),
    );
    this.#commandTail = commandRun.then(() => undefined, () => undefined);
    return commandRun;
  }

  async #sendRerender(commandId: number, line: string, timeoutMs: number): Promise<number> {
    const socket = this.#socket;
    if (socket === null || this.#closed || this.#fixtureGone) throw this.#sessionClosed();

    const reply = await new Promise<CommandReply>((resolve, reject) => {
      const pending = {
        commandId,
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
    return reply.semanticRevision;
  }

  /** Closes the endpoint and removes the socket directory. Idempotent. */
  close(): Promise<void> {
    this.#closePromise ??= this.#performClose();
    return this.#closePromise;
  }

  async #performClose(): Promise<void> {
    this.#closed = true;
    this.#rejectLifecycleWaiters(this.#sessionClosed('the control channel was closed'));
    for (const candidate of this.#candidateBuffers.keys()) candidate.destroy();
    this.#candidateBuffers.clear();
    this.#socket?.destroy();
    this.#socket = null;
    const failures: unknown[] = [];
    await new Promise<void>((resolve) => this.#server.close((error) => {
      if (error !== undefined) failures.push(error);
      resolve();
    }));
    if (this.#directory !== null) {
      try {
        await rm(this.#directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to close the fixture control channel');
  }

  #accept(socket: Socket): void {
    // Authentication, not connection order, elects the fixture. An idle or
    // partial stranger must never be able to reserve the one control slot.
    if (this.#closed || this.#socket !== null) {
      socket.destroy();
      return;
    }
    if (this.#candidateBuffers.size >= MAX_AUTH_CANDIDATES) {
      const oldest = this.#candidateBuffers.keys().next().value as Socket | undefined;
      if (oldest !== undefined) {
        this.#candidateBuffers.delete(oldest);
        oldest.destroy();
      }
    }
    this.#candidateBuffers.set(socket, '');
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.#consume(socket, chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      this.#candidateBuffers.delete(socket);
      if (this.#socket === socket) this.#markFixtureGone(socket);
    });
  }

  #consume(socket: Socket, chunk: string): void {
    const prior = this.#candidateBuffers.get(socket);
    if (prior === undefined) return;
    let buffer = prior + chunk;
    if (Buffer.byteLength(buffer, 'utf8') > MAX_CONTROL_BYTES) {
      // A peer that floods the channel is not the fixture behaving badly, it is
      // something else on the socket; drop it rather than grow without bound.
      this.#candidateBuffers.delete(socket);
      socket.destroy();
      return;
    }

    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) {
        this.#candidateBuffers.set(socket, buffer);
        return;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      this.#handleLine(socket, line);
      if (!this.#candidateBuffers.has(socket)) return;
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
      if (record['v'] !== 1 || record['type'] !== 'hello' || record['token'] !== this.token) {
        this.#candidateBuffers.delete(socket);
        socket.destroy();
        return;
      }
      this.#socket = socket;
      this.#everAttached = true;
      for (const candidate of this.#candidateBuffers.keys()) {
        if (candidate !== socket) candidate.destroy();
      }
      this.#candidateBuffers.clear();
      this.#candidateBuffers.set(socket, '');
      const waiters = this.#waitingForFixture;
      this.#waitingForFixture = [];
      for (const waiter of waiters) waiter.resolve();
      return;
    }

    if (socket !== this.#socket) {
      socket.destroy();
      return;
    }
    if (record['type'] !== 'ok' && record['type'] !== 'error') {
      this.#failAuthenticatedProtocol(socket, new ProtocolViolationError(
        'the fixture sent an unknown control reply',
        { semanticTree: false, suggestion: 'use the runner shipped with this version of @termwright/ink' },
      ));
      return;
    }
    const commandId = record['commandId'];
    if (!Number.isSafeInteger(commandId) || (commandId as number) <= 0) {
      this.#failAuthenticatedProtocol(socket, new ProtocolViolationError(
        'the fixture acknowledged a rerender without a valid command id',
        { semanticTree: false, suggestion: 'use the runner shipped with this version of @termwright/ink' },
      ));
      return;
    }
    const pending = this.#pending;
    if (pending === null || pending.commandId !== commandId) return;
    if (record['type'] === 'ok') {
      const revision = record['semanticRevision'];
      if (!Number.isSafeInteger(revision) || (revision as number) <= 0) {
        this.#failAuthenticatedProtocol(socket, new ProtocolViolationError(
          'the fixture acknowledged a rerender without a valid semantic revision',
          { semanticTree: false, suggestion: 'use the runner shipped with this version of @termwright/ink' },
        ));
        return;
      }
      pending.resolve({
        v: 1,
        commandId: commandId as number,
        type: 'ok',
        semanticRevision: revision as number,
      });
      return;
    }
    pending.resolve({
      v: 1,
      commandId: commandId as number,
      type: 'error',
      ...(typeof record['detail'] === 'string' ? { detail: record['detail'] } : {}),
    });
  }

  #failAuthenticatedProtocol(socket: Socket, error: ProtocolViolationError): void {
    this.#pending?.reject(error);
    this.#markFixtureGone(socket);
  }

  #markFixtureGone(socket?: Socket): void {
    if (socket !== undefined && this.#socket !== socket) return;
    this.#fixtureGone = true;
    for (const candidate of this.#candidateBuffers.keys()) candidate.destroy();
    this.#candidateBuffers.clear();
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

async function listenServer(server: Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined || (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') resolve();
    else reject(error);
  }));
}
