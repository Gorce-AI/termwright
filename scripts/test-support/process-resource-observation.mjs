export function parseProcessTable(stdout) {
  const table = new Map();
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+?)\s*$/u.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && match[3] && match[4]) {
      table.set(pid, { ppid, startedAt: match[3], command: match[4] });
    }
  }
  return table;
}

export function parseDarwinFootprint(stdout, pids) {
  const measuredPids = [...stdout.matchAll(/^.+ \[(\d+)\]:.*\bFootprint:\s+\d+ B/gmu)].map(
    (match) => Number(match[1]),
  );
  const footprintMatch =
    pids.length === 1
      ? /^.+ \[\d+\]:.*\bFootprint:\s+(\d+) B/gmu.exec(stdout)
      : /^Summary Footprint:\s+(\d+) B\s*$/gmu.exec(stdout);
  const footprint = Number(footprintMatch?.[1]);
  if (!sameNumbers(measuredPids, pids) || !Number.isSafeInteger(footprint) || footprint < 0) {
    throw new Error(
      `footprint did not return one complete aggregate for ${pids.length} requested live pids`,
    );
  }
  return footprint;
}

export function parseDarwinOpenFileDescriptors(stdout, pids) {
  const measuredPids = [...stdout.matchAll(/^p(\d+)\s*$/gmu)].map((match) => Number(match[1]));
  if (!sameNumbers(measuredPids, pids)) {
    throw new Error(`lsof did not return all ${pids.length} requested live pids`);
  }
  return stdout.split('\n').filter((line) => /^f\d+$/u.test(line)).length;
}

export function sameProcessSet(left, right) {
  if (left.pids.length !== right.pids.length) return false;
  const rightPids = new Set(right.pids);
  return (
    left.pids.every(
      (pid) =>
        rightPids.delete(pid) && sameProcessIdentity(left.table.get(pid), right.table.get(pid)),
    ) && rightPids.size === 0
  );
}

export function sameProcessIdentity(left, right) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.ppid === right.ppid &&
    sameProcessGeneration(left, right)
  );
}

export function sameProcessGeneration(left, right) {
  return left !== undefined && right !== undefined && left.startedAt === right.startedAt;
}

function sameNumbers(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((value) => expected.delete(value)) && expected.size === 0;
}
