#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from './is-direct-execution.mjs';
import ts from 'typescript';

const START = '<!-- BEGIN GENERATED RESOURCE PROFILES -->';
const END = '<!-- END GENERATED RESOURCE PROFILES -->';
const sourceUrl = new URL('../packages/termwright-cli/src/resource-profiles.ts', import.meta.url);
const targetUrl = new URL(
  '../website/src/content/docs/reference/configuration.md',
  import.meta.url,
);

export function renderResourceProfiles(profiles) {
  if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new TypeError('TERMWRIGHT_RESOURCE_PROFILES must be an object');
  }
  const entries = Object.entries(profiles);
  if (entries.length === 0) throw new TypeError('TERMWRIGHT_RESOURCE_PROFILES must not be empty');
  const resourceClasses = Object.keys(entries[0][1]?.capacities ?? {});
  if (resourceClasses.length === 0)
    throw new TypeError('resource profiles must declare capacities');

  const header = ['Profile', 'Workers', ...resourceClasses.map(resourceLabel), 'Per terminal'];
  const divider = header.map(() => '---');
  const rows = entries.map(([name, profile]) => {
    if (
      profile?.name !== name ||
      profile.scheduler?.pool !== 'forks' ||
      profile.scheduler.fileParallelism !== true
    ) {
      throw new TypeError(`resource profile ${name} has an unsupported scheduler shape`);
    }
    if (!Number.isSafeInteger(profile.scheduler.maxWorkers) || profile.scheduler.maxWorkers <= 0) {
      throw new TypeError(`resource profile ${name} must declare a positive worker limit`);
    }
    const capacityKeys = Object.keys(profile.capacities ?? {});
    if (capacityKeys.join('\0') !== resourceClasses.join('\0')) {
      throw new TypeError(`resource profile ${name} capacity keys differ from the first profile`);
    }
    const capacities = resourceClasses.map((resource) =>
      positive(profile.capacities[resource], `${name}.${resource}`),
    );
    const perTerminal = Object.entries(profile.perTerminal ?? {}).map(
      ([resource, amount]) =>
        `\`${resource}\` × ${positive(amount, `${name}.perTerminal.${resource}`)}`,
    );
    return [
      `\`${name}\``,
      String(profile.scheduler.maxWorkers),
      ...capacities.map(String),
      perTerminal.length === 0 ? 'none' : perTerminal.join(', '),
    ];
  });

  return [
    '<!-- Generated from TERMWRIGHT_RESOURCE_PROFILES; do not edit this block by hand. -->',
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function renderDocument(document, generated, path) {
  const start = document.indexOf(START);
  const end = document.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${path}: missing or invalid resource profile markers`);
  }
  if (
    document.indexOf(START, start + START.length) !== -1 ||
    document.indexOf(END, end + END.length) !== -1
  ) {
    throw new Error(`${path}: resource profile markers must occur exactly once`);
  }
  return `${document.slice(0, start + START.length)}\n${generated}\n${document.slice(end)}`;
}

async function loadProfiles() {
  const source = await readFile(sourceUrl, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: fileURLToPath(sourceUrl),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  const errors =
    transpiled.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  if (errors.length > 0) {
    throw new Error(
      `cannot load resource profile source: ${errors.map((error) => error.messageText).join('; ')}`,
    );
  }
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
  );
  return module.TERMWRIGHT_RESOURCE_PROFILES;
}

function positive(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function resourceLabel(resource) {
  const labels = {
    ptySession: 'PTY sessions',
    externalProcess: 'External processes',
    semanticEndpoint: 'Semantic endpoints',
    nativeHostPressure: 'Native-host pressure',
    traceWriter: 'Trace writers',
  };
  return labels[resource] ?? `\`${resource}\``;
}

async function main() {
  const targetPath = fileURLToPath(targetUrl);
  const current = await readFile(targetUrl, 'utf8');
  const expected = renderDocument(
    current,
    renderResourceProfiles(await loadProfiles()),
    targetPath,
  );
  if (current !== expected) {
    if (process.argv.includes('--write')) await writeFile(targetUrl, expected, 'utf8');
    else
      throw new Error(
        'resource profile documentation drifted; run node scripts/generate-resource-profile-docs.mjs --write',
      );
  }
  process.stdout.write(
    process.argv.includes('--write')
      ? 'wrote resource profile documentation\n'
      : 'resource profiles: zero drift\n',
  );
}

if (isDirectExecution(import.meta.url)) {
  await main();
}
