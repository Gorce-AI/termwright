#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDirectExecution } from './is-direct-execution.mjs';

export const PERFORMANCE_ROUND_SEAL_KIND = 'termwright-performance-round-seal';
export const PERFORMANCE_ROUND_SEAL_VERSION = 1;
export const PERFORMANCE_ROUND_INPUTS = Object.freeze({
  environment: 'environment.json',
  quality: 'quality.json',
  semantic: 'semantic-pipeline.json',
  charm: 'charm-immediate.json',
  opentui: 'opentui-marker-route.json',
});

export async function sealPerformanceRound({
  directory,
  subject,
  round,
  sequence,
  subjectSha,
  env = process.env,
}) {
  validateIdentity({ subject, round, sequence, subjectSha });
  const inputs = await hashInputs(directory);
  const ci = githubIdentity(env, subjectSha);
  return {
    kind: PERFORMANCE_ROUND_SEAL_KIND,
    schemaVersion: PERFORMANCE_ROUND_SEAL_VERSION,
    subject,
    round,
    sequence,
    subjectSha,
    ci,
    inputs,
  };
}

export async function loadPerformanceRoundSeal(path, expected, env = process.env) {
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  exactKeys(
    value,
    ['kind', 'schemaVersion', 'subject', 'round', 'sequence', 'subjectSha', 'ci', 'inputs'],
    'performance round seal',
  );
  if (
    value.kind !== PERFORMANCE_ROUND_SEAL_KIND ||
    value.schemaVersion !== PERFORMANCE_ROUND_SEAL_VERSION
  ) {
    throw new Error('performance round seal kind or schema is unsupported');
  }
  validateIdentity(value);
  if (
    value.subject !== expected.subject ||
    value.round !== expected.round ||
    value.sequence !== expected.sequence ||
    value.subjectSha !== expected.subjectSha
  ) {
    throw new Error(
      'performance round seal differs from the expected subject, round, sequence or SHA',
    );
  }
  validateGithubIdentity(value.ci, value.subjectSha, env);
  exactKeys(value.inputs, Object.keys(PERFORMANCE_ROUND_INPUTS), 'performance round seal inputs');
  const actual = await hashInputs(expected.directory);
  for (const name of Object.keys(PERFORMANCE_ROUND_INPUTS)) {
    if (!/^[0-9a-f]{64}$/u.test(value.inputs[name] ?? '') || value.inputs[name] !== actual[name]) {
      throw new Error(`performance round seal input ${name} differs from the retained report`);
    }
  }
  return value;
}

async function hashInputs(directory) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(PERFORMANCE_ROUND_INPUTS).map(async ([name, file]) => [
        name,
        sha256(await readFile(resolve(directory, file))),
      ]),
    ),
  );
}

function validateIdentity({ subject, round, sequence, subjectSha }) {
  if (subject !== 'reference' && subject !== 'candidate') {
    throw new Error('performance round subject must be reference or candidate');
  }
  if (round !== 1 && round !== 2) throw new Error('performance round number must be 1 or 2');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 4) {
    throw new Error('performance round sequence must be 1..4');
  }
  if (!/^[0-9a-f]{40}$/u.test(subjectSha ?? '')) {
    throw new Error('performance round subject SHA must be exact');
  }
}

function githubIdentity(env, subjectSha) {
  if (env.GITHUB_ACTIONS !== 'true') return null;
  const value = {
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    sha: env.GITHUB_SHA,
  };
  validateGithubIdentity(value, subjectSha, env);
  return value;
}

function validateGithubIdentity(value, subjectSha, env) {
  if (value === null) {
    if (env.GITHUB_ACTIONS === 'true')
      throw new Error('performance round GitHub provenance is missing');
    return;
  }
  exactKeys(value, ['runId', 'runAttempt', 'sha'], 'performance round GitHub provenance');
  if (
    !/^[1-9][0-9]*$/u.test(value.runId ?? '') ||
    value.runAttempt !== '1' ||
    value.sha !== subjectSha
  ) {
    throw new Error('performance round GitHub provenance is invalid or not the first attempt');
  }
  if (
    env.GITHUB_ACTIONS === 'true' &&
    (value.runId !== env.GITHUB_RUN_ID || value.runAttempt !== env.GITHUB_RUN_ATTEMPT)
  ) {
    throw new Error('performance round GitHub provenance differs from the current workflow run');
  }
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/u, '');
    const value = argv[index + 1];
    if (
      !['directory', 'subject', 'round', 'sequence', 'subject-sha', 'output'].includes(name) ||
      !value
    ) {
      throw new Error(
        'usage: seal-performance-round.mjs --directory <dir> --subject <reference|candidate> --round <1|2> --sequence <1..4> --subject-sha <sha> --output <json>',
      );
    }
    const key = name.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (options[key] !== undefined) throw new Error(`duplicate performance round option --${name}`);
    options[key] = value;
  }
  for (const name of ['directory', 'subject', 'round', 'sequence', 'subjectSha', 'output']) {
    if (!options[name]) throw new Error(`missing performance round option ${name}`);
  }
  return { ...options, round: Number(options.round), sequence: Number(options.sequence) };
}

async function main(argv) {
  const options = parseArgs(argv);
  const seal = await sealPerformanceRound(options);
  await writeFile(resolve(options.output), `${JSON.stringify(seal, null, 2)}\n`, 'utf8');
}

if (isDirectExecution(import.meta.url)) {
  await main(process.argv.slice(2));
}
