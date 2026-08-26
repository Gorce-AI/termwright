/**
 * The whole path, walked once: a plain tview application, built through the
 * generated workspace, launched under the real driver, addressed by role.
 *
 * Everything else in this package proves a piece — the copy compiles, the
 * canary confirms which copy compiled, the probe survives a stalled driver.
 * This is the test that says a user's application, with no imports of ours and
 * no configuration, becomes addressable.
 *
 * Skipped without a Go toolchain or a pseudo-terminal.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { goTestCapability } from "../../../scripts/test-support/go-toolchain.mjs";
import {
  launchTerminal,
  type SemanticLocator,
  type TerminalHarness,
} from "@termwright/driver";
import {
  createNativePtyBackend,
  inheritedSpawnEnv,
  launchTerminalWithBackend,
  type PtyBackend,
  type PtyProcess,
} from "@termwright/driver/experimental";
import type { Rect } from "@termwright/protocol";
import {
  applyPatchSet,
  canaryCheck,
  ensureUpstreamModule,
  materializeUpstream,
  writeWorkspace,
} from "@termwright/probe-go";
import { prepareInstrumentedBuild, PROBE_VERSION } from "./launch.js";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PATCH_SET = join(here, "..", "upstream-patches", "tview", "v0.42.0");
const TCELL_PATCH_SET = join(here, "..", "upstream-patches", "tcell", "v2.8.1");
const FIXTURE = join(here, "testing", "fixture-app");
const FIXTURE_ANNOTATED = join(here, "testing", "fixture-annotated");
const CLIENT = join(here, "..", "..", "..", "clients", "go");

async function intendedRect(locator: SemanticLocator): Promise<Rect | null> {
  const observation = (await locator.geometry()).intendedRect;
  return observation.status === "known" ? observation.value : null;
}

async function goAvailable(): Promise<boolean> {
  return goTestCapability(
    async () => {
      await run("go", ["version"]);
      return true;
    },
    false,
    "Go certification toolchain",
  );
}

function ptyAvailable(): boolean {
  if (process.env["TERMWRIGHT_SKIP_PTY"] === "1") return false;
  try {
    const pty = createNativePtyBackend().spawn({
      command: [process.execPath, "-e", "process.exit(0)"],
      env: inheritedSpawnEnv(),
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return true;
  } catch {
    return false;
  }
}

const hasGo = await goAvailable();
const runnable = hasGo && ptyAvailable();
const roots: string[] = [];
const sessions: TerminalHarness[] = [];

async function instrumentTcell(dir: string): Promise<string> {
  const copy = join(dir, "tcell");
  await materializeUpstream(
    await ensureUpstreamModule({
      module: "github.com/gdamore/tcell/v2",
      version: "v2.8.1",
      cachePath: ["github.com", "gdamore", "tcell", "v2@v2.8.1"],
    }),
    copy,
  );
  await applyPatchSet(copy, TCELL_PATCH_SET);
  return copy;
}

/**
 * Captures the real PTY byte stream without stealing startup chunks from the
 * driver. The production backend buffers only until its first subscriber, so
 * a naive tee would make the test itself race TerminalSession attachment.
 */
