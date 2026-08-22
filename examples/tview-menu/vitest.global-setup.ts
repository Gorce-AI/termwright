import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL(".", import.meta.url));
const build = fileURLToPath(new URL("./scripts/build.mjs", import.meta.url));

/** Build the exact patched Go binary once before this project executes. */
export default async function setup(): Promise<void> {
  await exec(process.execPath, [build], { cwd: root });
}
