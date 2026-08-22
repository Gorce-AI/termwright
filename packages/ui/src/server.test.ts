import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { WebSocket } from "ws";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNativeRunFixture } from "./__fixtures__/native-run.js";
import {
  buildCrashedFixtureTrace,
  buildFixtureTrace,
} from "./__fixtures__/build-trace.js";
import { FakeHarness, node, snapshot } from "./__fixtures__/fake-session.js";
import {
  encodeMessage,
  parseServerMessage,
  toBase64,
  type ClientMessage,
  type ServerMessage,
} from "./events.js";
import {
  startUiServer,
  type UiServer,
  type UiServerOptions,
} from "./server.js";
import {
  createRunId,
  type EffectiveSessionContract,
  type EvidenceProvenance,
} from "@termwright/protocol";
import type { DiscoveredTest } from "./discovery.js";

const servers: UiServer[] = [];
const tempDirectories: string[] = [];

async function rewriteCommittedMember(
  path: string,
  name: string,
  body: string,
): Promise<void> {
  await writeFile(join(path, name), body, "utf8");
  const commitPath = join(path, "COMMITTED");
  const commit = JSON.parse(await readFile(commitPath, "utf8")) as {
    v: 1;
    checksums: Record<string, string>;
  };
  commit.checksums[name] = createHash("sha256").update(body).digest("hex");
  await writeFile(commitPath, `${JSON.stringify(commit)}\n`, "utf8");
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

type TestServerOptions = Omit<UiServerOptions, "discovery" | "onRun"> & {
  readonly discovery?: {
    readonly cwd: string;
    readonly watch?: boolean;
    readonly run: () => Promise<string>;
  };
  readonly onRun?: (ids: readonly string[] | undefined) => void | Promise<void>;
};

async function start(options: TestServerOptions = {}): Promise<UiServer> {
  const { discovery, onRun, ...rest } = options;
  const server = await startUiServer({
    ...rest,
    ...(discovery === undefined
      ? {}
      : {
          discovery: {
            cwd: discovery.cwd,
            ...(discovery.watch === undefined
              ? {}
              : { watch: discovery.watch }),
            load: async () => testListing(await discovery.run()),
          },
        }),
    ...(onRun === undefined
      ? {}
      : {
          onRun: (ids) => ({
            runId: createRunId("run"),
            completed: Promise.resolve().then(() => onRun(ids)),
          }),
        }),
  });
  servers.push(server);
  return server;
}

function testListing(json: string): readonly DiscoveredTest[] {
  const parsed = JSON.parse(json) as readonly Record<string, unknown>[];
  return parsed.map((item, index) => {
    const result: Record<string, unknown> = {
      id: `runner-task:00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title: item["name"] as string,
      file: item["file"] as string,
    };
    for (const key of ["provider", "kind", "ancestors", "tags", "source"]) {
      if (item[key] !== undefined) result[key] = item[key];
    }
    return result as unknown as DiscoveredTest;
  });
}

/** A browser tab: connects, collects messages, sends client messages. */
class Viewer {
  readonly received: ServerMessage[] = [];
  readonly #socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (raw: Buffer) => {
      this.received.push(parseServerMessage(raw));
    });
  }

  static async connect(server: UiServer, role?: string): Promise<Viewer> {
    const url = new URL(server.url);
    url.protocol = "ws:";
    url.pathname = "/ws";
    if (role !== undefined) url.searchParams.set("role", role);
    const socket = new WebSocket(url);
    // The listener has to be attached before the socket opens: the server
    // replays its backlog the moment the upgrade completes.
    const viewer = new Viewer(socket);
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });
    return viewer;
  }

  send(message: ClientMessage | ServerMessage): void {
    this.#socket.send(encodeMessage(message as ServerMessage));
  }

  sendRaw(text: string): void {
    this.#socket.send(text);
  }

  close(): void {
    this.#socket.close();
  }

  /** Waits until `predicate` holds over the collected messages. */
  async until(
    predicate: (messages: readonly ServerMessage[]) => boolean,
    label: string,
  ): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (predicate(this.received)) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(
      `timed out waiting for ${label}; received: ${this.received.map((m) => m.type).join(", ")}`,
    );
  }
}

async function api(
  server: UiServer,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(path, server.url);
  url.searchParams.set("token", server.token);
  return fetch(url, init);
}

async function waitUntil(
  predicate: () => boolean,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("authentication", () => {
  it("rejects HTTP without the token", async () => {
    const server = await start();
    const response = await fetch(new URL("/api/state", server.url));
    expect(response.status).toBe(401);
  });

  it("does not accept the static-asset cookie for API control", async () => {
    const server = await start();
    const root = await fetch(server.url);
    const cookie = root.headers.get("set-cookie");
    expect(cookie).toContain("termwright_token=");

    const response = await fetch(new URL("/api/record/start", server.url), {
      method: "POST",
      headers: { cookie: cookie ?? "" },
      body: JSON.stringify({
        command: ["node", "-e", "process.stdin.resume()"],
      }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects a WebSocket upgrade without the token", async () => {
    const server = await start();
    const url = new URL(server.url);
    url.protocol = "ws:";
    url.pathname = "/ws";
    url.searchParams.delete("token");
    const socket = new WebSocket(url);
    await expect(
      new Promise((done, fail) => {
        socket.once("open", () => done("opened"));
        socket.once("error", fail);
      }),
    ).rejects.toThrow(/401/);
  });

  it("does not accept the static-asset cookie for a WebSocket upgrade", async () => {
    const server = await start();
    const root = await fetch(server.url);
    const cookie = root.headers.get("set-cookie") ?? "";
    const url = new URL(server.url);
    url.protocol = "ws:";
    url.pathname = "/ws";
    url.searchParams.delete("token");
    const socket = new WebSocket(url, { headers: { cookie } });
    await expect(
      new Promise((done, fail) => {
        socket.once("open", () => done("opened"));
        socket.once("error", fail);
      }),
    ).rejects.toThrow(/401/);
  });

  it("accepts the token in a header, for API clients", async () => {
    const server = await start();
    const response = await fetch(new URL("/api/state", server.url), {
      headers: { "x-termwright-token": server.token },
    });
    expect(response.status).toBe(200);
  });
});

describe("live mode", () => {
  it("streams a session as output and semantic messages", async () => {
    const server = await start();
    const session = new FakeHarness("s1");
    server.attach({ source: session });
    const viewer = await Viewer.connect(server);

    session.output("Permission required");
    const tree = snapshot(
      4,
      [node({ id: "b1", role: "button", name: "Approve" })],
      "s1",
    );
    session.semantic(tree);

    await viewer.until(
      (messages) => messages.some((m) => m.type === "semantic"),
      "the tree",
    );
    // `session` comes first: the browser sizes its terminal from it.
    expect(viewer.received.map((message) => message.type)).toEqual([
      "session",
      "output",
      "semantic",
    ]);
    const announced = viewer.received[0];
    expect(announced?.type === "session" && announced.terminalProfile).toBe(
      "default",
    );
    expect(announced?.type === "session" && announced.columns).toBe(80);
    const output = viewer.received[1];
    expect(output?.type === "output" && output.dataB64).toBe(
      toBase64(new TextEncoder().encode("Permission required")),
    );
    viewer.close();
  });

  it("delivers a run published by a producer to every viewer", async () => {
    const server = await start();
    const producer = await Viewer.connect(server, "producer");
    const viewer = await Viewer.connect(server);

    producer.send({
      v: 1,
      type: "run-start",
      runId: "run:test",
      mode: "live",
      startedAt: 1,
    });
    producer.send({
      v: 1,
      type: "test-start",
      id: "t1",
      title: "login",
      file: "/repo/a.test.ts",
      startedAt: 1,
    });
    producer.send({
      v: 1,
      type: "test-end",
      id: "t1",
      status: "passed",
      durationMs: 12,
      flaky: false,
      lostLogRecords: 0,
    });

    await viewer.until(
      (messages) => messages.some((m) => m.type === "test-end"),
      "the test result",
    );
    expect(viewer.received.map((message) => message.type)).toEqual([
      "run-start",
      "test-start",
      "test-end",
    ]);
    viewer.close();
    producer.close();
  });

  it("routes rerun and stop to the callbacks the runner supplied", async () => {
    const reruns: (readonly string[] | undefined)[] = [];
    let stopped = 0;
    let releaseRun: (() => void) | undefined;
    const server = await start({
      onRun: (testIds) => {
        reruns.push(testIds);
        return new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
      },
      onStop: () => {
        stopped += 1;
      },
    });
    const viewer = await Viewer.connect(server);
    const runResponse = await api(server, "/api/run", {
      method: "POST",
      body: JSON.stringify({ runnerTaskIds: ["t1"] }),
    });
    const { runId } = (await runResponse.json()) as { runId: string };
    await api(server, "/api/stop", {
      method: "POST",
      body: JSON.stringify({ runId }),
    });

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (reruns.length === 0 || stopped === 0)) {
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(reruns).toEqual([["t1"]]);
    expect(stopped).toBe(1);
    releaseRun?.();
    viewer.close();
  });

  it("announces cancellation only after the stopped process exits", async () => {
    let release: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseRun: (() => void) | undefined;
    const server = await start({
      onRun: () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
      onStop: () => stopped,
    });
    server.hub.publish({
      v: 1,
      type: "run-start",
      runId: "run:test",
      mode: "live",
      startedAt: Date.now() - 20,
    });
    server.hub.publish({
      v: 1,
      type: "test-start",
      id: "running",
      title: "long test",
      file: "long.test.ts",
      startedAt: Date.now() - 10,
    });
    const viewer = await Viewer.connect(server);
    const runResponse = await api(server, "/api/run", {
      method: "POST",
      body: "{}",
    });
    const { runId } = (await runResponse.json()) as { runId: string };
    const stopRequest = api(server, "/api/stop", {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
    await new Promise((done) => setTimeout(done, 20));
    expect(
      viewer.received.some((message) => message.type === "run-cancelled"),
    ).toBe(false);
    release?.();
    await stopRequest;
    await viewer.until(
      (messages) =>
        messages.some((message) => message.type === "run-cancelled"),
      "run cancellation",
    );
    expect(viewer.received.at(-1)).toMatchObject({ type: "run-cancelled" });
    releaseRun?.();
    viewer.close();
  });

  it("reports a failed stop without rejecting the socket handler", async () => {
    let releaseRun: (() => void) | undefined;
    const server = await start({
      onRun: () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
      onStop: async () => {
        throw new Error("child refused to exit");
      },
    });
    const viewer = await Viewer.connect(server);
    const runResponse = await api(server, "/api/run", {
      method: "POST",
      body: "{}",
    });
    const { runId } = (await runResponse.json()) as { runId: string };
    await api(server, "/api/stop", {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
    await viewer.until(
      (messages) =>
        messages.some((message) => message.type === "run-cancel-failed"),
      "stop failure",
    );
    expect(viewer.received.at(-1)).toEqual({
      v: 1,
      type: "run-cancel-failed",
      error: "child refused to exit",
    });
    releaseRun?.();
    viewer.close();
  });

  it("keeps a long failed-stop error valid on the UI wire", async () => {
    let releaseRun: (() => void) | undefined;
    const server = await start({
      onRun: () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        }),
      onStop: async () => {
        throw new Error("x".repeat(300));
      },
    });
    const viewer = await Viewer.connect(server);
    const runResponse = await api(server, "/api/run", {
      method: "POST",
      body: "{}",
    });
    const { runId } = (await runResponse.json()) as { runId: string };
    await api(server, "/api/stop", {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
    await viewer.until(
      (messages) =>
        messages.some((message) => message.type === "run-cancel-failed"),
      "bounded stop failure",
    );
    const failure = viewer.received.at(-1);
    expect(failure).toMatchObject({ v: 1, type: "run-cancel-failed" });
    expect(
      failure?.type === "run-cancel-failed" ? failure.error : "",
    ).toHaveLength(256);
    releaseRun?.();
    viewer.close();
  });

  it("survives a malformed frame without dropping the connection", async () => {
    const server = await start();
    const viewer = await Viewer.connect(server);
    viewer.sendRaw("}{ not json");
    viewer.sendRaw('{"v":1,"type":"nonsense"}');
    const session = new FakeHarness("s1");
    server.attach({ source: session });
    session.output("still here");
    await viewer.until(
      (messages) => messages.some((m) => m.type === "output"),
      "output after bad frames",
    );
    viewer.close();
  });

  it("streams application logs to the browser", async () => {
    const server = await start();
    const session = new FakeHarness("s1");
    server.attach({ source: session });
    const viewer = await Viewer.connect(server);

    session.logLine("starting up");
    session.logRecord({
      level: "error",
      message: "connection refused",
      logger: "db",
    });

    await viewer.until(
      (messages) => messages.filter((m) => m.type === "app-log").length === 2,
      "both logs",
    );
    const [line, record] = viewer.received.filter(
      (message) => message.type === "app-log",
    );
    expect(line?.type === "app-log" && line.level).toBeNull();
    expect(line?.type === "app-log" && line.message).toBe("starting up");
    expect(record?.type === "app-log" && record.level).toBe("error");
    expect(record?.type === "app-log" && record.logger).toBe("db");
    viewer.close();
  });

  it("publishes the project\u2019s tests before anything runs", async () => {
    const listing = JSON.stringify([
      {
        name: "authentication > logs in",
        file: "/repo/tests/auth.feature",
        provider: { id: "@termwright/test", version: 1 },
        kind: "gherkin-scenario",
        ancestors: [{ kind: "feature", title: "authentication" }],
        tags: ["@smoke"],
        source: { file: "/repo/tests/auth.feature", line: 3, column: 3 },
      },
      { name: "renders the menu", file: "/repo/tests/menu.test.ts" },
    ]);
    const server = await start({
      discovery: { cwd: "/repo", run: async () => listing },
    });
    const viewer = await Viewer.connect(server);

    await viewer.until(
      (messages) => messages.some((m) => m.type === "tests-discovered"),
      "the listing",
    );
    const discovered = viewer.received.find(
      (message) => message.type === "tests-discovered",
    );
    expect(
      discovered?.type === "tests-discovered" &&
        discovered.tests.map((test) => test.title),
    ).toEqual(["authentication > logs in", "renders the menu"]);
    expect(
      discovered?.type === "tests-discovered" && discovered.tests[0],
    ).toMatchObject({
      id: "runner-task:00000000-0000-4000-8000-000000000001",
      provider: { id: "@termwright/test", version: 1 },
      kind: "gherkin-scenario",
      ancestors: [{ kind: "feature", title: "authentication" }],
      tags: ["@smoke"],
      source: { file: "/repo/tests/auth.feature", line: 3, column: 3 },
    });
    viewer.close();
  });

  it("reports collection failure without fabricating an empty catalogue", async () => {
    const server = await start({
      discovery: {
        cwd: "/repo",
        run: async () => {
          throw new Error("vitest: not found");
        },
      },
    });
    const viewer = await Viewer.connect(server);
    await viewer.until(
      (messages) =>
        messages.some((message) => message.type === "collection-failed"),
      "the collection failure",
    );
    expect(
      viewer.received.findLast(
        (message) => message.type === "collection-failed",
      ),
    ).toMatchObject({
      error: "vitest: not found",
    });
    viewer.close();
  });

  it("re-lists .feature changes and publishes an empty catalogue after the last case is deleted", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "termwright-discovery-feature-"),
    );
    tempDirectories.push(directory);
    const feature = join(directory, "case.feature");
    await writeFile(feature, "Feature: initial\n", "utf8");
    let listing = JSON.stringify([{ name: "scenario", file: feature }]);
    const server = await start({
      discovery: { cwd: directory, watch: true, run: async () => listing },
    });
    const viewer = await Viewer.connect(server);
    await viewer.until(
      (messages) =>
        messages.some((message) => message.type === "tests-discovered"),
      "the initial feature listing",
    );

    listing = "[]";
    await rm(feature);
    await viewer.until(
      (messages) =>
        messages.filter((message) => message.type === "tests-discovered")
          .length >= 2,
      "the empty feature listing",
    );
    expect(
      viewer.received.findLast(
        (message) => message.type === "tests-discovered",
      ),
    ).toMatchObject({
      tests: [],
    });
    viewer.close();
  });

  it("does not let a slower stale discovery overwrite a newer feature listing", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "termwright-discovery-race-"),
    );
    tempDirectories.push(directory);
    let finishFirst: ((listing: string) => void) | undefined;
    let calls = 0;
    const first = new Promise<string>((resolve) => {
      finishFirst = resolve;
    });
    const current = JSON.stringify([
      { name: "new", file: join(directory, "race.feature") },
    ]);
    const stale = JSON.stringify([
      { name: "stale", file: join(directory, "race.feature") },
    ]);
    const server = await start({
      discovery: {
        cwd: directory,
        watch: true,
        run: async () => (++calls === 1 ? first : current),
      },
    });
    const viewer = await Viewer.connect(server);
    await waitUntil(() => calls === 1, "the initial listing to start");

    await writeFile(
      join(directory, "race.feature"),
      "Feature: current\n",
      "utf8",
    );
    await viewer.until(
      (messages) =>
        messages.some(
          (message) =>
            message.type === "tests-discovered" &&
            message.tests[0]?.title === "new",
        ),
      "the newer listing",
    );
    finishFirst?.(stale);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      viewer.received.some(
        (message) =>
          message.type === "tests-discovered" &&
          message.tests[0]?.title === "stale",
      ),
    ).toBe(false);
    viewer.close();
  });

  it("lists attached sessions over HTTP", async () => {
    const server = await start();
    const session = new FakeHarness("s1");
    const detach = server.attach({
      source: session,
      command: ["node", "app.js"],
    });
    const body = (await (await api(server, "/api/state")).json()) as {
      mode: string;
      sessions: { sessionId: string; writable: boolean }[];
    };
    expect(body.mode).toBe("live");
    expect(body.sessions).toEqual([
      {
        sessionId: "s1",
        command: ["node", "app.js"],
        columns: 80,
        rows: 24,
        terminalProfile: "default",
        writable: false,
      },
    ]);
    detach();
    const after = (await (await api(server, "/api/state")).json()) as {
      sessions: unknown[];
    };
    expect(after.sessions).toHaveLength(0);
  });

  it("starts an ordinary live server idle without inventing a run lifecycle", async () => {
    const server = await start({ onRun: () => undefined });
    const viewer = await Viewer.connect(server);
    expect(
      server.hub.backlog.some((message) => message.type === "run-start"),
    ).toBe(false);
    expect(
      viewer.received.some((message) => message.type === "run-start"),
    ).toBe(false);
    const state = (await (await api(server, "/api/state")).json()) as {
      mode: string;
      canRun: boolean;
    };
    expect(state).toMatchObject({ mode: "live", canRun: true });
    viewer.close();
  });
});

describe("run history", () => {
  it("lists recorded runs and serves one by id", async () => {
    const runsDir = await mkdtemp(join(tmpdir(), "tw-server-runs-"));
    const runId = await writeNativeRunFixture(runsDir, {
      startedAt: 1_760_000_000_000,
      tests: [
        {
          title: "logs in",
          file: "/repo/a.test.ts",
          status: "failed",
          durationMs: 500,
        },
      ],
    });
    const server = await start({ runsDir });

    const list = (await (await api(server, "/api/runs")).json()) as {
      runs: { id: string; testCount: number }[];
    };
    expect(list.runs.map((run) => run.id)).toEqual([runId]);
    expect(list.runs[0]?.testCount).toBe(1);

    const detail = (await (
      await api(server, `/api/run?id=${encodeURIComponent(runId)}`)
    ).json()) as { state: string; tests: { title: string }[] };
    expect(detail).toMatchObject({
      state: "complete",
      tests: [{ title: "logs in" }],
    });
  });

  it("reports no history rather than failing when nothing was recorded", async () => {
    const server = await start({
      runsDir: join(await mkdtemp(join(tmpdir(), "tw-empty-")), "none"),
    });
    const body = (await (await api(server, "/api/runs")).json()) as {
      runs: unknown[];
    };
    expect(body.runs).toEqual([]);
  });

  it("404s a run that is not there", async () => {
    const server = await start({
      runsDir: await mkdtemp(join(tmpdir(), "tw-empty-")),
    });
    expect((await api(server, "/api/run?id=nope")).status).toBe(400);
    expect((await api(server, "/api/run")).status).toBe(400);
  });

  it("opens an archive for one client without replacing the server replay", async () => {
    const first = await buildFixtureTrace();
    const second = await buildCrashedFixtureTrace();
    const server = await start({ trace: first });

    const before = (await (await api(server, "/api/state")).json()) as {
      trace: { path: string };
    };
    expect(before.trace.path).toBe(first);

    const opened = await api(server, "/api/trace/open", {
      method: "POST",
      body: JSON.stringify({ path: second }),
    });
    expect(opened.status).toBe(200);

    const openedBody = (await opened.json()) as {
      trace: { path: string; crash: unknown };
    };
    expect(openedBody.trace.path).toBe(second);
    expect(openedBody.trace.crash).not.toBeNull();

    const after = (await (await api(server, "/api/state")).json()) as {
      trace: { path: string; crash: unknown };
    };
    // The initial --trace remains the server-wide default for another tab.
    expect(after.trace.path).toBe(first);
    const commands = (await (
      await api(
        server,
        `/api/trace/commands?archive=${encodeURIComponent(second)}`,
      )
    ).json()) as { commands: unknown[] };
    expect(Array.isArray(commands.commands)).toBe(true);
  });

  it("refuses to open something that is not an archive", async () => {
    const server = await start({ trace: await buildFixtureTrace() });
    expect(
      (
        await api(server, "/api/trace/open", {
          method: "POST",
          body: JSON.stringify({ path: "/nonexistent.twtrace" }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(server, "/api/trace/open", {
          method: "POST",
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(400);
  });
});

describe("post-mortem mode", () => {
  it("replays the archive timeline on connect and serves state at a moment", async () => {
    const server = await start({ trace: await buildFixtureTrace() });
    const viewer = await Viewer.connect(server);
    await viewer.until(
      (messages) => messages.some((m) => m.type === "run-end"),
      "the replayed run",
    );
    expect(viewer.received.map((message) => message.type)).toEqual([
      "run-start",
      "session",
      "test-start",
      "step",
      "step",
      "test-end",
      "run-end",
    ]);

    const state = (await (
      await api(server, "/api/trace/state?t=500")
    ).json()) as {
      castPrefixB64: string;
      revision: number;
    };
    expect(
      Buffer.from(state.castPrefixB64, "base64").toString("utf8"),
    ).toContain("Permission required");
    expect(state.revision).toBe(1);
    viewer.close();
  });

  it("serves the crash section of a crashed archive", async () => {
    const server = await start({ trace: await buildCrashedFixtureTrace() });
    const body = (await (await api(server, "/api/state")).json()) as {
      trace: {
        crash: { cause: string; screenTail: string[] } | null;
        markers: { kind: string }[];
      };
    };
    expect(body.trace.crash?.cause).toBe("signal SIGSEGV");
    expect(body.trace.crash?.screenTail.join("\n")).toContain(
      "panic: runtime error",
    );
    expect(body.trace.markers.some((marker) => marker.kind === "crash")).toBe(
      true,
    );
  });

  it("drops an unreadable crash section instead of failing to open the archive", async () => {
    const dir = await buildCrashedFixtureTrace();
    const metaPath = join(dir, "meta.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<
      string,
      unknown
    >;
    await rewriteCommittedMember(
      dir,
      "meta.json",
      JSON.stringify({ ...meta, crash: { exit: "died horribly" } }),
    );

    const server = await start({ trace: dir });
    const body = (await (await api(server, "/api/state")).json()) as {
      trace: { crash: unknown; markers: { kind: string }[]; steps: unknown[] };
    };
    expect(body.trace.crash).toBeNull();
    expect(body.trace.markers.some((marker) => marker.kind === "crash")).toBe(
      false,
    );
    // The rest of the archive still opened and is still browsable.
    expect((await api(server, "/api/trace/state?t=0")).status).toBe(200);
  });

  it("serves the archive’s application logs", async () => {
    const server = await start({ trace: await buildFixtureTrace() });
    const body = (await (await api(server, "/api/trace/logs")).json()) as {
      available: boolean;
      records: { message: string; level: string | null }[];
      sources: { label?: string; path?: string }[];
      total: number;
    };
    expect(body.available).toBe(true);
    expect(body.records.map((entry) => entry.message)).toEqual([
      "listening on 3000",
      "pool exhausted",
    ]);
    expect(body.total).toBe(2);
    expect(body.records[0]?.level).toBeNull();
    expect(body.records[1]?.level).toBe("warn");
    expect(body.sources.map((source) => source.label)).toContain("server.log");
  });

  it("serves a window of the log, and says what lies outside it", async () => {
    const server = await start({ trace: await buildFixtureTrace() });
    const first = (await (
      await api(server, "/api/trace/logs?limit=1")
    ).json()) as {
      records: { message: string; t: number }[];
      hasMoreBefore: boolean;
      hasMoreAfter: boolean;
    };
    expect(first.records.map((entry) => entry.message)).toEqual([
      "pool exhausted",
    ]);
    expect(first.hasMoreBefore).toBe(true);
    expect(first.hasMoreAfter).toBe(false);

    const older = (await (
      await api(server, `/api/trace/logs?before=1050&limit=5`)
    ).json()) as {
      records: { message: string }[];
      hasMoreAfter: boolean;
    };
    expect(older.records.map((entry) => entry.message)).toEqual([
      "listening on 3000",
    ]);
    expect(older.hasMoreAfter).toBe(true);
  });

  it("reports an archive that recorded no logs as unavailable", async () => {
    const server = await start({ trace: await buildCrashedFixtureTrace() });
    const body = (await (await api(server, "/api/trace/logs")).json()) as {
      available: boolean;
      records: unknown[];
    };
    expect(body.available).toBe(false);
    expect(body.records).toEqual([]);
  });

  it("serves the command log and the frames of a recording", async () => {
    const server = await start({ trace: await buildFixtureTrace() });

    const commands = (await (
      await api(server, "/api/trace/commands")
    ).json()) as {
      commands: { kind: string; label: string; t: number }[];
      incomplete: boolean;
    };
    expect(commands.commands.map((row) => [row.kind, row.label])).toEqual([
      ["action", "locator.click"],
      ["step", "approve"],
    ]);
    expect(commands.incomplete).toBe(false);

    const frames = (await (await api(server, "/api/trace/frames")).json()) as {
      frames: { t: number; kind: string; dataB64?: string }[];
      durationMs: number;
      revisions: { t: number; revision: number }[];
      truncated: boolean;
    };
    expect(frames.truncated).toBe(false);
    expect(frames.frames.length).toBeGreaterThan(0);
    expect(frames.frames.every((frame) => frame.t <= frames.durationMs)).toBe(
      true,
    );
    expect(
      Buffer.from(frames.frames[0]?.dataB64 ?? "", "base64").toString("utf8"),
    ).toContain("Permission required");
    expect(frames.revisions.map((entry) => entry.revision)).toEqual([1, 2]);
  });

  it("has no command log or frames when the server is live", async () => {
    const server = await start();
    expect((await api(server, "/api/trace/commands")).status).toBe(409);
    expect((await api(server, "/api/trace/frames")).status).toBe(409);
  });

  it("reports no trace when the server is live", async () => {
    const server = await start();
    expect((await api(server, "/api/trace/state?t=0")).status).toBe(409);
    expect((await api(server, "/api/trace/logs")).status).toBe(409);
  });
});

describe("starting a run from the panel", () => {
  it("answers whether the run started, not whether it passed", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const server = await start({
      onRun: (testIds) => {
        asked.push(testIds);
      },
    });

    const response = await fetch(
      `${server.url.replace(/\?.*/, "")}api/run?token=${server.token}`,
      {
        method: "POST",
        body: JSON.stringify({ runnerTaskIds: ["tests/a.test.ts"] }),
      },
    );
    expect(response.status).toBe(202);
    expect(asked).toEqual([["tests/a.test.ts"]]);
  });

  it("accepts admission immediately and reports later infrastructure failure on the event stream", async () => {
    const server = await start({
      onRun: () => {
        throw new Error("vitest is not installed in this project");
      },
    });

    const response = await fetch(
      `${server.url.replace(/\?.*/, "")}api/run?token=${server.token}`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(202);
    await waitUntil(
      () =>
        server.hub.backlog.some(
          (message) => message.type === "run-infrastructure-failed",
        ),
      "the authoritative infrastructure failure",
    );
    expect(
      server.hub.backlog.findLast(
        (message) => message.type === "run-infrastructure-failed",
      ),
    ).toMatchObject({
      error: "vitest is not installed in this project",
    });
  });

  it("refuses when there is no runner behind the panel", async () => {
    const server = await start({});
    const response = await fetch(
      `${server.url.replace(/\?.*/, "")}api/run?token=${server.token}`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(409);
  });

  it("atomically refuses a second tab and permits a later run after the first finishes", async () => {
    let releaseFirst: (() => void) | undefined;
    const asked: (readonly string[] | undefined)[] = [];
    const server = await start({
      onRun: async (testIds) => {
        asked.push(testIds);
        if (asked.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
      },
    });

    const first = api(server, "/api/run", {
      method: "POST",
      body: JSON.stringify({ runnerTaskIds: ["tests/first.test.ts"] }),
    });
    await waitUntil(() => releaseFirst !== undefined, "the first run callback");

    const overlapping = await api(server, "/api/run", {
      method: "POST",
      body: JSON.stringify({ runnerTaskIds: ["tests/second.test.ts"] }),
    });
    expect(overlapping.status).toBe(409);
    expect(asked).toEqual([["tests/first.test.ts"]]);
    const legacy = await Viewer.connect(server);
    legacy.sendRaw(
      JSON.stringify({
        v: 1,
        type: "rerun",
        testIds: ["tests/socket.test.ts"],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).toEqual([["tests/first.test.ts"]]);
    legacy.close();

    releaseFirst?.();
    expect((await first).status).toBe(202);
    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({ runnerTaskIds: ["tests/later.test.ts"] }),
        })
      ).status,
    ).toBe(202);
    expect(asked).toEqual([["tests/first.test.ts"], ["tests/later.test.ts"]]);
  });

  it("accepts only exact native RunnerTaskIds from the scoped provider catalogue", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const listing = JSON.stringify([
      {
        name: "suite > allowed",
        file: "/repo/a.test.ts",
        provider: { id: "@termwright/test", version: 1 },
      },
      { name: "foreign", file: "/repo/foreign.test.ts" },
    ]);
    const server = await start({
      discovery: { cwd: "/repo", run: async () => listing },
      onRun: (testIds) => void asked.push(testIds),
    });
    await waitUntil(
      () =>
        server.hub.backlog.some(
          (message) => message.type === "tests-discovered",
        ),
      "the scoped provider catalogue",
    );

    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({
            runnerTaskIds: ["runner-task:00000000-0000-4000-8000-000000000001"],
          }),
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({ runnerTaskIds: ["/repo/a.test.ts"] }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({
            runnerTaskIds: ["/repo/a.test.ts::suite > invented"],
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({
            runnerTaskIds: ["runner-task:00000000-0000-4000-8000-000000000002"],
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({ runnerTaskIds: ["/tmp/arbitrary.test.ts"] }),
        })
      ).status,
    ).toBe(400);
    expect(asked).toEqual([
      ["runner-task:00000000-0000-4000-8000-000000000001"],
    ]);
  });

  it("does not accept targeted runs before scoped discovery has completed", async () => {
    let releaseDiscovery: ((listing: string) => void) | undefined;
    const discovery = new Promise<string>((resolve) => {
      releaseDiscovery = resolve;
    });
    const asked: (readonly string[] | undefined)[] = [];
    const server = await start({
      discovery: { cwd: "/repo", run: async () => discovery },
      onRun: (testIds) => void asked.push(testIds),
    });

    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({
            runnerTaskIds: ["runner-task:00000000-0000-4000-8000-000000000001"],
          }),
        })
      ).status,
    ).toBe(409);
    expect(asked).toEqual([]);
    releaseDiscovery?.(
      JSON.stringify([
        {
          name: "allowed",
          file: "/repo/a.test.ts",
          provider: { id: "@termwright/test", version: 1 },
        },
      ]),
    );
    await waitUntil(
      () =>
        server.hub.backlog.some(
          (message) => message.type === "tests-discovered",
        ),
      "discovery completion",
    );
    expect(
      (
        await api(server, "/api/run", {
          method: "POST",
          body: JSON.stringify({
            runnerTaskIds: ["runner-task:00000000-0000-4000-8000-000000000001"],
          }),
        })
      ).status,
    ).toBe(202);
  });

  it("refuses browser runs while the initial watcher run is live", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const server = await start({
      onRun: (testIds) => void asked.push(testIds),
    });
    const producer = await Viewer.connect(server, "producer");
    producer.send({
      v: 1,
      type: "run-start",
      runId: "run:test",
      mode: "live",
      startedAt: 123,
    });
    await waitUntil(() => {
      const message = server.hub.backlog.at(0);
      return message?.type === "run-start" && message.startedAt === 123;
    }, "the watcher run start");

    expect(
      (await api(server, "/api/run", { method: "POST", body: "{}" })).status,
    ).toBe(409);
    expect(asked).toEqual([]);

    producer.send({
      v: 1,
      type: "run-end",
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 1,
      },
    });
    await waitUntil(
      () => server.hub.backlog.at(-1)?.type === "run-end",
      "the watcher run end",
    );
    expect(
      (await api(server, "/api/run", { method: "POST", body: "{}" })).status,
    ).toBe(202);
    expect(asked).toEqual([undefined]);
    producer.close();
  });

  it("keeps another producer generation busy when an older producer ends", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const server = await start({
      onRun: (testIds) => void asked.push(testIds),
    });
    const older = await Viewer.connect(server, "producer");
    const newer = await Viewer.connect(server, "producer");
    older.send({
      v: 1,
      type: "run-start",
      runId: "run:test",
      mode: "live",
      startedAt: 1,
    });
    newer.send({
      v: 1,
      type: "run-start",
      runId: "run:test",
      mode: "live",
      startedAt: 2,
    });
    await waitUntil(() => {
      const message = server.hub.backlog.at(0);
      return message?.type === "run-start" && message.startedAt === 2;
    }, "both producer starts");

    older.send({
      v: 1,
      type: "run-end",
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 1,
      },
    });
    await waitUntil(
      () => server.hub.backlog.at(-1)?.type === "run-end",
      "the older producer end",
    );
    expect(
      (await api(server, "/api/run", { method: "POST", body: "{}" })).status,
    ).toBe(409);
    expect(asked).toEqual([]);

    newer.send({ v: 1, type: "run-cancelled", stoppedAt: 3 });
    await waitUntil(
      () => server.hub.backlog.at(-1)?.type === "run-cancelled",
      "the newer producer cancellation",
    );
    expect(
      (await api(server, "/api/run", { method: "POST", body: "{}" })).status,
    ).toBe(202);
    older.close();
    newer.close();
  });

  it("refuses a run while Stop is still settling", async () => {
    let releaseStop: (() => void) | undefined;
    let releaseRun: (() => void) | undefined;
    const asked: (readonly string[] | undefined)[] = [];
    const server = await start({
      onRun: (testIds) => {
        asked.push(testIds);
        return new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
      },
      onStop: () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        }),
    });
    const viewer = await Viewer.connect(server);
    const runResponse = await api(server, "/api/run", {
      method: "POST",
      body: "{}",
    });
    const { runId } = (await runResponse.json()) as { runId: string };
    const stopRequest = api(server, "/api/stop", {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
    await waitUntil(() => releaseStop !== undefined, "the stop callback");

    expect(
      (await api(server, "/api/run", { method: "POST", body: "{}" })).status,
    ).toBe(409);
    expect(asked).toEqual([undefined]);
    releaseStop?.();
    await stopRequest;
    await viewer.until(
      (messages) =>
        messages.some((message) => message.type === "run-cancelled"),
      "run cancellation",
    );
    releaseRun?.();
    expect(
      (await api(server, "/api/run", { method: "POST", body: "{}" })).status,
    ).toBe(202);
    viewer.close();
  });
});

describe("record mode", () => {
  it("forwards browser input to the child and generates a test", async () => {
    const harness = new FakeHarness("rec");
    const server = await start({
      record: {
        command: ["node", "agent.js"],
        launch: async () => harness.asHarness(),
      },
    });
    const viewer = await Viewer.connect(server);
    viewer.send({
      v: 1,
      type: "input",
      sessionId: "rec",
      dataB64: toBase64(new TextEncoder().encode("ls\r")),
    });

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && harness.writtenText() !== "ls\r") {
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(harness.writtenText()).toBe("ls\r");

    const pointerEvidence: EvidenceProvenance = {
      source: "application",
      method: "native",
      strength: "authoritative",
      providerId: "app.router",
    };
    const unsupported = {
      status: "unsupported",
      reason: "framework-unobservable",
    } as const;
    harness.negotiatedContract = {
      contractId: "rec:0",
      sessionId: "rec",
      epoch: 0,
      protocol: "termwright/2",
      framework: null,
      providers: [
        {
          id: "app.router",
          kind: "application",
          version: "1",
          method: "native",
          capabilities: ["pointer-regions", "hit-test"],
        },
      ],
      capabilities: {
        "semantic-tree": { status: "supported", evidence: pointerEvidence },
        "stable-identity": unsupported,
        "intended-geometry": unsupported,
        "clipped-geometry": unsupported,
        "painted-region": unsupported,
        "pointer-geometry": { status: "supported", evidence: pointerEvidence },
        "pointer-hit-testing": {
          status: "supported",
          evidence: pointerEvidence,
        },
        focus: unsupported,
        scroll: unsupported,
        "render-order": unsupported,
        "action-strategies": unsupported,
        "keyboard-input": { status: "supported", evidence: pointerEvidence },
        "pointer-input": { status: "supported", evidence: pointerEvidence },
        "focus-input": unsupported,
        "paired-revisions": { status: "supported", evidence: pointerEvidence },
      },
      terminal: {
        profile: "default",
        platform: "linux",
        mouseModesObservable: true,
      },
    } satisfies EffectiveSessionContract;
    harness.semantic({
      ...snapshot(
        1,
        [node({ id: "b1", role: "button", name: "Approve" })],
        "rec",
      ),
      hitGrid: {
        status: "known",
        evidence: pointerEvidence,
        value: {
          regions: [
            {
              recipientId: "b1",
              rect: { row: 1, column: 1, width: 8, height: 1 },
            },
          ],
        },
      },
    });
    const action = await api(server, "/api/record/action", {
      method: "POST",
      body: JSON.stringify({ kind: "click", nodeId: "b1" }),
    });
    const body = (await action.json()) as {
      selector: { expression: string };
      source: string;
    };
    expect(body.selector.expression).toBe(
      "app.getByRole('button', { name: 'Approve' })",
    );
    expect(body.source).toContain(
      "type input withheld by recorder policy (2 bytes)",
    );
    expect(body.source).not.toContain("'ls'");
    expect(body.source).toContain("await app.press('Enter');");
    expect(body.source).toContain(
      "await app.getByRole('button', { name: 'Approve' }).click();",
    );
    viewer.close();
  });

  it("holds input back while pick mode is on", async () => {
    const harness = new FakeHarness("rec");
    const server = await start({
      record: {
        command: ["node", "agent.js"],
        launch: async () => harness.asHarness(),
      },
    });
    const viewer = await Viewer.connect(server);
    viewer.send({ v: 1, type: "pick", sessionId: "rec", enabled: true });
    await new Promise((done) => setTimeout(done, 50));
    viewer.send({
      v: 1,
      type: "input",
      sessionId: "rec",
      dataB64: toBase64(new TextEncoder().encode("x")),
    });
    await new Promise((done) => setTimeout(done, 100));
    expect(harness.writtenText()).toBe("");
    viewer.close();
  });

  it("records assertions and steps over HTTP", async () => {
    const harness = new FakeHarness("rec");
    const server = await start({
      record: {
        command: ["node", "agent.js"],
        launch: async () => harness.asHarness(),
      },
    });
    await api(server, "/api/record/step", {
      method: "POST",
      body: JSON.stringify({ title: "approve" }),
    });
    const response = await api(server, "/api/record/assert", {
      method: "POST",
      body: JSON.stringify({ kind: "snapshot" }),
    });
    const body = (await response.json()) as { source: string };
    expect(body.source).toContain("await step('approve', async () => {");
    expect(body.source).toContain(
      "await expect(app).toMatchSemanticSnapshot();",
    );
  });

  it("does not reinterpret an unknown recorder action kind as click", async () => {
    const harness = new FakeHarness("rec");
    const server = await start({
      record: {
        command: ["node", "agent.js"],
        launch: async () => harness.asHarness(),
      },
    });
    const response = await api(server, "/api/record/action", {
      method: "POST",
      body: JSON.stringify({ kind: "teleport", nodeId: "b1" }),
    });
    expect(response.status).toBe(400);
    expect(server.recorder?.events).toHaveLength(1);
  });

  it("rejects recorder routes when not recording", async () => {
    const server = await start();
    expect((await api(server, "/api/record/events")).status).toBe(409);
  });
});

describe("static files", () => {
  it("explains itself when the bundle has not been built", async () => {
    const server = await start({ appDir: "/nonexistent-app-dir" });
    const response = await api(server, "/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("not built");
  });

  it("refuses to serve outside the app directory", async () => {
    const server = await start({ appDir: "/nonexistent-app-dir" });
    const response = await api(server, "/%2e%2e/%2e%2e/etc/passwd");
    expect([403, 404]).toContain(response.status);
  });

  it("404s an unknown API route", async () => {
    const server = await start();
    expect((await api(server, "/api/nope")).status).toBe(404);
  });
});