function byteCapturingBackend(): {
  readonly backend: PtyBackend;
  readonly bytes: () => Buffer;
} {
  const upstream = createNativePtyBackend();
  const chunks: Buffer[] = [];
  return {
    bytes: () => Buffer.concat(chunks),
    backend: {
      name: `${upstream.name}+byte-capture`,
      spawn(options): PtyProcess {
        // launchTerminal installs its private endpoint after merging the public
        // env option. Remove it at the final spawn boundary: this test needs
        // the driver's real VT/query responses, but the child itself must have
        // no way to attach the probe.
        const process = upstream.spawn({
          ...options,
          env: {
            ...options.env,
            TERMWRIGHT_ENDPOINT: "",
            TERMWRIGHT_TOKEN: "",
          },
        });
        const listeners = new Set<(data: Uint8Array) => void>();
        const pending: Uint8Array[] = [];
        process.onData((data) => {
          const copy = Buffer.from(data);
          chunks.push(copy);
          if (listeners.size === 0) {
            pending.push(copy);
            return;
          }
          for (const listener of listeners) listener(copy);
        });
        return {
          get pid() {
            return process.pid;
          },
          write: (data) => process.write(data),
          resize: (columns, rows) => process.resize(columns, rows),
          signal: (signal) => process.signal(signal),
          dispose: () => process.dispose(),
          onExit: (listener) => process.onExit(listener),
          onData(listener) {
            listeners.add(listener);
            for (const data of pending.splice(0)) listener(data);
            return () => listeners.delete(listener);
          },
        };
      },
    },
  };
}

afterEach(async () => {
  const owned = sessions.splice(0);
  const results = await Promise.allSettled(
    owned.map((session) => session.close()),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "failed to close test-owned terminal sessions",
    );
});

afterAll(async () => {
  await Promise.all(
    roots.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Builds the fixture, optionally through the instrumented copy. */
async function buildFixture(options: {
  readonly instrumented: boolean;
}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "tw-zeroconfig-")));
  roots.push(dir);

  const app = join(dir, "app");
  await mkdir(app, { recursive: true });
  await cp(FIXTURE, app, { recursive: true });

  const binary = join(dir, "app-binary");
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (options.instrumented) {
    const copy = join(dir, "tview");
    await materializeUpstream(
      await ensureUpstreamModule({
        module: "github.com/rivo/tview",
        version: "v0.42.0",
        cachePath: ["github.com", "rivo", "tview@v0.42.0"],
      }),
      copy,
    );
    await applyPatchSet(copy, PATCH_SET);
    const tcellCopy = await instrumentTcell(dir);

    env["GOWORK"] = await writeWorkspace(join(dir, "generated.work"), {
      moduleDir: app,
      inherited: { uses: [], replaces: [] },
      suppliedUses: [
        {
          dir: await realpath(CLIENT),
          module: "github.com/gorce-ai/termwright/clients/go",
        },
      ],
      replaces: [
        { from: "github.com/rivo/tview", to: copy },
        { from: "github.com/gdamore/tcell/v2", to: tcellCopy },
        {
          from: "github.com/gorce-ai/termwright/clients/go",
          to: await realpath(CLIENT),
          version: "v0.0.0",
        },
      ],
    });
  } else {
    // The comparison arm: the same source, the untouched framework.
    env["GOFLAGS"] = "-mod=mod";
  }

  await run("go", ["build", "-o", binary, "."], { cwd: app, env });
  return binary;
}

