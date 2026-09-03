#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { readQuickstartContract } from './docs-contract.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [
  { readme, gettingStarted, app, readmeTest, docsTest },
  exampleApp,
  exampleTest,
  cliSource,
  cliDocs,
  configSource,
  configDocs,
] = await Promise.all([
  readQuickstartContract(),
  readFile(resolve(root, 'examples/getting-started/app.mjs'), 'utf8'),
  readFile(resolve(root, 'examples/getting-started/tests/permission.test.ts'), 'utf8'),
  readFile(resolve(root, 'packages/termwright-cli/src/args.ts'), 'utf8'),
  readFile(resolve(root, 'website/src/content/docs/reference/cli.md'), 'utf8'),
  readFile(resolve(root, 'packages/test/src/config.ts'), 'utf8'),
  readFile(resolve(root, 'website/src/content/docs/reference/configuration.md'), 'utf8'),
]);

if (readmeTest !== docsTest) throw new Error('README and Getting Started quick-start tests differ');
if (app !== exampleApp)
  throw new Error('Getting Started app snippet differs from executable source');
if (docsTest !== exampleTest)
  throw new Error('README/Getting Started test snippet differs from executable source');

for (const command of [
  'npm install --save-dev termwright',
  'npx termwright doctor',
  'npx termwright test',
]) {
  if (!gettingStarted.includes(command)) throw new Error(`Getting Started lacks ${command}`);
}
for (const command of ['npm install --save-dev termwright', 'npx termwright test']) {
  if (!readme.includes(command)) throw new Error(`README lacks ${command}`);
}

const cliCommands = parseCliCommands(cliSource);
for (const [_name, command] of cliCommands) {
  if (command.global) continue;
  for (const synopsis of command.synopsis) {
    const documented = normalizeWhitespace(`termwright ${synopsis}`);
    if (!normalizeWhitespace(cliDocs).includes(documented)) {
      throw new Error(`CLI reference lacks parser-owned synopsis: ${documented}`);
    }
  }
}
for (const match of cliDocs.matchAll(/^## `termwright ([a-z-]+)`$/gmu)) {
  if (!cliCommands.has(match[1]))
    throw new Error(`CLI reference documents unknown command ${match[1]}`);
}

const configFields = parseInterfaceProperties(configSource, 'TermwrightConfig');
const projectOptionsSection = /## Project options\n([\s\S]*?)(?=\n## )/u.exec(configDocs)?.[1];
if (projectOptionsSection === undefined) {
  throw new Error('configuration reference lacks the Project options section');
}
const documentedConfigFields = new Set(
  [...projectOptionsSection.matchAll(/^\| `([A-Za-z][A-Za-z0-9]*)` \|/gmu)].map(
    (match) => match[1],
  ),
);
for (const field of configFields) {
  if (!documentedConfigFields.has(field)) {
    throw new Error(`configuration reference lacks public TermwrightConfig field ${field}`);
  }
}
for (const field of documentedConfigFields) {
  if (!configFields.has(field)) {
    throw new Error(`configuration reference documents unknown TermwrightConfig field ${field}`);
  }
}

console.log('README, Getting Started, CLI, and configuration docs match executable sources');

function parseCliCommands(source) {
  const file = ts.createSourceFile(
    'args.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let table;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'CLI_COMMANDS' &&
        declaration.initializer !== undefined &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        table = declaration.initializer;
      }
    }
  }
  if (table === undefined) throw new Error('CLI_COMMANDS is not a literal command table');

  const commands = new Map();
  for (const property of table.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
      throw new Error('CLI_COMMANDS contains a non-literal command');
    }
    const name = propertyName(property.name);
    const synopsisProperty = property.initializer.properties.find(
      (entry) => ts.isPropertyAssignment(entry) && propertyName(entry.name) === 'synopsis',
    );
    if (
      synopsisProperty === undefined ||
      !ts.isPropertyAssignment(synopsisProperty) ||
      !ts.isArrayLiteralExpression(synopsisProperty.initializer)
    ) {
      throw new Error(`CLI command ${name} lacks a literal synopsis`);
    }
    const synopsis = synopsisProperty.initializer.elements.map((entry) => {
      if (!ts.isStringLiteral(entry)) throw new Error(`CLI command ${name} has dynamic synopsis`);
      return entry.text;
    });
    const global = property.initializer.properties.some(
      (entry) =>
        ts.isPropertyAssignment(entry) &&
        propertyName(entry.name) === 'global' &&
        entry.initializer.kind === ts.SyntaxKind.TrueKeyword,
    );
    commands.set(name, { synopsis, global });
  }
  return commands;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  throw new Error('CLI_COMMANDS contains a computed property');
}

function parseInterfaceProperties(source, interfaceName) {
  const file = ts.createSourceFile(
    'config.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = file.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  if (declaration === undefined || !ts.isInterfaceDeclaration(declaration)) {
    throw new Error(`cannot find interface ${interfaceName}`);
  }
  return new Set(
    declaration.members.map((member) => {
      if (!ts.isPropertySignature(member) || member.name === undefined) {
        throw new Error(`${interfaceName} contains a non-property member`);
      }
      return propertyName(member.name);
    }),
  );
}

function normalizeWhitespace(value) {
  return value.replaceAll(/\s+/gu, ' ').trim();
}
