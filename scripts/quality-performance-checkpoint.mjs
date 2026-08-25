import { randomBytes, randomUUID } from 'node:crypto';
import { unwatchFile, watchFile } from 'node:fs';
import { link, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

export const CHECKPOINT_DIRECTORY_ENV = 'TERMWRIGHT_QUALITY_CHECKPOINT_DIR';
export const CHECKPOINT_NONCE_ENV = 'TERMWRIGHT_QUALITY_CHECKPOINT_NONCE';
export const CHECKPOINT_SCHEMA_VERSION = 1;

const NONCE = /^[a-f0-9]{64}$/u;
const FILES = Object.freeze({ request: 'request.json', ready: 'ready.json', terminal: 'terminal.json' });

export async function createQualityCheckpoint(expectedSessions) {
  positiveInteger(expectedSessions, 'expectedSessions');
  const directory = await mkdtemp(join(tmpdir(), 'termwright-quality-checkpoint-'));
  const nonce = randomBytes(32).toString('hex');
  await atomicCreate(join(directory, FILES.request), {
    kind: 'termwright-quality-snapshot-request',
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    nonce,
    expectedSessions,
  });
  return Object.freeze({ directory, nonce, expectedSessions });
}

export function qualityCheckpointEnvironment(checkpoint) {
  validateCheckpoint(checkpoint);
  return Object.freeze({
    [CHECKPOINT_DIRECTORY_ENV]: checkpoint.directory,
    [CHECKPOINT_NONCE_ENV]: checkpoint.nonce,
  });
}

export function qualityCheckpointIsConfigured(env = process.env) {
  const directory = env[CHECKPOINT_DIRECTORY_ENV];
  const nonce = env[CHECKPOINT_NONCE_ENV];
  if (directory === undefined && nonce === undefined) return false;
  if (directory === undefined || nonce === undefined) {
    throw new Error('quality checkpoint environment must define both directory and nonce');
  }
  validateCheckpointIdentity({ directory, nonce });
  return true;
}

export async function readQualityCheckpointFromEnvironment(env = process.env) {
  const directory = env[CHECKPOINT_DIRECTORY_ENV];
  const nonce = env[CHECKPOINT_NONCE_ENV];
  validateCheckpointIdentity({ directory, nonce });
  const request = validateRequest(await readRecord(join(directory, FILES.request)), nonce);
  return Object.freeze({ directory, nonce, expectedSessions: request.expectedSessions });
}

export async function publishQualityReady(checkpoint, processPids) {
  validateCheckpoint(checkpoint);
  const processes = exactProcessPids(processPids, 'processPids');
  const request = validateRequest(await readRecord(join(checkpoint.directory, FILES.request)), checkpoint.nonce);
  if (processes.length !== request.expectedSessions) {
    throw new Error(`quality checkpoint expected ${request.expectedSessions} session processes, got ${processes.length}`);
  }
  await atomicCreate(join(checkpoint.directory, FILES.ready), {
    kind: 'termwright-quality-snapshot-ready',
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    nonce: checkpoint.nonce,
    processPids: processes,
  });
}

export async function waitForQualityReady(checkpoint, options = {}) {
  validateCheckpoint(checkpoint);
  const record = await waitForRecord(checkpoint.directory, FILES.ready, options.signal);
  return validateReady(record, checkpoint.nonce, checkpoint.expectedSessions);
}

export async function publishQualityTerminal(checkpoint, outcome) {
  validateCheckpoint(checkpoint);
  const terminal = outcome?.status === 'ok'
    ? {
        kind: 'termwright-quality-snapshot-terminal',
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        nonce: checkpoint.nonce,
        status: 'ok',
        sessions: checkpoint.expectedSessions,
        processCount: positiveInteger(outcome.processCount, 'processCount'),
      }
    : {
        kind: 'termwright-quality-snapshot-terminal',
        schemaVersion: CHECKPOINT_SCHEMA_VERSION,
        nonce: checkpoint.nonce,
        status: 'failure',
        message: nonEmptyString(outcome?.message, 'message'),
      };
  await atomicCreate(join(checkpoint.directory, FILES.terminal), terminal);
}

export async function waitForQualityTerminal(checkpoint, options = {}) {
  validateCheckpoint(checkpoint);
  const record = await waitForRecord(checkpoint.directory, FILES.terminal, options.signal);
  return validateTerminal(record, checkpoint.nonce, checkpoint.expectedSessions);
}

async function waitForRecord(directory, filename, signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('quality checkpoint wait aborted');
  const path = join(directory, filename);
  const existing = await tryReadRecord(path);
  if (existing !== undefined) return existing;

  return await new Promise((resolveRecord, reject) => {
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      unwatchFile(path, inspect);
      action();
    };
    const onAbort = () => {
      finish(() => reject(signal.reason ?? new Error('quality checkpoint wait aborted')));
    };
    const inspect = () => {
      void tryReadRecord(path).then((record) => {
        if (record !== undefined) finish(() => resolveRecord(record));
      }, (error) => finish(() => reject(error)));
    };
    // Polling the exact pathname is level-triggered: publication remains
    // observable even when it happens between checks. fs.watch notifications
    // are edge-triggered and can be coalesced or lost on supported platforms.
    watchFile(path, { persistent: false, interval: 50 }, inspect);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) finish(() => reject(signal.reason ?? new Error('quality checkpoint wait aborted')));
    // The second read closes the read-before-watch lost-wakeup window.
    inspect();
  });
}