describe.skipIf(!runnable)("developer annotations", () => {
  it("adds what the probe cannot observe, and nothing it can", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tw-annotated-")));
    roots.push(dir);
    const app = join(dir, "app");
    await mkdir(app, { recursive: true });
    await cp(FIXTURE_ANNOTATED, app, { recursive: true });

    const copy = join(dir, "tview");
    await materializeUpstream(
      await ensureUpstreamModule({
        module: "github.com/rivo/tview",
        version: "v0.42.0",
        cachePath: ["github.com", "rivo", "tview@v0.42.0"],
      }),
      copy,
    );
    await applyPatchSet(copy, PATCH_SET);
    const tcellCopy = await instrumentTcell(dir);

    const client = await realpath(
      join(here, "..", "..", "..", "clients", "go"),
    );
    const workspace = await writeWorkspace(join(dir, "generated.work"), {
      moduleDir: app,
      inherited: { uses: [], replaces: [] },
      suppliedUses: [
        { dir: client, module: "github.com/gorce-ai/termwright/clients/go" },
      ],
      replaces: [
        { from: "github.com/rivo/tview", to: copy },
        { from: "github.com/gdamore/tcell/v2", to: tcellCopy },
        {
          from: "github.com/gorce-ai/termwright/clients/go",
          to: client,
          version: "v0.0.0",
        },
      ],
    });

    const binary = join(dir, "app-binary");
    await run("go", ["build", "-o", binary, "."], {
      cwd: app,
      env: { ...process.env, GOWORK: workspace },
    });

    const session = await launchTerminal({
      command: [binary],
      columns: 80,
      rows: 24,
    });
    sessions.push(session);
    await session.waitForText("unread");
    await expect
      .poll(() => session.contract(), { timeout: 10_000 })
      .not.toBeNull();
    expect(session.contract()?.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "fixture.pointer-regions",
          kind: "application",
          method: "declared",
          capabilities: ["pointer-regions"],
        }),
      ]),
    );
    await expect
      .poll(() => session.semanticTree()?.v, { timeout: 10_000 })
      .toBe(2);

    // A widget the probe has never heard of: without the annotation it would
    // be a generic region named after its Go type. The annotation says what it
    // is, and the probe's own facts stay underneath.
    await expect
      .poll(() => session.getByTestId("unread-badge").count())
      .toBe(1);
    await expect
      .poll(() =>
        session.getByRole("status", { name: "Unread messages" }).count(),
      )
      .toBe(1);

    // Domain state the closed vocabulary has no room for, reported verbatim.
    await expect
      .poll(() => session.getByTestId("unread-badge").extendedState())
      .toEqual({ mailbox: "inbox", unread: 3 });

    // Merge, not replacement: the annotation sharpened the button's name while
    // its role and its measured geometry came from the probe.
    await expect
      .poll(() => session.getByRole("button", { name: "Save changes" }).count())
      .toBe(1);
    const box = await intendedRect(
      session.getByRole("button", { name: "Save changes" }),
    );
    expect(box?.width).toBeGreaterThan(0);
    const tree = session.semanticTree();
    const saveNode = tree?.nodes.find((node) => node.testId === "save");
    const labelNode = tree?.nodes.find(
      (node) => node.role === "text" && node.name === "Save changes",
    );
    const helpNode = tree?.nodes.find(
      (node) => node.name === "Writes the current file",
    );
    expect(saveNode?.actions).toEqual(["focus", "activate"]);
    expect(saveNode?.labelledBy).toEqual([labelNode?.id]);
    expect(saveNode?.describedBy).toEqual([helpNode?.id]);
    expect(saveNode?.p).toBe("framework");
    expect(saveNode?.px).toEqual(
      expect.objectContaining({
        role: "recognizer",
        name: "annotation",
        actions: "annotation",
        labelledBy: "annotation",
        describedBy: "annotation",
      }),
    );

    // The annotation declares the supported actions, but the locator still
    // drives the real terminal. Starting focused makes this a deterministic
    // activation check rather than a duplicate of the Tab-order test below.
    await expect
      .poll(
        async () =>
          (await session.getByTestId("save").semanticState())?.focused,
      )
      .toBe(true);
    await session.getByTestId("save").activate();
    await session.waitForText("status: saved");
  }, 900_000);
});

