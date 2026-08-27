/** Build a private pair of plain/probed tview fixtures before the native host opens. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { prepareInstrumentedBuild } from "@termwright/probe-tview";

const run = promisify(execFile);
const moduleDir = fileURLToPath(
  new URL("../../../clients/go/", import.meta.url),
);
const executableSuffix = process.platform === "win32" ? ".exe" : "";

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function buildTviewFixture() {
  const root = await mkdtemp(join(tmpdir(), "termwright-conformance-tview-"));
  const instrumentedName = `instrumented${executableSuffix}`;
  const baselineName = `baseline${executableSuffix}`;
  const instrumented = join(root, instrumentedName);
  const baseline = join(root, baselineName);
  const contract = join(root, "contract.json");
  try {
    const prepared = await prepareInstrumentedBuild({
      moduleDir,
      outputDir: join(root, "tool"),
    });
    await run(
      "go",
      [
        "build",
        ...prepared.goArgs,
        "-o",
        instrumented,
        "./examples/permission",
      ],
      {
        cwd: moduleDir,
        env: prepared.env,
      },
    );
    await run("go", ["build", "-o", baseline, "./examples/permission"], {
      cwd: moduleDir,
      env: { ...process.env, GOWORK: "off" },
    });
    await access(instrumented, constants.X_OK);
    await access(baseline, constants.X_OK);
    await writeFile(
      contract,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          platform: platform(),
          arch: arch(),
          binaries: {
            instrumented: {
              file: instrumentedName,
              sha256: await sha256(instrumented),
            },
            baseline: { file: baselineName, sha256: await sha256(baseline) },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return Object.freeze({
      instrumented,
      baseline,
      contract,
      cleanup: () => rm(root, { recursive: true, force: true }),
    });
  } catch (error) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "tview fixture build and cleanup both failed",
      );
    }
    throw error;
  }
}
