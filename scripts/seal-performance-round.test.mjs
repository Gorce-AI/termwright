import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadPerformanceRoundSeal,
  PERFORMANCE_ROUND_INPUTS,
  sealPerformanceRound,
} from './seal-performance-round.mjs';

const temporary = [];
const subjectSha = 'a'.repeat(40);

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('performance round seal', () => {
  it('binds every raw input to one subject and round', async () => {
    const directory = await reports();
    const seal = await sealPerformanceRound({
      directory, subject: 'reference', round: 1, sequence: 1, subjectSha, env: {},
    });
    const path = join(directory, 'round-seal.json');
    await writeFile(path, JSON.stringify(seal));
    await expect(loadPerformanceRoundSeal(path, {
      directory, subject: 'reference', round: 1, sequence: 1, subjectSha,
    }, {})).resolves.toEqual(seal);
    expect(Object.keys(seal.inputs).sort()).toEqual(Object.keys(PERFORMANCE_ROUND_INPUTS).sort());
    expect(Object.values(seal.inputs).every((digest) => /^[0-9a-f]{64}$/u.test(digest))).toBe(true);
  });

  it('rejects a swapped benchmark report or reused subject/round identity', async () => {
    const directory = await reports();
    const seal = await sealPerformanceRound({
      directory, subject: 'candidate', round: 2, sequence: 3, subjectSha, env: {},
    });
    const path = join(directory, 'round-seal.json');
    await writeFile(path, JSON.stringify(seal));
    await writeFile(join(directory, PERFORMANCE_ROUND_INPUTS.opentui), 'swapped');
    await expect(loadPerformanceRoundSeal(path, {
      directory, subject: 'candidate', round: 2, sequence: 3, subjectSha,
    }, {})).rejects.toThrow(/input opentui differs/u);
    await expect(loadPerformanceRoundSeal(path, {
      directory, subject: 'reference', round: 2, sequence: 3, subjectSha,
    }, {})).rejects.toThrow(/expected subject/u);
  });

  it('requires one first-attempt GitHub run and the subject-specific SHA', async () => {
    const directory = await reports();
    const env = {
      GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: subjectSha,
    };
    const seal = await sealPerformanceRound({
      directory, subject: 'candidate', round: 1, sequence: 2, subjectSha, env,
    });
    expect(seal.ci).toEqual({ runId: '123', runAttempt: '1', sha: subjectSha });
    await expect(sealPerformanceRound({
      directory, subject: 'candidate', round: 1, sequence: 2, subjectSha,
      env: { ...env, GITHUB_RUN_ATTEMPT: '2' },
    })).rejects.toThrow(/first attempt/u);
    await expect(sealPerformanceRound({
      directory, subject: 'candidate', round: 1, sequence: 2, subjectSha,
      env: { ...env, GITHUB_SHA: 'b'.repeat(40) },
    })).rejects.toThrow(/invalid/u);
  });

  it('rejects a wrong sequence and foreign, missing or later-attempt CI provenance', async () => {
    const directory = await reports();
    const env = {
      GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: subjectSha,
    };
    const seal = await sealPerformanceRound({
      directory, subject: 'reference', round: 1, sequence: 1, subjectSha, env,
    });
    const path = join(directory, 'round-seal.json');
    await writeFile(path, JSON.stringify(seal));
    await expect(loadPerformanceRoundSeal(path, {
      directory, subject: 'reference', round: 1, sequence: 4, subjectSha,
    }, env)).rejects.toThrow(/expected subject, round, sequence or SHA/u);
    await expect(loadPerformanceRoundSeal(path, {
      directory, subject: 'reference', round: 1, sequence: 1, subjectSha,
    }, { ...env, GITHUB_RUN_ID: '124' })).rejects.toThrow(/current workflow run/u);

    await writeFile(path, JSON.stringify({ ...seal, ci: null }));
    await expect(loadPerformanceRoundSeal(path, {
      directory, subject: 'reference', round: 1, sequence: 1, subjectSha,
    }, env)).rejects.toThrow(/provenance is missing/u);
    await writeFile(path, JSON.stringify({ ...seal, ci: { ...seal.ci, runAttempt: '2' } }));
    await expect(loadPerformanceRoundSeal(path, {
      directory, subject: 'reference', round: 1, sequence: 1, subjectSha,
    }, env)).rejects.toThrow(/not the first attempt/u);
  });
});

async function reports() {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-round-seal-'));
  temporary.push(directory);
  await Promise.all(Object.entries(PERFORMANCE_ROUND_INPUTS).map(([name, file]) => (
    writeFile(join(directory, file), `${name}\n`)
  )));
  return directory;
}