describe.skipIf(!runnable)("the launcher call", () => {
  it("prepares a build from one call, and caches the copy for the next", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tw-launch-")));
    roots.push(dir);
    const app = join(dir, "app");
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });

    // A cache of its own, so the assertion about building versus reusing is
    // about this test rather than about whatever ran before it.
    const env = { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, "cache") };

    const first = await prepareInstrumentedBuild({ moduleDir: app, env });
    expect(first.built).toBe(true);
    // The version was detected from the module, not passed in.
    expect(first.copyDir).toContain("v0.42.0");

    await run("go", ["build", "-o", join(dir, "bin"), "."], {
      cwd: app,
      env: first.env,
    });

    const second = await prepareInstrumentedBuild({ moduleDir: app, env });
    expect(second.built).toBe(false);
    expect(second.copyDir).toBe(first.copyDir);

    // And the canary still proves it is our copy that compiles.
    const canary = await canaryCheck({
      copyDir: second.copyDir,
      moduleDir: app,
      workspaceFile: second.workspaceFile,
      packageName: "tview",
      env,
    });
    expect(canary.proved).toBe(true);
  }, 600_000);

  it("refuses a vendored build by name instead of overriding it", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tw-launch-")));
    roots.push(dir);
    const app = join(dir, "app");
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });

    await expect(
      prepareInstrumentedBuild({
        moduleDir: app,
        env: { ...process.env, GOFLAGS: "-mod=vendor" },
      }),
    ).rejects.toThrow(/-mod=vendor/u);
  }, 120_000);

  it("fails closed when the resolved tcell version has no exact certified companion", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "tw-launch-tcell-")));
    roots.push(dir);
    const app = join(dir, "app");
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });
    await run(
      "go",
      ["mod", "edit", "-require=github.com/gdamore/tcell/v2@v2.7.4"],
      { cwd: app },
    );
    await run(
      "go",
      ["mod", "download", "github.com/gdamore/tcell/v2@v2.7.4"],
      { cwd: app },
    );

    await expect(
      prepareInstrumentedBuild({
        moduleDir: app,
        env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, "cache") },
      }),
    ).rejects.toThrow(
      /no exact certified patch set for github\.com\/gdamore\/tcell\/v2 v2\.7\.4/u,
    );
  }, 120_000);

  it.each([
    {
      module: "github.com/rivo/tview",
      version: "v0.42.0",
      cachePath: ["github.com", "rivo", "tview@v0.42.0"],
    },
    {
      module: "github.com/gdamore/tcell/v2",
      version: "v2.8.1",
      cachePath: ["github.com", "gdamore", "tcell", "v2@v2.8.1"],
    },
  ])(
    "refuses a local replacement masquerading as certified $module",
    async ({ module, version, cachePath }) => {
      const dir = await realpath(
        await mkdtemp(join(tmpdir(), "tw-launch-replace-")),
      );
      roots.push(dir);
      const app = join(dir, "app");
      const fork = join(dir, "fork");
      await mkdir(app, { recursive: true });
      await cp(FIXTURE, app, { recursive: true });
      await materializeUpstream(
        await ensureUpstreamModule({ module, version, cachePath }),
        fork,
      );
      await run("go", ["mod", "edit", `-replace=${module}=${fork}`], {
        cwd: app,
      });

      await expect(
        prepareInstrumentedBuild({
          moduleDir: app,
          env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, "cache") },
        }),
      ).rejects.toThrow(
        new RegExp(`refuses replaced ${module.replaceAll("/", "\\/")}`, "u"),
      );
    },
    120_000,
  );

  it("does not illegally replace the client when the app is inside that module", async () => {
    const dir = await realpath(
      await mkdtemp(join(tmpdir(), "tw-launch-client-")),
    );
    roots.push(dir);
    const prepared = await prepareInstrumentedBuild({
      moduleDir: CLIENT,
      workspaceFile: join(dir, "generated.work"),
      env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, "cache") },
    });

    const workspace = await readFile(prepared.workspaceFile, "utf8");
    expect(workspace).not.toMatch(
      /replace github\.com\/gorce-ai\/termwright\/clients\/go/u,
    );
    await run(
      "go",
      ["build", "-o", join(dir, "permission"), "./examples/permission"],
      {
        cwd: CLIENT,
        env: prepared.env,
      },
    );
  }, 600_000);
});

