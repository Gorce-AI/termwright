import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as net from "node:net";

const loadNative = createRequire(import.meta.url);
const addon = loadNative(process.env.TW_SNAPSHOT_ADDON);
const journal = process.env.TW_SNAPSHOT_JOURNAL;
const observations = [];

function serialize(label) {
  const snapshot = addon.captureConsoleSnapshotPoc();
  const observation = {
    ...snapshot,
    label,
    codeUnits: Array.from(snapshot.codeUnits),
    cellAttributes: Array.from(snapshot.cellAttributes),
  };
  observations.push(observation);
  return observation;
}

function write(output) {
  return new Promise((resolve, reject) => {
    process.stdout.write(output, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

async function run(socket) {
  const checkpoint = (label) => {
    const observation = serialize(label);
    socket.write(
      `${JSON.stringify({
        label,
        width: observation.width,
        height: observation.height,
        cursorVisible: observation.cursorVisible,
      })}\n`,
    );
  };

  await write("\u001b[2J\u001b[HSTATE_A");
  checkpoint("a-1");
  await write("\u001b[HSTATE_B");
  checkpoint("b");
  await write("\u001b[HSTATE_A");
  checkpoint("a-2");
  checkpoint("semantic-only");

  await write("\u001b[?25l");
  checkpoint("cursor-hidden");
  await write("\u001b[?25h");

  await write("\u001b[?1049h\u001b[2J\u001b[HALTERNATE");
  checkpoint("alternate");
  await write("\u001b[?1049l");
  checkpoint("primary-restored");

  await write("\u001b[3;1H\u001b[38;2;12;200;90m😀界\u001b[0m");
  checkpoint("unicode-style");

  await write("\r\nREADY_FOR_RESIZE\r\n");
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.once("data", async () => {
    try {
      checkpoint("resized");
      writeFileSync(journal, JSON.stringify(observations), "utf8");
      await write("\r\nSNAPSHOTS_READY\r\n");
      process.stdin.pause();
      socket.end();
    } catch (error) {
      socket.destroy();
      process.stderr.write(`SNAPSHOT_FAILURE:${error.stack || error}\r\n`);
      process.exitCode = 1;
    }
  });
}

const socket = net.createConnection(
  {
    host: "127.0.0.1",
    port: Number(process.env.TW_SNAPSHOT_PORT),
  },
  () => {
    socket.write(
      `${JSON.stringify({ token: process.env.TW_SNAPSHOT_TOKEN })}\n`,
    );
    run(socket).catch((error) => {
      socket.destroy();
      process.stderr.write(`SNAPSHOT_FAILURE:${error.stack || error}\r\n`);
      process.exitCode = 1;
    });
  },
);
