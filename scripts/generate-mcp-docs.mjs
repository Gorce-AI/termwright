#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMcpToolSurfaceMarkdown } from '../packages/mcp/dist/docs.js';

const START = '<!-- BEGIN GENERATED MCP TOOL SURFACE -->';
const END = '<!-- END GENERATED MCP TOOL SURFACE -->';
const targets = [
  new URL('../packages/mcp/README.md', import.meta.url),
  new URL('../website/src/content/docs/reference/mcp.md', import.meta.url),
];

function renderDocument(document, generated, path) {
  const start = document.indexOf(START);
  const end = document.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${path}: missing or invalid MCP tool surface markers`);
  }
  if (document.indexOf(START, start + START.length) !== -1 || document.indexOf(END, end + END.length) !== -1) {
    throw new Error(`${path}: MCP tool surface markers must occur exactly once`);
  }
  return `${document.slice(0, start + START.length)}\n${generated.trimEnd()}\n${document.slice(end)}`;
}

async function main() {
  const generated = renderMcpToolSurfaceMarkdown();
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
    throw new Error(`MCP documentation drifted; run node scripts/generate-mcp-docs.mjs --write\n${drifted.join('\n')}`);
  }
  process.stdout.write(
    process.argv.includes('--write') ? `wrote ${targets.length} MCP documentation surfaces\n` : 'MCP documentation: zero drift\n',
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