describe.skipIf(!runnable)("a plain tview application under the probe", () => {
  it("publishes observed geometry without claiming pointer ownership", async () => {
    const binary = await buildFixture({ instrumented: true });
    const app = await launchTerminal({
      command: [binary],
      columns: 80,
      rows: 24,
    });
    sessions.push(app);
    await app.waitForText("readme.md");
    await app.settled();
    expect(app.semanticTree()?.v).toBe(2);

    const tree = app.semanticTree();
    expect(tree?.hitGrid).toEqual({
      status: "unsupported",
      capability: "pointer-hit-grid",
      reason: "framework-unobservable",
    });
    const list = tree?.nodes.find(
      (node) => node.role === "list" && node.name === "Files",
    );
    expect(list?.geometry?.displayed).toMatchObject({
      status: "known",
      value: true,
    });
    expect(list?.geometry?.intendedRect).toMatchObject({ status: "known" });
    expect(list?.geometry?.visibleRect).toEqual({
      status: "unsupported",
      capability: "clipped-geometry",
      reason: "framework-unobservable",
    });
  }, 600_000);

  it("exposes its widgets by role, with no import and no configuration", async () => {
    const binary = await buildFixture({ instrumented: true });

    const app = await launchTerminal({
      command: [binary],
      columns: 80,
      rows: 24,
    });
    sessions.push(app);
    await app.waitForText("readme.md");
    await app.settled();

    // The claim of the whole phase: semantics from an application that was
    // never told about us. Terminal output and the side-channel handshake are
    // independent streams, so rendered text is not a semantic readiness
    // barrier on a busy runner.
    await expect
      .poll(() => app.contract()?.capabilities["semantic-tree"].status)
      .toBe("supported");
    expect(app.contract()?.framework).toMatchObject({
      name: "tview",
      version: "v0.42.0",
      adapterVersion: PROBE_VERSION,
    });
    expect(app.contract()?.capabilities["stable-identity"].status).toBe(
      "supported",
    );

    // The driver's own API rather than the Native Host's matchers: a probe
    // package should not depend on the host authoring surface to prove it works.
    await expect
      .poll(() => app.getByRole("list", { name: "Files" }).count())
      .toBe(1);
    await expect
      .poll(() => app.getByRole("listitem", { name: "readme.md" }).count())
      .toBe(1);
    await expect
      .poll(() => app.getByRole("button", { name: "Save" }).count())
      .toBe(1);

    // A widget on a page tview has not shown carries `hidden` rather than
    // being absent — the in-package walk is what makes that knowable.
    await expect
      .poll(
        async () =>
          (await app.getByRole("textbox", { name: "Name" }).visibility())
            .displayed,
      )
      .toMatchObject({ status: "known", value: false });

    // Showing the page flips exactly that: the widget stops being hidden.
    // Not asserted on the screen, because tview draws the shown page over the
    // status line rather than beside it — the tree knows, the grid does not.
    await app.press("s");
    await expect
      .poll(() => app.getByRole("textbox", { name: "Name" }).count())
      .toBe(1);
    await expect
      .poll(() => app.getByRole("region", { name: "Settings" }).count())
      .toBe(1);
  }, 600_000);

  it("reflects focus, selection, value and resize in the tree", async () => {
    // The rest of the C list. Each of these is a fact the driver can only get
    // from the probe: the screen shows a highlight, the tree says which widget
    // holds the focus and which row is selected.
    const binary = await buildFixture({ instrumented: true });
    const app = await launchTerminal({
      command: [binary],
      columns: 80,
      rows: 24,
    });
    sessions.push(app);
    await app.waitForText("readme.md");
    await app.settled();

    const state = async (
      role: "list" | "button" | "listitem" | "textbox",
      name: string,
    ) => app.getByRole(role, { name }).semanticState();

    // focus: it starts on the list and Tab moves it to the button.
    await expect
      .poll(async () => (await state("list", "Files"))?.focused)
      .toBe(true);
    await app.press("Tab");
    await expect
      .poll(async () => (await state("button", "Save"))?.focused)
      .toBe(true);
    await expect
      .poll(async () => (await state("list", "Files"))?.focused)
      .not.toBe(true);

    // selection: moving through the list changes which item is selected, and
    // the tree names it rather than leaving a highlight to be read off cells.
    await app.press("Tab Tab");
    await expect
      .poll(async () => (await state("listitem", "readme.md"))?.selected)
      .toBe(true);
    await app.press("ArrowDown");
    await expect
      .poll(async () => (await state("listitem", "main.go"))?.selected)
      .toBe(true);
    await expect
      .poll(async () => (await state("listitem", "readme.md"))?.selected)
      .not.toBe(true);

    // value: typing into the field on the settings page.
    await app.press("s");
    await expect
      .poll(() => app.getByRole("textbox", { name: "Name" }).count())
      .toBe(1);
    await app.type("release");
    await expect
      .poll(() => app.getByRole("textbox", { name: "Name" }).textContent())
      .toContain("release");

    // resize: a real SIGWINCH, and geometry that follows it.
    const before = await intendedRect(app.getByRole("list", { name: "Files" }));
    await app.resize({ columns: 50, rows: 18 });
    await expect
      .poll(
        async () =>
          (await intendedRect(app.getByRole("list", { name: "Files" })))?.width,
      )
      .toBe(50);
    expect(before?.width).toBe(80);
  }, 600_000);

  it("is observably identical to the untouched framework when dormant", async () => {
    // The dormancy claim, measured rather than asserted from the source: the
    // instrumented binary run without the handshake variables must paint what
    // the vanilla one paints.
    const [vanilla, instrumented] = await Promise.all([
      buildFixture({ instrumented: false }),
      buildFixture({ instrumented: true }),
    ]);

    const terminalStates: unknown[] = [];
    const marker = Buffer.from("\u001b]8487;twm;", "utf8");
    for (const binary of [vanilla, instrumented]) {
      // The capturing backend removes the driver's private handshake at the
      // final spawn boundary. Doing this in `env` would be ineffective because
      // launchTerminal authoritatively installs its endpoint afterwards.
      const capture = byteCapturingBackend();
      const session = await launchTerminalWithBackend({
        command: [binary],
        columns: 80,
        // The fixture's fixed layout is exactly ten rows. Avoid importing
        // irrelevant history of untouched rows into the parity verdict.
        rows: 10,
        env: { TERMWRIGHT_ENDPOINT: "", TERMWRIGHT_TOKEN: "" },
        backend: capture.backend,
      });
      sessions.push(session);
      // `readme.md` is painted near the start of tview's frame. The status
      // line is the fixture's own readiness marker and is written only after
      // the complete frame, so both arms are compared at the same observable
      // application state rather than at an arbitrary PTY chunk boundary.
      await session.waitForText("status: ready");
      const contract = await session.settled();
      expect(contract.framework).toBeNull();
      expect(contract.capabilities["semantic-tree"].status).toBe("unsupported");

      // Application-owned causal states prove both redraw and input paths. Raw
      // escape streams are deliberately not compared: tcell's diff output is
      // history-dependent across otherwise identical sessions.
      await session.press("r");
      await session.waitForText("status: ready redraw:1");
      await session.press("Tab");
      await session.waitForText("status: ready redraw:1 focus:1");

      const screen = session.screen();
      terminalStates.push({
        columns: screen.columns,
        rows: screen.rows,
        buffer: screen.buffer,
        modes: screen.modes,
        cursor: screen.cursor.visible ? screen.cursor : { visible: false },
        cells: Array.from({ length: screen.rows }, (_, row) =>
          Array.from({ length: screen.columns }, (_, column) =>
            screen.cell(row, column),
          ),
        ),
      });
      // No Termwright render marker may enter stdout at any point. Checking
      // raw bytes catches a probe that attached even when VT consumes its OSC.
      expect(capture.bytes().includes(marker)).toBe(false);
    }

    expect(terminalStates[1]).toEqual(terminalStates[0]);
  }, 900_000);
});

