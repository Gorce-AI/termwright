#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from './is-direct-execution.mjs';

const START = '<!-- BEGIN GENERATED RUNTIME REQUIREMENTS -->';
const END = '<!-- END GENERATED RUNTIME REQUIREMENTS -->';
const manifestUrl = new URL('../package.json', import.meta.url);
const targets = [
  new URL('../website/src/content/docs/getting-started.md', import.meta.url),
  new URL('../website/src/content/docs/reference/limitations.md', import.meta.url),
];

export function renderRuntimeRequirements(manifest) {
  const nodeRange = manifest?.engines?.node;
  const vitestVersion = manifest?.devDependencies?.vitest;
  if (typeof nodeRange !== 'string' || nodeRange.length === 0) {
    throw new TypeError('package.json engines.node must be a non-empty string');
  }
  if (typeof vitestVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(vitestVersion)) {
    throw new TypeError('package.json devDependencies.vitest must be an exact version');
  }
  const nodeMajors = [...nodeRange.matchAll(/\^(\d+)(?:\.\d+){0,2}/gu)].map((match) =>
    Number(match[1]),
  );
  if (nodeMajors.length === 0 || nodeMajors.some((major) => !Number.isSafeInteger(major))) {
    throw new TypeError('package.json engines.node must name supported caret major lines');
  }
  const supportedText = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' }).format(
    nodeMajors.map(String),
  );
  return [
    '<!-- Generated from package.json; do not edit this block by hand. -->',
    `- Use Node.js ${supportedText}. Other major versions are not supported.`,
    `- You do not need to install Vitest separately. Termwright includes Vitest ${vitestVersion}.`,
  ].join('\n');
}

function renderDocument(document, generated, path) {
  const start = document.indexOf(START);
  const end = document.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${path}: missing or invalid runtime requirement markers`);
  }
  if (
    document.indexOf(START, start + START.length) !== -1 ||
    document.indexOf(END, end + END.length) !== -1
  ) {
    throw new Error(`${path}: runtime requirement markers must occur exactly once`);
  }
  return `${document.slice(0, start + START.length)}\n${generated}\n${document.slice(end)}`;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const generated = renderRuntimeRequirements(manifest);
  const drifted = [];
  for (const target of targets) {
    const path = fileURLToPath(target);
    const current = await readFile(target, 'utf8');
    const expected = renderDocument(current, generated, path);
    if (current === expected) continue;
    if (process.argv.includes('--write')) await writeFile(target, expected, 'utf8');
    else drifted.push(path);
  }
  if (drifted.length > 0) {
    throw new Error(
      `runtime documentation drifted; run node scripts/generate-runtime-requirements.mjs --write\n${drifted.join('\n')}`,
    );
  }
  process.stdout.write(
    process.argv.includes('--write')
      ? `wrote ${targets.length} runtime requirement surfaces\n`
      : 'runtime requirements: zero drift\n',
  );
}

if (isDirectExecution(import.meta.url)) {
  await main();
}