async function atomicCreate(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const staged = `${path}.${randomUUID()}.staged`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, staged);
    // A hard-link publication is atomic and refuses EEXIST, so a second actor
    // cannot replace an immutable record after validating a stale state.
    await link(staged, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    await unlink(staged).catch(() => undefined);
    throw new Error(`cannot publish immutable quality checkpoint record ${path}`, { cause: error });
  }
  await unlink(staged).catch(() => undefined);
}

async function tryReadRecord(path) {
  try { return await readRecord(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readRecord(path) {
  const text = await readFile(path, 'utf8');
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`quality checkpoint record is not valid JSON: ${path}`, { cause: error }); }
}

function validateRequest(value, nonce) {
  exactObject(value, ['kind', 'schemaVersion', 'nonce', 'expectedSessions'], 'request');
  exact(value.kind, 'termwright-quality-snapshot-request', 'request.kind');
  exact(value.schemaVersion, CHECKPOINT_SCHEMA_VERSION, 'request.schemaVersion');
  exactNonce(value.nonce, nonce, 'request.nonce');
  positiveInteger(value.expectedSessions, 'request.expectedSessions');
  return value;
}

function validateReady(value, nonce, expectedSessions) {
  exactObject(value, ['kind', 'schemaVersion', 'nonce', 'processPids'], 'ready');
  exact(value.kind, 'termwright-quality-snapshot-ready', 'ready.kind');
  exact(value.schemaVersion, CHECKPOINT_SCHEMA_VERSION, 'ready.schemaVersion');
  exactNonce(value.nonce, nonce, 'ready.nonce');
  const processPids = exactProcessPids(value.processPids, 'ready.processPids');
  exact(processPids.length, expectedSessions, 'ready.processPids.length');
  return value;
}

function validateTerminal(value, nonce, expectedSessions) {
  if (value?.status === 'ok') {
    exactObject(value, ['kind', 'schemaVersion', 'nonce', 'status', 'sessions', 'processCount'], 'terminal ok');
    exact(value.sessions, expectedSessions, 'terminal.sessions');
    positiveInteger(value.processCount, 'terminal.processCount');
  } else if (value?.status === 'failure') {
    exactObject(value, ['kind', 'schemaVersion', 'nonce', 'status', 'message'], 'terminal failure');
    nonEmptyString(value.message, 'terminal.message');
  } else {
    throw new Error('terminal.status must be exactly "ok" or "failure"');
  }
  exact(value.kind, 'termwright-quality-snapshot-terminal', 'terminal.kind');
  exact(value.schemaVersion, CHECKPOINT_SCHEMA_VERSION, 'terminal.schemaVersion');
  exactNonce(value.nonce, nonce, 'terminal.nonce');
  return value;
}

function validateCheckpointIdentity(value) {
  if (!isAbsolute(value?.directory ?? '')) throw new Error('quality checkpoint directory must be absolute');
  if (!NONCE.test(value?.nonce ?? '')) throw new Error('quality checkpoint nonce must be 64 lowercase hex characters');
}

function validateCheckpoint(value) {
  validateCheckpointIdentity(value);
  positiveInteger(value?.expectedSessions, 'quality checkpoint expectedSessions');
}

function exactNonce(value, expected, label) {
  if (!NONCE.test(value) || value !== expected) throw new Error(`${label} does not match this checkpoint`);
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function exact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must be exactly ${JSON.stringify(expected)}`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

function exactProcessPids(value, label) {
  if (!Array.isArray(value) || value.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
    throw new Error(`${label} must contain positive safe-integer process ids`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicate process ids`);
  return [...value];
}