it("uses a causal handshake redraw and the screen's own marker writer", async () => {
  const source = await readFile(
    join(PATCH_SET, "add", "termwright_probe.go"),
    "utf8",
  );
  const windows = await readFile(
    join(TCELL_PATCH_SET, "add", "termwright_marker_windows.go"),
    "utf8",
  );
  const windowsTest = await readFile(
    join(TCELL_PATCH_SET, "add", "termwright_marker_windows_test.go"),
    "utf8",
  );

  expect(source).toContain("p.enqueueHandshakeRedraw()\n");
  expect(source).toContain(
    "if terminal, ok := screen.Tty(); ok && terminal != nil",
  );
  expect(source).toContain("windows.TermwrightWriteMarker(marker)");
  expect(source).toContain("p.redrawQueued.Store(false)");
  expect(source).not.toContain("time.Sleep(");
  expect(source).not.toContain("time.Now().Add(");
  expect(source).not.toContain("os.Stdout");
  expect(windows).toContain(
    "func (b *baseScreen) TermwrightWriteMarker(marker string) error",
  );
  expect(windows).toContain("b.screenImpl.(*cScreen)");
  expect(windows).toContain("if !s.vten");
  expect(windows).toContain("termwrightGetConsoleMode.Call(uintptr(s.out)");
  expect(windows).toContain("termwrightSetConsoleMode.Call(uintptr(s.out)");
  expect(windows).toContain("syscall.WriteConsole(s.out");
  expect(windows).not.toContain("os.Stdout");
  expect(windowsTest).toContain("screen, err := NewConsoleScreen()");
  expect(windowsTest).toContain("screen.(termwrightMarkerCapability)");
});

