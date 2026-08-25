export function validateVitestPtyTelemetry(records, expected) {
  const errors = [...(expected.readErrors ?? [])];
  const expectedRecords = expected.files * expected.casesPerFile * 2;
  if (records.length !== expectedRecords) {
    errors.push(`expected ${expectedRecords} telemetry records, observed ${records.length}`);
  }
  const transitions = new Map();
  const validRecords = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      errors.push('telemetry contains a non-object record');
      continue;
    }
    const source = typeof record.source === 'string' ? record.source : '';
    const index = Number.isSafeInteger(record.index) ? record.index : -1;
    const phase = record.phase;
    if (!source || index < 0 || index >= expected.casesPerFile || (phase !== 'start' && phase !== 'finish')) {
      errors.push(`invalid telemetry identity ${source}:${String(record.index)}:${String(phase)}`);
      continue;
    }
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0
      || !Number.isSafeInteger(record.threadId) || record.threadId < 0
      || record.node !== expected.node || record.platform !== expected.platform || record.arch !== expected.arch
      || !Number.isFinite(record.timeMs)
      || !Number.isSafeInteger(record.activePtys) || record.activePtys < 0
      || !record.memory || !Number.isFinite(record.memory.rss) || record.memory.rss <= 0) {
      errors.push(`${source}:${index}:${phase} has invalid runtime telemetry`);
      continue;
    }
    if (phase === 'finish' && (record.readyObserved !== true || record.releaseSent !== true
      || record.doneObserved !== true || record.exited !== true)) {
      errors.push(`${source}:${index}:finish lacks a complete READY -> release -> DONE -> exit lifecycle ` +
        `(ready=${String(record.readyObserved)}, release=${String(record.releaseSent)}, ` +
        `done=${String(record.doneObserved)}, exit=${String(record.exited)})`);
    }
    validRecords.push(record);
    const key = `${source}:${index}`;
    const phases = transitions.get(key) ?? [];
    phases.push(phase);
    transitions.set(key, phases);
  }
  if (transitions.size !== expected.files * expected.casesPerFile) {
    errors.push(`expected ${expected.files * expected.casesPerFile} PTY identities, observed ${transitions.size}`);
  }
  for (const [key, phases] of transitions) {
    if (phases.length !== 2 || phases[0] !== 'start' || phases[1] !== 'finish') {
      errors.push(`${key} has invalid lifecycle ${phases.join(' -> ')}`);
    }
  }
  const bySource = Map.groupBy(validRecords, (record) => record.source);
  const intervals = [];
  for (const [source, sourceRecords] of bySource) {
    let active = 0;
    let peak = 0;
    for (const record of [...sourceRecords].sort((left, right) => left.timeMs - right.timeMs)) {
      active += record.phase === 'start' ? 1 : -1;
      peak = Math.max(peak, active);
      if (record.activePtys !== active) errors.push(`${source} reports inconsistent active PTY count`);
    }
    if (active !== 0) errors.push(`${source} did not return to zero active PTYs`);
    if (peak !== Math.min(expected.terminals, expected.casesPerFile)) {
      errors.push(`${source} reached ${peak} active PTYs, expected ${Math.min(expected.terminals, expected.casesPerFile)}`);
    }
    const workerIds = new Set(sourceRecords.map((record) => `${record.pid}:${record.threadId}`));
    if (workerIds.size !== 1) errors.push(`${source} migrated between workers`);
    intervals.push({
      start: Math.min(...sourceRecords.map((record) => record.timeMs)),
      end: Math.max(...sourceRecords.map((record) => record.timeMs)),
      worker: [...workerIds][0],
    });
  }
  const maximumOverlap = Math.max(0, ...intervals.map((interval) => new Set(intervals
    .filter((candidate) => candidate.start <= interval.start && candidate.end >= interval.start)
    .map((candidate) => candidate.worker)).size));
  const expectedOverlap = expected.fileParallelism ? Math.min(expected.workers, expected.files) : 1;
  if (maximumOverlap !== expectedOverlap) {
    errors.push(`observed ${maximumOverlap} overlapping test files, expected ${expectedOverlap}`);
  }
  return { valid: errors.length === 0, errors };
}