describe.skipIf(!hasGo)("the Windows tcell companion", () => {
  it("is pinned and enters the generated workspace", async () => {
    const dir = await realpath(
      await mkdtemp(join(tmpdir(), "tw-tcell-companion-")),
    );
    roots.push(dir);
    const app = join(dir, "app");
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });

    const prepared = await prepareInstrumentedBuild({
      moduleDir: app,
      workspaceFile: join(dir, "generated.work"),
      env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, "cache") },
    });
    const workspace = await readFile(prepared.workspaceFile, "utf8");
    const hook = await readFile(
      join(prepared.tcellCopyDir, "termwright_marker_windows.go"),
      "utf8",
    );

    expect(workspace).toContain("replace github.com/gdamore/tcell/v2 =>");
    expect(prepared.tcellCopyDir).toContain("v2.8.1");
    expect(hook).toContain("syscall.WriteConsole(s.out");
    expect(hook).toContain("termwrightGetConsoleMode.Call(uintptr(s.out)");
    expect(hook).toContain("termwrightSetConsoleMode.Call(uintptr(s.out)");
    await run("go", ["build", "-o", join(dir, "fixture.exe"), "."], {
      cwd: app,
      env: {
        ...prepared.env,
        GOOS: "windows",
        GOARCH: "amd64",
        CGO_ENABLED: "0",
      },
    });
    if (process.platform === "win32") {
      const { stdout } = await run(
        "go",
        [
          "test",
          "-run",
          "TestTermwrightConsoleScreenExposesReachableMarkerCapability",
          "-count=1",
          "-v",
          ".",
        ],
        { cwd: prepared.tcellCopyDir, env: { ...process.env, GOWORK: "off" } },
      );
      expect(stdout).toContain(
        "PASS: TestTermwrightConsoleScreenExposesReachableMarkerCapability",
      );
    }
  }, 600_000);
});

/** Kept for the failure message when the fixture stops being zero-config. */
it("the fixture imports nothing of ours", async () => {
  const source = (
    await Promise.all(
      ["main.go", "screen_nonwindows.go", "screen_windows.go"].map((file) =>
        readFile(join(FIXTURE, file), "utf8"),
      ),
    )
  ).join("\n");
  const imports = source.slice(source.indexOf("import ("), source.indexOf(")"));

  expect(imports).not.toContain("termwright");
  expect(imports).toContain("github.com/rivo/tview");
  expect(source).toContain("tcell.NewConsoleScreen()");
  expect(source).toContain("app.SetScreen(screen)");
});
